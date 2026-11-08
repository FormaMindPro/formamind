#!/usr/bin/env node
'use strict';

/**
 * external-exits - the "external exits under scrub" gate (prohibition 17 made constructive): a registry of the
 * network exits from the model family and a check that every exit is covered. Detection is dynamic:
 * git grep over the tracked scripts (*.cjs *.js *.mjs *.sh) for the network patterns
 * (https.request, https.get, fetch(, axios, curl ) - the probe's body carries not a single path,
 * domain or code of a concrete project (prohibition 16). The protocol template (.forma/protocol) and
 * test files are not scanned; the dashboard's web assets are scanned and classified.
 *
 * The classification of each found file - by reading its text, by descending strength of claims:
 *   through-scrub - uses the scrub module (plumb-scrub.cjs), there is a residue check and
 *                   an explicit refusal (process.exit(2) / "scrub-refused") - the refusal before the network is
 *                   confirmed here by the human at acceptance, the probe only catches the markers;
 *   internal      - network calls without a single external host: only relative paths
 *                   and localhost/127.0.0.1 (the internal contour, no scrub needed);
 *   no data       - a narrow benign pattern: GET without a request body (no -d/--data/
 *                   -F/-T/-X POST/stdin substitution), no project material leaves outward;
 *   RED           - everything else: a network call is not covered.
 *
 *   node .forma/board/checks/external-exits.cjs               (a full run over the tree)
 *   node .forma/board/checks/external-exits.cjs --selftest    (probes into the OS temp directory)
 *
 * Detection - git grep, that is only tracked files: an uncommitted script does not
 * land in the registry. Such files (outside the exceptions) are printed as a separate info line.
 *
 * Exit codes: 0 - all exits are covered (through-scrub / internal / no data);
 * 1 - there is a RED or the self-test mismatched; 2 - a runtime error.
 * Module: require('./external-exits.cjs').runExternalExits({ root }) → { ready, lines }.
 * Part of the core: carries no project traces (prohibition 16).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const i18n = require('../../i18n/index.cjs');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const msg = (key, params) => i18n.message(key, params, 'ru');

// Network patterns (ERE) - one source of truth for git grep and for the re-check of the text.
const NET_RE_SOURCE = 'https\\.request|https\\.get|fetch\\(|axios|curl ';
const NET_RE = new RegExp(NET_RE_SOURCE);
// An external host: an absolute URL not on localhost/127.0.0.1.
const EXTERNAL_URL_RE = /https?:\/\/(?!localhost|127\.0\.0\.1|::1)/;
// The body/upload flags of curl (POST volume outward = project material).
const CURL_BODY_RE = /(^|\s)(-d\b|--data\b|--data-raw\b|--data-binary\b|--data-urlencode\b|-F\b|--form\b|--form-string\b|--form-file\b|-T\b|--upload-file\b)/;
// An explicit non-GET curl method.
const CURL_METHOD_RE = /(^|\s)(-X|--request)\s*(POST|PUT|PATCH|DELETE)\b/i;
// A body from stdin/file in a curl line.
const CURL_STDIN_RE = /\s<\s?\S/;

/** The list of tracked scripts with network patterns, outside the exceptions. */
function discover(root) {
  let out = '';
  try {
    out = execFileSync('git', ['grep', '-l', '-E', NET_RE_SOURCE, '--', '*.cjs', '*.js', '*.mjs', '*.sh'], { cwd: root, encoding: 'utf8' });
  } catch (e) {
    if (e.status === 1) return []; // no matches - the registry is empty
    throw e;
  }
  return out.split(/\r?\n/).filter(Boolean).filter((p) => !isExcluded(p));
}

function isExcluded(p) {
  const parts = p.split('/');
  if (parts[0] === '.forma' && parts[1] === 'protocol') return true; // the protocol template
  const base = parts[parts.length - 1];
  if (/\.(test|spec)\./.test(base)) return true; // test files
  if (parts.slice(0, -1).some((s) => s === 'test' || s === 'tests')) return true;
  return false;
}

/** Unfinished (untracked) scripts with network patterns - outside the registry, but visible. */
function untrackedScripts(root) {
  let out = '';
  try {
    out = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  } catch {
    return [];
  }
  return out.split(/\r?\n/).filter(Boolean)
    .filter((l) => l.startsWith('?? '))
    .map((l) => l.slice(3).trim())
    .filter((p) => /\.(cjs|mjs|js|sh)$/.test(p) && !isExcluded(p) && fs.existsSync(path.join(root, p)));
}

/** Code without comment lines (JS // /* * and shell #) - for checking external hosts. */
function codeText(text) {
  return text.split(/\r?\n/)
    .filter((l) => { const t = l.trim(); return t && !t.startsWith('//') && !t.startsWith('#') && !t.startsWith('/*') && !t.startsWith('*'); })
    .join('\n');
}

function classify(text) {
  if (!NET_RE.test(text)) return { status: 'none' };
  // 1. through-scrub: the scrub module + the residue check + an explicit refusal (exit(2)/"scrub-refused").
  if (/plumb-scrub\.cjs/.test(text) && /residue\s*\(/.test(text) && (/scrub-refused/.test(text) || /process\.exit\(2\)/.test(text))) {
    const where = text.split(/\r?\n/).map((l, i) => (/\bresidue\s*\(/.test(l) ? i + 1 : null)).filter(Boolean);
    return { status: 'scrub', where };
  }
  // 2. internal: not a single absolute external host in the code (only localhost/relative).
  if (!EXTERNAL_URL_RE.test(codeText(text))) return { status: 'internal' };
  // 3. no project data: every curl is a GET without a body/upload/non-header stdin.
  const curlLines = text.split(/\r?\n/).filter((l) => /\bcurl\s/.test(l));
  if (curlLines.length && curlLines.every((l) => !CURL_BODY_RE.test(l) && !CURL_METHOD_RE.test(l) && !CURL_STDIN_RE.test(l))) {
    return { status: 'benign' };
  }
  return { status: 'red' };
}

// The status words - the dictionary (data), not literals of the code; the summary composes from the same keys.
const STATUS_WORD = {
  scrub: () => msg('board.external-exits.word_scrub'),
  internal: () => msg('board.external-exits.word_internal'),
  benign: () => msg('board.external-exits.word_benign'),
  red: () => msg('board.external-exits.word_red'),
};

function scan(root, files) {
  return files.map((rel) => {
    let text = '';
    try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return { rel, status: 'red', fact: msg('board.external-exits.unreadable', { rel }) }; }
    const c = classify(text);
    if (c.status === 'none') return null;
    let fact;
    if (c.status === 'scrub') fact = msg('board.external-exits.fact_scrub', { rel, word: STATUS_WORD.scrub(), where: c.where.join(', ') });
    else if (c.status === 'internal') fact = msg('board.external-exits.fact_internal', { rel, word: STATUS_WORD.internal() });
    else if (c.status === 'benign') fact = msg('board.external-exits.fact_benign', { rel, word: STATUS_WORD.benign() });
    else fact = msg('board.external-exits.fact_red', { rel, word: STATUS_WORD.red() });
    return { rel, status: c.status, fact };
  }).filter(Boolean);
}

function runExternalExits({ root } = {}) {
  root = root || ROOT;
  const found = discover(root);
  const rows = scan(root, found);
  const red = rows.filter((r) => r.status === 'red');
  const lines = rows.map((r) => ({ status: r.status === 'red' ? 'red' : 'green', fact: r.fact }));
  const stray = untrackedScripts(root);
  if (stray.length) lines.push({ status: 'info', fact: msg('board.external-exits.stray', { list: stray.join(', ') }) });
  if (!rows.length) lines.push({ status: 'info', fact: msg('board.external-exits.empty') });
  const counts = rows.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
  const summary = msg('board.external-exits.summary', {
    n: rows.length,
    scrub: counts.scrub || 0,
    internal: counts.internal || 0,
    benign: counts.benign || 0,
    red: red.length,
  });
  return { ready: red.length === 0, lines, summary };
}

function selftest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'external-exits-'));
  try {
    const fixtures = [
      { name: 'good-scrub.cjs', expect: 'scrub', code: "const { loadSecrets, scrub, residue } = require('./plumb-scrub.cjs');\nconst t = scrub(prompt, secrets, hosts);\nif (residue(t, secrets).length) process.exit(2);\nawait fetch('https://api.example.test/v1', { method: 'POST', body: t });\n" },
      { name: 'bare-fetch.cjs', expect: 'red', code: "const r = await fetch('https://api.example.test/v1', { method: 'POST', body: draft });\n" },
      { name: 'local-only.js', expect: 'internal', code: "const r = await fetch('http://127.0.0.1:3000/data.json');\nconst s = await fetch('./next.json');\n" },
      { name: 'benign-get.sh', expect: 'benign', code: "#!/bin/sh\nVER=$(curl -fsSL --max-time 5 \"https://example.test/pub/plugin.json\" 2>/dev/null | version_of)\n" },
      { name: 'body-curl.sh', expect: 'red', code: "#!/bin/sh\ncurl -fsSL -d @draft.txt \"https://example.test/publish\"\n" },
    ];
    for (const f of fixtures) fs.writeFileSync(path.join(dir, f.name), f.code);
    const rows = scan(dir, fixtures.map((f) => f.name));
    const mismatches = fixtures.filter((f) => {
      const r = rows.find((x) => x.rel === f.name);
      return !r || r.status !== f.expect;
    });
    const got = (n) => { const r = rows.find((x) => x.rel === n); return r ? r.status : msg('board.external-exits.no_status'); };
    if (mismatches.length) {
      return { ok: false, note: msg('board.external-exits.selftest_mismatch', { list: mismatches.map((f) => `${f.name} ${msg('board.external-exits.expected')} ${f.expect}, ${msg('board.external-exits.got')} ${got(f.name)}`).join('; ') }) };
    }
    return { ok: true, note: msg('board.external-exits.selftest_ok', { n: fixtures.length, list: fixtures.map((f) => f.expect).join(', ') }) };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

if (require.main === module) {
  try {
    const argv = process.argv.slice(2);
    if (argv.includes('--selftest')) {
      const st = selftest();
      console.log((st.ok ? '✓ ' : '✗ ') + st.note);
      process.exit(st.ok ? 0 : 1);
    }
    const r = runExternalExits();
    for (const l of r.lines) console.log((l.status === 'green' ? '✓ ' : l.status === 'red' ? '✗ ' : '· ') + l.fact);
    console.log(r.summary);
    console.log(r.ready ? msg('board.external-exits.cli_green') : msg('board.external-exits.cli_red'));
    process.exit(r.ready ? 0 : 1);
  } catch (e) {
    console.error(msg('board.stop') + e.message);
    process.exit(2);
  }
}

module.exports = { discover, classify, scan, runExternalExits, selftest };
