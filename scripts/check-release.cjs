#!/usr/bin/env node
// The pre-release check: what goes into the plugin's release must carry no project traces (prohibition 16:
// card codes, dates, site names - neither in files nor in commit messages) and no carry-over corruptions
// (a prose word or a piece of a foreign path turned into a `.forma/...` path), while the tests and the linter stay green.
//   node scripts/check-release.cjs [--no-tests]   - from the protocol clone's root; exit code 1 - no release
//   node scripts/check-release.cjs --traces        - project traces in files only (the clone's pre-commit hook)
//   node scripts/check-release.cjs --message <file> - project traces in a commit message only (the commit-msg hook)
//   node scripts/check-release.cjs --prepush       - traces in files and in the messages of unpushed commits (the pre-push hook)
// forma-commit.cjs --release calls it before merging dev -> main; the same scanner runs test/release-check.test.cjs.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { gitOut } = require('./lib/git.cjs');
const i18n = require('../skills/forma/core/i18n/index.cjs');
const tr = (code, params) => i18n.message(code, params, 'ru');

const DIRS = 'board|dashboard|living|manual|protocol|skills|templates';
// Carry-over corruption: a `.forma/...` path amid a foreign path or word, a double root, a possessive or keyed form.
const RULES = [
  { id: 'mid-path', re: new RegExp(String.raw`[A-Za-z0-9_-]/\.forma/(${DIRS})\b`), why: tr('rel.why_mid_path') },
  { id: 'double-root', re: /\.forma\/protocol\/\.forma\//, why: tr('rel.why_double_root') },
  { id: 'prose', re: new RegExp(String.raw`\.forma/(${DIRS})(?::|'s|/(?:tools|blocks|connectors)\b)`), why: tr('rel.why_prose_path') },
];
// Project traces. Test stubs and schema examples - card-001...009, card-099, goal-00...09 - are not traces.
const TRACES = [
  { id: 'card-code', re: /\bcard-(?!00[1-9]\b|099\b)\d{3}\b/i, why: tr('rel.why_card_code') },
  { id: 'card-word', re: /(?:\u043a\u0430\u0440\u0442\u043e\u0447\u043a\p{L}*|\bcard)\s*№?\s*\d{2,3}\b/iu, why: tr('rel.why_card_word') },
  { id: 'goal-code', re: /\bgoal-[1-9]\d\b/i, why: tr('rel.why_goal_code') },
  { id: 'attempt', re: /\u043f\u043e\u043f\u044b\u0442\u043a\p{L}*\s+\d|attempt\s+\d/iu, why: tr('rel.why_attempt') },
  { id: 'criterion', re: /\u043a\u0440\u0438\u0442\u0435\u0440\u0438\p{L}*\s+\d|criterion\s+\d/iu, why: tr('rel.why_criterion') },
  { id: 'site', re: /iamforma\.pro|yaforma|formacraft/i, why: tr('rel.why_site'), files: /^(?!README(\.ru)?\.md$)/ }, // except README: links to the official community sites
  { id: 'connector', re: /mcp__novamira-[a-z0-9]+(?:-[a-z0-9]+)*__/i, why: tr('rel.why_connector') },
  // except CHANGELOG.md: the version history is published by design, its dates are its substance, not a project trace
  { id: 'date', re: /\b20\d\d-\d\d-\d\d\b/, why: tr('rel.why_date'), files: /^(?!test\/)(?!CHANGELOG\.md$)/ },
];
// The project's own site names: the `mcp__novamira-<slug>` connector slugs and the domains from curl rules in the project's
// Claude Code settings (the clone lives in <project>/.forma/protocol). No file, or the clone outside a project - an empty list.
function projectSiteNames(dir) {
  const names = new Set();
  for (const rel of ['.claude/settings.json', '.claude/settings.local.json']) {
    let text; try { text = fs.readFileSync(path.join(dir, '..', '..', rel), 'utf8'); } catch { continue; }
    for (const m of text.matchAll(/mcp__novamira-([a-z0-9-]+)/g)) if (m[1].length >= 4 && m[1] !== 'hq') names.add(m[1]);
    for (const m of text.matchAll(/curl(?:\.exe)? [^"]*?\*?([a-z0-9-]+\.[a-z]{2,})\*?/gi)) names.add(m[1].toLowerCase());
  }
  return [...names];
}

const TEXT = /\.(md|json|cjs|js|sh|toml|html|css|txt|yml|yaml)$/i;
const SKIP = /(^|\/)(node_modules|archive)\//;
const SELF = /^(scripts\/check-release\.cjs|test\/release-check\.test\.cjs)$/;

function files(dir) {
  return gitOut(dir, 'ls-files', '-z').split('\0').filter((rel) => rel && TEXT.test(rel) && !SKIP.test(rel) && !SELF.test(rel));
}

function scan(dir, rules, skip) {
  const found = [];
  for (const rel of files(dir)) {
    if (skip && skip.test(rel)) continue;
    let text; try { text = fs.readFileSync(path.join(dir, rel), 'utf8'); } catch { continue; }
    text.split(/\r?\n/).forEach((line, i) => {
      for (const r of rules) if ((!r.files || r.files.test(rel)) && r.re.test(line)) found.push({ file: rel, line: i + 1, rule: r.id, why: r.why, text: line.trim().slice(0, 140) });
    });
  }
  return found;
}

/** Corruption traces in the tracked text files of the clone `dir`: [{ file, line, rule, text }]. */
const scanCorruption = (dir) => scan(dir, RULES, /^test\//);

/** Project traces in the tracked text files of the clone `dir`: [{ file, line, rule, why, text }]. */
const scanTraces = (dir) => {
  const own = projectSiteNames(dir).map((n) => ({ id: 'site-name', re: new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), why: tr('rel.why_site_name') }));
  return scan(dir, TRACES.concat(own));
};

/** Project traces in commit messages: [{ message, rule, why }]. Dates in a message are allowed. */
function scanMessages(messages) {
  const found = [];
  for (const m of messages) if (/[\u0410-\u042f\u0430-\u044f\u0401\u0451]/.test(m)) found.push({ message: m.split('\n')[0].slice(0, 100), rule: 'language', why: 'protocol commit messages are English only (AGENTS.md, prohibition 18)' });
  for (const m of messages) if (/\b\d+\s+cards?\b/i.test(m)) found.push({ message: m.split('\n')[0].slice(0, 100), rule: 'card-count', why: tr('rel.why_card_count') });
  for (const m of messages) for (const r of TRACES) if (r.id !== 'date' && r.re.test(m)) found.push({ message: m.split('\n')[0].slice(0, 100), rule: r.id, why: r.why });
  return found;
}

function stopTraces(fileHits, msgHits) {
  console.error(tr('rel.stop_traces'));
  for (const b of fileHits.slice(0, 40)) console.error(`  ${b.file}:${b.line} [${b.rule}: ${b.why}] ${b.text}`);
  for (const b of msgHits) console.error(tr('rel.commit_hit', b));
  process.exit(1);
}

/** The release versions agree: .claude-plugin/plugin.json = package.json = package-lock.json (the top
 *  level and the packages[''] entry). A release that bumps only one of the three must not ship - the
 *  disagreement stops the release, fail-closed. */
function versionStop(dir) {
  const file = path.join(dir, 'package-lock.json');
  let lock = null;
  try { lock = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const versions = {
    plugin: (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), 'utf8')).version; } catch { return null; } })(),
    package: (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version; } catch { return null; } })(),
    lock: lock ? lock.version : null,
    lockRoot: lock && lock.packages && lock.packages[''] ? lock.packages[''].version : null,
  };
  if (versions.plugin && versions.plugin === versions.package && versions.package === versions.lock && (versions.lockRoot === null || versions.lockRoot === versions.package)) return;
  console.error(tr('rel.versions_mismatch', { plugin: versions.plugin, pkg: versions.package, lock: versions.lock }));
  process.exit(1);
}

function main() {
  const dir = path.join(__dirname, '..');
  const argv = process.argv.slice(2);
  if (argv.includes('--message')) {
    const bad = scanMessages([fs.readFileSync(argv[argv.indexOf('--message') + 1], 'utf8')]);
    if (bad.length) stopTraces([], bad);
    return;
  }
  const prepush = argv.includes('--prepush');
  if (prepush || argv.includes('--traces')) {
    const msgs = prepush
      ? gitOut(dir, 'log', '--format=%B%x1e', 'HEAD', '--not', '--remotes=origin').split('\x1e').map((m) => m.trim()).filter(Boolean) : [];
    const f = scanTraces(dir), m = scanMessages(msgs);
    if (f.length || m.length) stopTraces(f, m);
    console.log(tr('rel.no_traces'));
    return;
  }
  const traces = scanTraces(dir);
  if (traces.length) stopTraces(traces, []);
  console.log(tr('rel.no_traces'));
  versionStop(dir);
  const bad = scanCorruption(dir);
  if (bad.length) {
    console.error(tr('rel.stop_corruption', { n: bad.length }));
    for (const b of bad.slice(0, 40)) console.error(`  ${b.file}:${b.line} [${b.rule}: ${b.why}] ${b.text}`);
    process.exit(1);
  }
  console.log(tr('rel.no_corruption'));
  if (argv.includes('--no-tests')) return;
  for (const [label, args] of [[tr('rel.label_tests'), ['test']], [tr('rel.label_lint'), ['run', 'lint']]]) {
    const r = spawnSync('npm', args, { cwd: dir, encoding: 'utf8', shell: true });
    if (r.status) {
      const lines = (r.stdout + r.stderr).split(/\r?\n/);
      // Red tests - by their names and count, not by the tail of the output: the tail undercounts them.
      const names = [...new Set(lines.filter((l) => /^\s*✖\s/.test(l) && !/failing tests/.test(l)).map((l) => l.trim().replace(/\s*\([\d.]+ms\)$/, '')))];
      const summary = lines.filter((l) => /^ℹ (tests|pass|fail|skipped) /.test(l));
      const head = label === tr('rel.label_tests') && names.length ? tr('rel.tests_head', { n: names.length, names: names.slice(0, 60).join('\n'), summary: summary.join('\n') }) : '';
      console.error(tr('rel.checks_red', { label, head, tail: lines.slice(-25).join('\n') }));
      process.exit(1);
    }
    console.log(tr('rel.checks_green', { label }));
  }
}

if (require.main === module) main();
module.exports = { scanCorruption, RULES, scanTraces, scanMessages, TRACES, projectSiteNames };
