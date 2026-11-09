'use strict';

// English-only gate for executable code of the template's clean zones. The law (prohibition 19) states the
// rule in one line; this file holds it: the machine finds Cyrillic in executable code and paints the build.
//
// Scanned: executable extensions (*.cjs, *.js, *.mjs, *.ps1, *.sh, *.py) and skill bodies (files named
// exactly SKILL.md) under skills/, scripts/, bin/, test/ of the repository root (nearest .git upward from
// this file).
// Never scanned: other *.md (the law, roles, notes), the core dictionary data (skills/forma/core/i18n/),
// fixture and golden paths (fixture text is data, not code), node_modules, .git, .github.
//
// Modes:
//   no args     full run: files of zones named in "allowList" (the data file next to this script) are
//               skipped, everything else is strict; findings give exit 1. Zone waves empty the allow-list
//               zone by zone as their translation lands.
//   --zone N    only files of zone N, allow-list ignored - how a zone card checks its own zone.
//   --selftest  built-in mini fixtures; PASS gives exit 0.
//
// Exit codes: 0 clean, 1 findings or selftest mismatch, 2 bad usage. A finding prints as path:line: text;
// the last stdout line is the summary. Zone assignments live in the data file - refill it, not this script.
// Part of the core: carries no project traces (clean-zone rule).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { walk, readJson } = require('../../dashboard/lib/fs.cjs');

const ZONES_FILE = 'check-english-code.zones.json';
const ROOTS = ['skills', 'scripts', 'bin', 'test'];
const EXT = /\.(?:cjs|js|mjs|ps1|sh|py)$/i;
// Skill bodies: any file named exactly SKILL.md is scanned as text (zone "skill-md"), like code.
const SKILL_MD = 'SKILL.md';
// Cyrillic blocks: Cyrillic, Supplement, Extended-A, Extended-B, Extended-C.
const CYRILLIC = /[\u0400-\u04FF\u0500-\u052F\u2DE0-\u2DFF\uA640-\uA69F\u1C80-\u1C8F]/;
// Directories never entered: dependencies, git plumbing, CI definitions, fixture text.
const SKIP_DIRS = new Set(['node_modules', '.git', '.github', 'fixture', 'fixtures', 'golden']);
// Dictionary data of the core (ru labels) - data, not code.
const I18N_DIR = 'forma/core/i18n';

/** Nearest ancestor holding .git - the repository root; null when none. */
function repoRoot(from) {
  let dir = from;
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** One-segment glob prefix (a star as one path segment, e.g. the adapter hooks dirs) against a slash path. */
function globPrefixMatches(rel, pattern) {
  const segs = pattern.split('/').filter((s) => s !== '');
  const parts = rel.split('/');
  if (parts.length < segs.length) return false;
  return segs.every((seg, i) => seg === '*' || seg === parts[i]);
}

/** Basename patterns like "*spend*" against a file name. */
function nameMatches(name, patterns) {
  const asRegex = (p) => new RegExp('^' + p.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return patterns.some((p) => asRegex(p).test(name));
}

/** Zone of a slash path by the data file's matchers, in file order; a "rest" zone catches only the leftover. */
function zoneOf(rel, zones) {
  if (!zones) return null;
  let leftover = null;
  for (const [name, z] of Object.entries(zones)) {
    if (z.rest) { if (!leftover) leftover = name; continue; }
    if ((z.prefixes || []).some((p) => rel.startsWith(p))) return name;
    if ((z.prefixGlobs || []).some((p) => globPrefixMatches(rel, p))) return name;
    if ((z.files || []).includes(rel)) return name;
    if ((z.names || []).length && nameMatches(rel.split('/').pop(), z.names)) return name;
  }
  return leftover;
}

/**
 * Scan one repository root. o.zones: config object or null (undefined - read the data file next to this
 * script). o.onlyZone: strict scan of a single zone, allow-list ignored. Findings carry rel, line, text.
 */
function scan(root, o = {}) {
  const zones = o.zones === undefined ? readJson(path.join(__dirname, ZONES_FILE), null) : o.zones;
  const allow = new Set(zones && zones.allowList ? zones.allowList : []);
  const files = [];
  let skipped = 0;
  for (const top of ROOTS) {
    const dir = path.join(root, top);
    if (!fs.existsSync(dir)) continue;
    const rels = walk(dir, {
      symlinks: true,
      skip: (e, r) => e.isDirectory() && (SKIP_DIRS.has(e.name) || (top === 'skills' && r === I18N_DIR)),
    });
    for (const rel of rels) {
      const relPath = top + '/' + rel;
      if (!EXT.test(relPath) && rel.split('/').pop() !== SKILL_MD) continue;
      const zone = zoneOf(relPath, zones && zones.zones);
      if (o.onlyZone ? zone !== o.onlyZone : Boolean(zone && allow.has(zone))) { skipped++; continue; }
      files.push(relPath);
    }
  }
  const findings = [];
  for (const rel of files) {
    let text;
    try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; } // vanished mid-walk
    const lines = text.split(/\r\n|\r|\n/);
    for (let i = 0; i < lines.length; i++) {
      if (CYRILLIC.test(lines[i])) findings.push({ rel, line: i + 1, text: lines[i].trim() });
    }
  }
  return { findings, scanned: files.length, skipped };
}

/** Board registry form: findings as strings, empty when clean. */
function run(ctx) {
  return scan(ctx.root, {}).findings.map((f) => `${f.rel}:${f.line}: ${f.text}`);
}

module.exports = { id: 'check-english-code', since: null, run };

function printFindings(res) {
  for (const f of res.findings) console.log(`${f.rel}:${f.line}: ${f.text}`);
}

function summarize(res, label) {
  const nFiles = new Set(res.findings.map((f) => f.rel)).size;
  return `${label}: ${res.findings.length} finding(s) in ${nFiles} file(s); ` +
    `${res.scanned} file(s) scanned, ${res.skipped} skipped by allow-list`;
}

function main(argv) {
  if (argv.includes('--selftest')) return selftest();
  const root = repoRoot(__dirname);
  if (!root) { console.error('check-english-code: repository root not found (no .git upward from the gate)'); return 2; }
  const zones = readJson(path.join(__dirname, ZONES_FILE), null);
  const zi = argv.indexOf('--zone');
  if (zi !== -1) {
    const zone = argv[zi + 1];
    if (!zone || argv.length !== zi + 2) { console.error('usage: node check-english-code.cjs --zone <name>'); return 2; }
    if (!zones || !zones.zones || !(zone in zones.zones)) {
      console.error(`check-english-code: unknown zone "${zone}" - zone names live in ${ZONES_FILE}`);
      return 2;
    }
    const res = scan(root, { zones, onlyZone: zone });
    printFindings(res);
    console.log(summarize(res, `check-english-code zone "${zone}"`));
    return res.findings.length ? 1 : 0;
  }
  if (argv.length) { console.error('usage: node check-english-code.cjs [--zone <name> | --selftest]'); return 2; }
  const res = scan(root, { zones });
  printFindings(res);
  console.log(summarize(res, 'check-english-code'));
  return res.findings.length ? 1 : 0;
}

// Mini fixtures for the selftest are written through ASCII escapes: the gate's own file must stay free of
// Cyrillic (it sits in a scanned zone itself and guards itself too), while the fixture strings at runtime
// are real Cyrillic.
const WORD = '\u0441\u043b\u043e\u0432\u043e'; // "slovo" in Cyrillic letters
const COMMENT = '\u043a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0439';
const TEXT = '\u0442\u0435\u043a\u0441\u0442';

function makeTree(dir) {
  const put = (rel, body) => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, 'utf8');
  };
  put('scripts/clean.cjs', 'const one = 1; // plain ascii\n');
  put('scripts/bad.js', `const tag = 1; // ${COMMENT}\n`);
  put('scripts/nested/deep.mjs', `export const word = "${TEXT}";\n`);
  put('scripts/fixtures/bad.py', `label = "${WORD}"\n`);
  put('scripts/golden/ref.sh', `echo "${WORD}"\n`);
  put('skills/forma/core/i18n/messages/ru.cjs', `// ${WORD}\n`);
  put('scripts/README.md', `# ${WORD}\n`);
  put('scripts/skills/inner/SKILL.md', `# ${TEXT}\n`);
  put('scripts/node_modules/pkg/x.cjs', `// ${WORD}\n`);
  put('scripts/.github/wf.js', `// ${WORD}\n`);
  put('bin/tool.sh', `echo "${WORD}"\n`);
  put('scripts/install.cjs', `// ${WORD}\n`);
  put('test/sample.test.cjs', `// ${WORD}\n`);
}

function scanAssertions(failures, dir) {
  const expect = (cond, msg) => { if (!cond) failures.push(msg); };
  // No zones data: everything strict; only data paths (non-skill md, dictionary, fixtures, golden, deps, CI)
  // escape; a SKILL.md body counts as scanned text.
  let r = scan(dir, { zones: null });
  expect(r.skipped === 0, `no-zones run: skipped ${r.skipped}, expected 0`);
  expect(r.scanned === 7, `no-zones run: scanned ${r.scanned}, expected 7`);
  expect(r.findings.length === 6, `no-zones run: findings ${r.findings.length}, expected 6`);
  const rels = r.findings.map((f) => f.rel).sort().join(',');
  expect(rels ===
    'bin/tool.sh,scripts/bad.js,scripts/install.cjs,scripts/nested/deep.mjs,scripts/skills/inner/SKILL.md,test/sample.test.cjs',
    `no-zones run: files ${rels}`);
  expect(r.findings.every((f) => f.line === 1 && f.text.length > 0), 'no-zones run: finding lacks line or text');
  // Allow-list as data: the "tests-fixtures" zone (test/) is skipped in the full run.
  const zones = { allowList: ['tests-fixtures'], zones: { 'tests-fixtures': { prefixes: ['test/'] } } };
  r = scan(dir, { zones });
  expect(r.scanned === 6 && r.skipped === 1, `allow-list run: scanned ${r.scanned}, skipped ${r.skipped}`);
  expect(!r.findings.some((f) => f.rel.startsWith('test/')), 'allow-list run: test/ still reported');
  // Zone matchers: basename patterns, prefixes, one-segment glob, exact files, catch-all rest. "skill-md"
  // sits first on purpose: its SKILL.md name must win over the adapter/installer prefixes.
  const cfg = {
    'skill-md': { names: ['SKILL.md'] },
    'board-core': { prefixes: ['skills/forma/core/board/'] },
    'hooks-spend': { prefixGlobs: ['skills/forma/adapters/*/hooks/'], names: ['*spend*', '*ledger*'] },
    'adapters-installers': { prefixes: ['skills/forma/adapters/'], files: ['scripts/scaffold-engine.cjs'], names: ['*gen-roles*'] },
    'tests-fixtures': { prefixes: ['test/'] },
    'skill-scripts': { rest: true },
  };
  const cases = [
    ['skills/forma/adapters/claude/skills/x/SKILL.md', 'skill-md'],
    ['skills/forma/SKILL.md', 'skill-md'],
    ['skills/forma/core/board/x.cjs', 'board-core'],
    ['skills/forma/core/other/x.cjs', 'skill-scripts'],
    ['skills/forma/adapters/claude/hooks/h.cjs', 'hooks-spend'],
    ['skills/forma/adapters/claude/other/h.cjs', 'adapters-installers'],
    ['scripts/ledger-parity.cjs', 'hooks-spend'],
    ['scripts/scaffold-engine.cjs', 'adapters-installers'],
    ['scripts/gen-roles-x.cjs', 'adapters-installers'],
    ['test/a.test.cjs', 'tests-fixtures'],
    ['bin/forma.cjs', 'skill-scripts'],
  ];
  for (const [rel, want] of cases) {
    expect(zoneOf(rel, cfg) === want, `zone of ${rel}: ${zoneOf(rel, cfg)}, expected ${want}`);
  }
  // The gate guards itself: its own file stays free of Cyrillic.
  expect(!CYRILLIC.test(fs.readFileSync(__filename, 'utf8')), 'self-scan: the gate file itself carries Cyrillic');
}

function selftest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-english-code-selftest-'));
  const failures = [];
  try {
    makeTree(dir);
    scanAssertions(failures, dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (failures.length) {
    console.error(`check-english-code selftest: FAIL (${failures.length})`);
    for (const f of failures) console.error(`  - ${f}`);
    return 1;
  }
  console.log('check-english-code selftest: PASS');
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
