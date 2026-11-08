#!/usr/bin/env node
'use strict';

/**
 * credentials-zone - the "credentials zone" gate (prohibition 15, fail-closed): the VALUES of credentials
 * (API keys, tokens, passwords, PEM keys) live only in two allowed places - `.env` in the project root and
 * `project/VARS/credentials.md`; a credential value in any other file - a finding. References by name
 * (`VARIABLE_NAME` for .env, `[[name]]` for VARS/) do not count as values and are not caught. No model calls:
 * the status by the exit code, the dossier - in stdout; consumers - the card gates (check-ready), the engine's
 * file-write hook (Claude: PostToolUse Write|Edit) and the calls from other engines' hooks as their write
 * events appear.
 *
 *   node .forma/board/checks/credentials-zone.cjs --selftest
 *   node .forma/board/checks/credentials-zone.cjs --repo [--root <dir>]
 *   node .forma/board/checks/credentials-zone.cjs --file <path> [--root <dir>]
 *   node .forma/board/checks/credentials-zone.cjs --wired [--root <dir>]
 *
 * Modes:
 *   --selftest  probes in the OS temp directory: bait credentials outside the allowed places
 *               are caught, the allowed places themselves and the by-name references file - clean.
 *   --repo      a scan of the tracked files (git ls-files). Exceptions: node_modules,
 *               .forma/protocol (its probes carry baits deliberately) and the allowed places.
 *   --file      one file - for a call from hooks; the allowed places are skipped whole.
 *   --wired     for every engine of the project (.forma/dashboard/lib/engines.cjs: loadAdapters)
 *               it proves one of the two ("constructively or by discipline", ENGINE-CONTRACT.md):
 *               a registered scanner call from the engine's hook (by the adapter's hooks registry,
 *               including calls through a wrapper script) or a discipline line naming the scanner
 *               in its §8 rules file.
 *
 * Exit codes: 0 - green; 1 - findings, an uncovered engine or a mismatched selftest probe;
 * 2 - a runtime error (no file, no git, a wrong call).
 * Module: require('./credentials-zone.cjs').scanText(text) → findings; .scanFile(abs, root);
 * .runRepo(root); .runWired(root); .selftest().
 * Part of the core: carries no project traces (prohibition 16); the allowed places - the convention of
 * prohibition 15, the dictionary - universal credential families. Values in the dossier are masked: a finding
 * names the file, the line and the family, but does not print the credential itself.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const i18n = require('../../i18n/index.cjs');
const msg = (key, params) => i18n.message(key, params, 'ru');

const ROOT_DEFAULT = process.cwd();
const MAX_BYTES = 16 * 1024 * 1024; // larger - a skip with a counter, not a scan
const SCAN_FLOOR = 14;              // shorter for assignments - not a credential

// --- Allowed places (prohibition 15): credential values live only here --------------------------
// Both spellings of the convention's path are allowed: the law's registry names VARS/credentials.md,
// the project layout puts it in project/VARS/. Other .env files (.env.local and subdirectories) - NOT allowed.

function isAllowedPlace(rel) {
  if (rel === '.env') return true;
  if (rel === 'VARS/credentials.md' || rel === 'project/VARS/credentials.md') return true;
  return false;
}

// --- The dictionary of the signs: VALUES, not reference names ------------------------------------
// Key families with known prefixes. The body after the prefix must look random:
// mixed case and digits - transliterated words ("poisk-…"), dictionary chains of lowercase letters
// and placeholders like sk-your-key-here are not caught.
const KEY_FAMILIES = [
  { name: () => msg('board.credentials-zone.family_sk'), re: /\bsk-[A-Za-z0-9_-]{28,}/g, body: 'sk-' },
  { name: () => msg('board.credentials-zone.family_ghp'), re: /\bghp_[A-Za-z0-9]{36,}\b/g },
  { name: () => msg('board.credentials-zone.family_ghpousr'), re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { name: () => msg('board.credentials-zone.family_github_pat'), re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g },
  { name: () => msg('board.credentials-zone.family_akia'), re: /\bAKIA[0-9A-Z]{16}\b/g, check: null }, // the form is given by the expression itself
  { name: () => msg('board.credentials-zone.family_xox'), re: /\bxox[baprs]-[A-Za-z0-9-]{15,}\b/g },
  { name: () => msg('board.credentials-zone.family_glpat'), re: /\bglpat-[A-Za-z0-9_-]{16,}\b/g },
  { name: () => msg('board.credentials-zone.family_aiza'), re: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { name: () => msg('board.credentials-zone.family_gsk'), re: /\bgsk_[A-Za-z0-9]{30,}\b/g },
  { name: () => msg('board.credentials-zone.family_hf'), re: /\bhf_[A-Za-z0-9]{30,}\b/g },
  { name: () => msg('board.credentials-zone.family_npm'), re: /\bnpm_[A-Za-z0-9]{30,}\b/g },
  { name: () => msg('board.credentials-zone.family_pypi'), re: /\bpypi-[A-Za-z0-9_-]{60,}\b/g },
  { name: () => msg('board.credentials-zone.family_eyj'), re: /\beyJ[A-Za-z0-9_-]{40,}\b/g },
];

const PEM_RE = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/g;

// Secret assignments with a high-entropy quoted value (passwords, tokens, keys without a prefix).
const SECRET_ASSIGN_RE =
  /([A-Za-z0-9_.$/-]*(?:password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?key|auth[_-]?token|token|private[_-]?key|client[_-]?secret|credential)[A-Za-z0-9_.$/-]*)\s*[:=]\s*(["'`])([^"'\n]{14,})\2/gi;

// Bearer headers and credentials inside a URL (https://user:pass@host).
const BEARER_RE = /\bBearer\s+([A-Za-z0-9._+/=-]{20,})/g;
const URL_CREDS_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@"]+:[^\s@/"]{6,}@[^\s"']+/g;

// An assignment key that is by nature not a secret: a place reference, a signature, metadata.
const ASSIGN_KEY_NOT_SECRET = /(?:url|uri|hint|label|policy|question|prompt|placeholder|example|mask|format|length|count|budget|per[_-]?minute|per[_-]?hour|type|kind|name)$/i;

// A placeholder value or a reference by name: VARIABLE_NAME, [[name]], ${VAR}, <your-key>, changeme.
const VALUE_IS_REFERENCE =
  /^\$\{[^}]*\}$|^\[\[.*\]\]$|^<[^>]*>$|^[A-Z][A-Z0-9_]*$|^(?:x|\*|\.|#|-|_)+$|process\.env|os\.environ|getenv|changeme|placeholder|your[-_]|insert[-_ ]|example[-_]|dummy|todo|fixme|n\/a|none|null|undefined|teste?[-_]|sk-your/i;

// --- Helpers --------------------------------------------------------------------------------------

/** Shannon entropy, bits per character: a random credential is noticeably above dictionary text. */
function bitsPerChar(s) {
  const freq = new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) || 0) + 1);
  let bits = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

function charClasses(s) {
  return [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(s)).length;
}

/** The body after the prefix looks random: it has both digits and both cases. */
function bodyLooksRandom(body) {
  return /[0-9]/.test(body) && /[A-Z]/.test(body) && /[a-z]/.test(body);
}

/** An assignment value that is not a credential: a reference by name, a placeholder, too dictionary-like, a URL without userinfo. */
function valueIsNotSecret(value) {
  if (VALUE_IS_REFERENCE.test(value)) return true;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !URL_CREDS_RE.test(value)) return true;
  if (bitsPerChar(value) < 3.2) return true;
  if (charClasses(value) < 3) return true;
  return false;
}

/** A credential is not printed in the dossier: a mask with the length. */
function maskValue(s) {
  return s.length <= 8 ? '***' : s.slice(0, 6) + msg('board.credentials-zone.mask_tail', { n: s.length });
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/**
 * A text scan: a list of findings [{ line, family, value (a mask) }]. Catches values only;
 * references by name ([[name]], VARIABLE_NAME, ${VAR}, process.env.X) it does not catch.
 */
function scanText(text) {
  const out = [];
  const seen = new Set();
  const push = (index, family, value) => {
    const key = index + '|' + family;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ line: lineOf(text, index), family, value: maskValue(value) });
  };
  for (const fam of KEY_FAMILIES) {
    fam.re.lastIndex = 0;
    let m;
    while ((m = fam.re.exec(text)) !== null) {
      const matched = m[0];
      if (fam.check !== null) {
        const body = fam.body ? matched.slice(fam.body.length) : matched.replace(/^[^A-Za-z0-9]+/, '');
        if (!bodyLooksRandom(body)) continue; // a dictionary word or a transliteration, not a random body
      }
      push(m.index, fam.name(), matched);
    }
  }
  PEM_RE.lastIndex = 0;
  let m;
  while ((m = PEM_RE.exec(text)) !== null) push(m.index, msg('board.credentials-zone.family_pem'), m[0]);
  SECRET_ASSIGN_RE.lastIndex = 0;
  while ((m = SECRET_ASSIGN_RE.exec(text)) !== null) {
    const key = m[1];
    const value = m[3];
    if (ASSIGN_KEY_NOT_SECRET.test(key)) continue; // url/hint/label and metadata - not a secret
    if (valueIsNotSecret(value)) continue;
    push(m.index, msg('board.credentials-zone.family_assign', { key: key.trim() }), value);
  }
  BEARER_RE.lastIndex = 0;
  while ((m = BEARER_RE.exec(text)) !== null) {
    if (valueIsNotSecret(m[1])) continue;
    push(m.index, msg('board.credentials-zone.family_bearer'), m[1]);
  }
  URL_CREDS_RE.lastIndex = 0;
  while ((m = URL_CREDS_RE.exec(text)) !== null) push(m.index, msg('board.credentials-zone.family_url'), m[0]);
  return out.sort((a, b) => a.line - b.line || a.family.localeCompare(b.family));
}

/** A scan of one file: the allowed places are skipped whole; binary and large - a skip with a mark. */
function scanFile(abs, root) {
  const rel = path.relative(root || path.dirname(abs), abs).split(path.sep).join('/');
  if (isAllowedPlace(rel)) return { findings: [], note: msg('board.credentials-zone.note_allowed', { rel }) };
  let buf;
  try {
    const st = fs.statSync(abs);
    if (st.size > MAX_BYTES) return { findings: [], note: msg('board.credentials-zone.note_too_big', { n: MAX_BYTES }) };
    buf = fs.readFileSync(abs);
  } catch (e) {
    const err = new Error(msg('board.credentials-zone.err_unreadable', { rel, why: e.message }));
    err.exitCode = 2;
    err.code = e.code || 'EREAD';
    throw err;
  }
  if (buf.slice(0, 8192).includes(0)) return { findings: [], note: msg('board.credentials-zone.note_binary') };
  const text = buf.toString('utf8');
  return { findings: scanText(text).map((f) => ({ ...f, file: rel })), note: null };
}

/** The --repo mode: a scan of the tracked files; returns { findings, checked, notes }. */
function runRepo(root) {
  let out;
  try {
    out = require('child_process').execFileSync('git', ['-C', root, 'ls-files', '-z'], { maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    const err = new Error(msg('board.credentials-zone.err_lsfiles', { why: e.message }));
    err.exitCode = 2;
    throw err;
  }
  const files = out.toString('utf8').split('\0').filter(Boolean);
  const findings = [];
  const notes = [];
  let checked = 0;
  for (const rel of files) {
    if (rel.startsWith('node_modules/') || rel === 'node_modules') continue;
    if (rel.startsWith('.forma/protocol/') || rel === '.forma/protocol') continue;
    if (rel.startsWith('.git/')) continue;
    let r;
    try {
      r = scanFile(path.join(root, ...rel.split('/')), root);
    } catch (e) {
      // in the index but not on disk (removed in the working tree) or unreadable - a mark, not a crash
      notes.push(rel + ': ' + msg('board.credentials-zone.note_unreadable', { why: e.code || e.message.split('\n')[0] }));
      continue;
    }
    if (r.note) notes.push(rel + ': ' + r.note);
    else checked++;
    findings.push(...r.findings);
  }
  return { findings, checked, notes };
}

// --- The --wired mode: constructively or by discipline, per engine ---------------------------------

const SCANNER_MARK = 'credentials-zone';
const SCANNER_FILE = 'credentials-zone.cjs';

/** Recursively collects the strings of a hooks JSON config. */
function collectStrings(v, acc) {
  if (typeof v === 'string') acc.push(v);
  else if (Array.isArray(v)) v.forEach((x) => collectStrings(x, acc));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => collectStrings(x, acc));
  return acc;
}

/**
 * A hook proof by the adapter's hooks registry (engineSettings): a registered command
 * names the scanner directly or calls a wrapper script that calls it.
 */
function hookWired(adapter, root) {
  let hooks = [];
  if (typeof adapter.engineSettings === 'function') {
    try {
      const s = adapter.engineSettings(root) || {};
      hooks = Array.isArray(s.hooks) ? s.hooks : [];
    } catch { hooks = []; }
  }
  const checkedWrappers = [];
  for (const h of hooks) {
    const commands = Array.isArray(h && h.commands) ? h.commands : [];
    for (const cmd of commands) {
      if (String(cmd).includes(SCANNER_MARK)) return { wired: true, via: String(cmd) };
      const tokens = String(cmd).match(/[\w./\\-]+\.(?:sh|cjs|js|mjs)/g) || [];
      for (const t of tokens) {
        const cands = [path.join(root, ...t.split(/[\\/]/)), path.join(root, adapter.dir, ...t.split(/[\\/]/))];
        for (const c of cands) {
          let text;
          try { text = fs.readFileSync(c, 'utf8'); } catch { continue; }
          checkedWrappers.push(path.relative(root, c));
          if (text.includes(SCANNER_MARK)) return { wired: true, via: path.relative(root, c) };
        }
      }
    }
  }
  return { wired: false, wrappers: checkedWrappers };
}

/** A discipline proof: the engine's §8 names the scanner (a discipline line, ENGINE-CONTRACT.md). */
function disciplineWired(adapter, root) {
  if (!adapter.engineRulesFile) return false;
  const abs = path.join(root, ...adapter.engineRulesFile.split('/'));
  try { return fs.readFileSync(abs, 'utf8').includes(SCANNER_FILE); } catch { return false; }
}

/** The --wired mode: per engine - a hook or a discipline line. Returns { rows, ready }. */
function runWired(root) {
  const { loadAdapters } = require('../../dashboard/lib/engines.cjs');
  const adapters = loadAdapters(root);
  if (!adapters.length) {
    const err = new Error(msg('board.credentials-zone.err_no_engines'));
    err.exitCode = 2;
    throw err;
  }
  const rows = adapters.map((a) => {
    const id = a.id || String(a.dir).replace(/^\./, '');
    const hook = hookWired(a, root);
    const rules = a.engineRulesFile || null;
    const disc = !hook.wired && disciplineWired(a, root);
    return {
      id,
      rules,
      mode: hook.wired ? msg('board.credentials-zone.mode_hook') : disc ? msg('board.credentials-zone.mode_disc') : null,
      via: hook.wired ? hook.via : disc ? rules : null,
    };
  });
  return { rows, ready: rows.every((r) => r.mode !== null) };
}

// --- The --selftest mode: probes in the OS temp directory ------------------------------------------

function selftest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'credentials-zone-'));
  try {
    const sk = 'sk-proj-Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56Qr78';
    const ghp = 'ghp_Rk9mPq3Lx7Vb2Nw8Jf5Hd1Zs4Gt6Yc0AeUi';
    const pwd = 'Kj9!mQ2#vX7@Lp5$';
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N0UXtuxEBrKfyoBfjbVoww';
    const fixtures = [
      { rel: 'outside/openai-key.txt', text: 'OPENAI_API_KEY=' + sk + '\n', expect: 'caught' },
      { rel: 'outside/github-token.md', text: 'token: ' + ghp + '\n', expect: 'caught' },
      { rel: 'outside/aws.txt', text: 'the key AKIAIOSFODNN7EXAMPLE in the text\n', expect: 'caught' },
      { rel: 'outside/server.pem', text: '-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----\n', expect: 'caught' },
      { rel: 'outside/config.yaml', text: 'password = "' + pwd + '"\n', expect: 'caught' },
      { rel: 'outside/jwt.txt', text: 'Authorization: Bearer ' + jwt + '\n', expect: 'caught' },
      { rel: 'outside/db-url.txt', text: 'access: postgres://admin:S3cr3tP4' + 'ss' + String.fromCharCode(64) + 'db.example' + '.internal:5432/base\n', expect: 'caught' },
      { rel: '.env', text: 'DEEPSEEK_API_KEY=' + sk + '\nAPP_PASSWORD=' + pwd + '\n', expect: 'allowed' },
      {
        rel: 'project/VARS/credentials.md',
        text: '# Test accounts\n\npassword: ' + pwd + '\ntoken: ' + ghp + '\n',
        expect: 'allowed',
      },
      {
        rel: 'outside/refs.md',
        text: [
          '[[smtp-password]] — a reference by name, the value in project/VARS/credentials.md',
          'see [[test-user-1]] (VARS/)',
          'OPENROUTER_API_KEY and DEEPSEEK_API_KEY — variable names (.env)',
          'const apiKey = process.env.OPENAI_API_KEY;',
          'const token = os.environ["MY_ACCESS_TOKEN"];',
          '${DB_PASSWORD} — a substitution by name',
          'VARIABLE_NAME=NOT_A_SECRET',
          'password = "changeme"',
          'api_key = "YOUR_API_KEY_HERE"',
          'token = "sk-your-key-here"',
          'password: "test1234"',
          'access_token_url: "https://auth.example.internal/token"',
          'max_tokens = 4096',
          '-----BEGIN CERTIFICATE-----',
        ].join('\n') + '\n',
        expect: 'clean',
      },
    ];
    const probes = [];
    let ok = true;
    for (const fx of fixtures) {
      const abs = path.join(dir, ...fx.rel.split('/'));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, fx.text);
      let findings;
      try {
        findings = scanFile(abs, dir).findings;
      } catch (e) {
        ok = false;
        probes.push({ fx, ok: false, why: e.message });
        continue;
      }
      const caught = findings.length > 0;
      const good = fx.expect === 'caught' ? caught : !caught;
      if (!good) ok = false;
      probes.push({ fx, ok: good, findings });
    }
    return { ok, probes, dir };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --- CLI -------------------------------------------------------------------------------------------

function printFileFindings(findings) {
  for (const f of findings) {
    console.log('  ' + (f.file ? f.file + ':' : msg('board.credentials-zone.no_file_prefix')) + f.line + ' — ' + f.family + ' — ' + f.value);
  }
}

function main() {
  const argv = process.argv.slice(2);
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 ? path.resolve(argv[rootIdx + 1]) : ROOT_DEFAULT;

  if (argv.includes('--selftest')) {
    const st = selftest();
    for (const p of st.probes) {
      const tag = p.fx.expect === 'caught' ? msg('board.credentials-zone.tag_bait') : p.fx.expect === 'allowed' ? msg('board.credentials-zone.tag_allowed') : msg('board.credentials-zone.tag_refs');
      if (p.ok) {
        const fam = p.findings && p.findings.length ? ' (' + p.findings[0].family + ')' : '';
        console.log('✓ ' + p.fx.rel + ' — ' + tag + ' — ' + msg('board.credentials-zone.as_expected') + fam);
      } else {
        console.log('✗ ' + p.fx.rel + ' — ' + tag + ' — ' + msg('board.credentials-zone.probe_failed') + (p.why ? ': ' + p.why : ''));
      }
    }
    const caught = st.probes.filter((p) => p.fx.expect === 'caught').length;
    const passed = st.probes.filter((p) => p.ok).length;
    if (st.ok) {
      console.log(msg('board.credentials-zone.selftest_green', { n: caught, total: st.probes.length }));
      process.exit(0);
    }
    console.log(msg('board.credentials-zone.selftest_red', { n: passed, total: st.probes.length }));
    process.exit(1);
  }

  if (argv.includes('--repo')) {
    const r = runRepo(root);
    console.log(msg('board.credentials-zone.checked_line', { n: r.checked, notes: r.notes.length ? msg('board.credentials-zone.skipped_part', { n: r.notes.length, list: r.notes.slice(0, 5).join('; ') }) : '' }));
    if (r.findings.length) {
      console.log(msg('board.credentials-zone.findings_header', { n: r.findings.length }));
      printFileFindings(r.findings);
      console.log(msg('board.credentials-zone.repo_red', { n: r.findings.length }));
      process.exit(1);
    }
    console.log(msg('board.credentials-zone.repo_clean'));
    process.exit(0);
  }

  const fileIdx = argv.indexOf('--file');
  if (fileIdx >= 0) {
    const target = path.resolve(argv[fileIdx + 1] || '');
    if (!argv[fileIdx + 1]) {
      console.error(msg('board.stop') + msg('board.credentials-zone.err_file_path'));
      process.exit(2);
    }
    let r;
    try {
      r = scanFile(target, root);
    } catch (e) {
      console.error(msg('board.stop') + e.message);
      process.exit(e.exitCode || 2);
    }
    if (r.note) {
      console.log(msg('board.credentials-zone.file_clean', { note: r.note }));
      process.exit(0);
    }
    if (r.findings.length) {
      console.log(msg('board.credentials-zone.findings_header', { n: r.findings.length }));
      printFileFindings(r.findings);
      console.log(msg('board.credentials-zone.file_red', { rel: path.relative(root, target).split(path.sep).join('/') }));
      process.exit(1);
    }
    console.log(msg('board.credentials-zone.file_clean_ok', { rel: path.relative(root, target).split(path.sep).join('/') }));
    process.exit(0);
  }

  if (argv.includes('--wired')) {
    let r;
    try {
      r = runWired(root);
    } catch (e) {
      console.error(msg('board.stop') + e.message);
      process.exit(e.exitCode || 2);
    }
    for (const row of r.rows) {
      if (row.mode) console.log('✓ ' + row.id + ' — ' + row.mode + ' (' + row.via + ')');
      else console.log('✗ ' + row.id + ' — ' + msg('board.credentials-zone.wired_uncovered', { rules: row.rules || msg('board.credentials-zone.wired_no_rules') }));
    }
    if (r.ready) {
      console.log(msg('board.credentials-zone.wired_green', { list: r.rows.map((x) => x.id).join(', ') }));
      process.exit(0);
    }
    console.log(msg('board.credentials-zone.wired_red'));
    process.exit(1);
  }

  console.error(msg('board.credentials-zone.usage'));
  process.exit(2);
}

module.exports = { scanText, scanFile, runRepo, runWired, selftest, isAllowedPlace, bitsPerChar, maskValue };

if (require.main === module) main();
