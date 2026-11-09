// The language layer: keys are read by an anchor or by the dictionary, messages come from the catalog,
// English is the fallback. The ru document, the ru labels and the delete-guard code phrase below are
// byte-identical data from ASCII source through unicode escapes - they are the test's subject, not code.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const I18N = path.resolve(__dirname, '..', 'skills', 'forma', 'core', 'i18n');
const i18n = require(path.join(I18N, 'index.cjs'));
const checks = require(path.join(I18N, 'project-checks.cjs'));

const RU_DIC = require(path.join(I18N, 'messages', 'ru.json'));

const D = {
  project: '\u041f\u0440\u043e\u0435\u043a\u0442',
  langLine: '**\u042f\u0437\u044b\u043a \u043f\u0440\u043e\u0435\u043a\u0442\u0430**: \u0440\u0443\u0441\u0441\u043a\u0438\u0439',
  thresholds: '**\u041f\u043e\u0440\u043e\u0433\u0438**',
  nameRow: '| \u0418\u043c\u044f | \u0417\u043d\u0430\u0447\u0435\u043d\u0438\u0435 |',
  attemptsRow: '| \u0417\u0430\u0445\u043e\u0434\u043e\u0432 \u043d\u0430 \u0437\u0430\u0434\u0430\u0447\u0443 | 3 |',
  volumeRow: '| \u041e\u0431\u044a\u0451\u043c \u0446\u0438\u043a\u043b\u0430 | 5 |',
  russian: '\u0440\u0443\u0441\u0441\u043a\u0438\u0439',
  russkiyCap: '\u0420\u0443\u0441\u0441\u043a\u0438\u0439',
  volumeNotSet: '| \u041e\u0431\u044a\u0451\u043c \u0446\u0438\u043a\u043b\u0430 | \u043d\u0435 \u0437\u0430\u0434\u0430\u043d |',
  thresholdsRu: '\u041f\u041e\u0420\u041e\u0413\u0418|\u043f\u043e\u0440\u043e\u0433|\u0421\u0422\u041e\u041f',
  stopStart: '\u0421\u0422\u041e\u041f \u0421\u0422\u0410\u0420\u0422\u0410',
  codePhrase: '"\u041e\u0442\u043a\u043b\u044e\u0447\u0438 \u0441\u0435\u043d\u0441\u043e\u0440\u0438\u043a\u0443"'
};

const EN = `# Project

**Project language** <!-- k:language -->: English

**Thresholds** <!-- k:thresholds -->

| Name <!-- k:name --> | Value |
| --- | --- |
| Attempts <!-- k:attempts --> | 3 |
| Cycle volume <!-- k:volume --> | not set |
`;
const RU = `# ${D.project}

${D.langLine}

${D.thresholds}

${D.nameRow}
| --- | --- |
${D.attemptsRow}
${D.volumeRow}
`;
const FR = `# Projet

**Langue du projet** <!-- k:language -->: français

**Seuils** <!-- k:thresholds -->

| Nom <!-- k:name --> | Valeur |
| --- | --- |
| Tentatives <!-- k:attempts --> | 3 |
| Volume du cycle <!-- k:volume --> | 5 |
`;

const project = (md) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-i18n-'));
  fs.mkdirSync(path.join(dir, 'project', 'config'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'project', 'config', 'PROJECT.md'), md);
  return dir;
};
const cli = (dir, ...args) => spawnSync(process.execPath, [path.join(I18N, 'cli.cjs'), ...args, '--root', dir], { encoding: 'utf8', env: { ...process.env, FORMA_LANG: '' } });

test('the anchor outranks the label: the French document reads without an fr catalog', () => {
  const r = i18n.reader(FR);
  assert.equal(r.inline('language'), 'français');
  const t = r.table('thresholds');
  assert.equal(i18n.rowValue(t, 'attempts'), '3');
  assert.equal(i18n.rowValue(t, 'volume'), '5');
});

test('a document without anchors reads by the dictionary (ru)', () => {
  const r = i18n.reader(RU);
  assert.equal(r.inline('language'), D.russian);
  const t = r.table('thresholds');
  assert.equal(i18n.rowValue(t, 'attempts'), '3');
  assert.equal(i18n.rowValue(t, 'volume'), '5');
});

test('langCode: a name, a code, an unknown language', () => {
  assert.equal(i18n.langCode(D.russkiyCap), 'ru');
  assert.equal(i18n.langCode('en'), 'en');
  assert.equal(i18n.langCode('fr'), 'fr');
  assert.equal(i18n.langCode('français'), null);
  assert.equal(i18n.langCode(''), null);
});

test('message: the language catalog, the English fallback, then the code itself', () => {
  assert.equal(i18n.message('ready.notes_header', { n: 2 }, 'ru'), RU_DIC['ready.notes_header'].replace('{n}', '2'));
  assert.equal(i18n.message('ready.notes_header', { n: 2 }, 'fr'), 'Unchecked items: 2');
  assert.equal(i18n.message('no.such.code', {}, 'en'), 'no.such.code');
});

test('the output language: the project field, FORMA_LANG overrides', () => {
  const ru = project(RU), fr = project(FR), en = project(EN);
  try {
    assert.equal(i18n.projectLang(ru), 'ru');
    assert.equal(i18n.projectLang(fr), 'en');
    assert.equal(i18n.projectLang(en), 'en');
    assert.equal(cli(ru, 'lang').stdout.trim(), 'ru');
    const forced = spawnSync(process.execPath, [path.join(I18N, 'cli.cjs'), 'lang', '--root', ru], { encoding: 'utf8', env: { ...process.env, FORMA_LANG: 'en' } });
    assert.equal(forced.stdout.trim(), 'en');
  } finally { for (const d of [ru, fr, en]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('the thresholds check does not depend on the label language', () => {
  const dirs = { en: project(EN), ru: project(RU.replace(D.volumeRow, D.volumeNotSet)), fr: project(FR.replace('| Volume du cycle <!-- k:volume --> | 5 |', '| Volume du cycle <!-- k:volume --> | not set |')) };
  try {
    for (const [lang, dir] of Object.entries(dirs)) {
      assert.ok(checks.readyNotes(dir).some((n) => n.code === 'ready.thresholds_incomplete'), lang);
      assert.ok(checks.startGate(dir).some((n) => n.code === 'gate.thresholds'), lang);
    }
    assert.match(cli(dirs.ru, 'gate').stdout, new RegExp(D.thresholdsRu, 'i'));
    assert.match(cli(dirs.fr, 'gate').stdout, /both thresholds must be set/);
  } finally { for (const d of Object.values(dirs)) fs.rmSync(d, { recursive: true, force: true }); }
});

test('filled thresholds: the thresholds stop does not fire in either language', () => {
  for (const md of [RU, FR]) {
    const dir = project(md);
    try { assert.ok(!checks.startGate(dir).some((n) => n.code === 'gate.thresholds')); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('message catalogs: every language has the same codes as English', () => {
  const dir = path.join(I18N, 'messages');
  const en = Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'en.json'), 'utf8'))).filter((k) => !k.startsWith('_'));
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const keys = Object.keys(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))).filter((k) => !k.startsWith('_'));
    assert.deepEqual(keys.sort(), [...en].sort(), f);
  }
});

test('the installer: i18n delivered, the template with anchors', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-i18n-init-'));
  const forma = path.resolve(__dirname, '..', 'bin', 'forma.cjs');
  const init = () => spawnSync(process.execPath, [forma, 'init', '--dir', dir, '--engines', 'claude', '--board', 'skip', '--lang', 'en', '--yes'], { encoding: 'utf8' });
  try {
    const first = init();
    assert.equal(first.status, 0, first.stdout + first.stderr);
    assert.ok(fs.existsSync(path.join(dir, '.forma', 'i18n', 'index.cjs')));
    const file = path.join(dir, 'project', 'config', 'PROJECT.md');
    assert.match(fs.readFileSync(file, 'utf8'), /<!-- k:thresholds -->/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('hooks: the same stop on the en, ru and French document; the output - the project language, English fallback', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-i18n-hook-'));
  const forma = path.resolve(__dirname, '..', 'bin', 'forma.cjs');
  const r = spawnSync(process.execPath, [forma, 'init', '--dir', dir, '--engines', 'claude', '--board', 'skip', '--lang', 'en', '--yes'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const file = path.join(dir, 'project', 'config', 'PROJECT.md');
  const original = fs.readFileSync(file, 'utf8');
  const bashCmd = process.platform === 'win32' && fs.existsSync('C:\\Program Files\\Git\\bin\\bash.exe')
    ? 'C:\\Program Files\\Git\\bin\\bash.exe'
    : 'bash';
  const hook = (name, input) => spawnSync(bashCmd, [path.join(dir, '.claude', 'hooks', name)], { cwd: dir, encoding: 'utf8', input, env: { ...process.env, CLAUDE_PROJECT_DIR: dir, FORMA_LANG: '' } });
  try {
    assert.match(hook('check-ready.sh').stdout, /START STOP/);

    fs.writeFileSync(file, original.replace(/(\*\*Project language\*\*[^\n]*?\)\*?:\s*)English\./, '$1' + D.russkiyCap + '.'));
    assert.match(hook('check-ready.sh').stdout, new RegExp(D.stopStart));

    fs.writeFileSync(file, original.replace(/(\*\*Project language\*\*[^\n]*?\)\*?:\s*)English\./, '$1français.').replace('**Thresholds**', '**Seuils**').replace('| Attempts per task', '| Tentatives par tâche'));
    assert.match(hook('check-ready.sh').stdout, /START STOP/);

    // the reason of a blocked delete: the project language, and the code phrase stays literal in both
    const reason = spawnSync(process.execPath, [path.join(dir, '.forma', 'i18n', 'cli.cjs'), 'msg', 'hook.delete_blocked', 'cmd=rm x', '--root', dir], { encoding: 'utf8', env: { ...process.env, FORMA_LANG: 'en' } }).stdout;
    assert.match(reason, new RegExp('Blocked by the guard-delete hook.*(rm x).*' + D.codePhrase));
  } finally { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp cleanup is best-effort: Windows ACLs can refuse it */ } }
});

test('the installer: --lang accepts a code without a catalog and reports the English hooks; a junk code is rejected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-i18n-lang-'));
  const forma = path.resolve(__dirname, '..', 'bin', 'forma.cjs');
  const init = (lang) => spawnSync(process.execPath, [forma, 'init', '--dir', dir, '--engines', 'claude', '--board', 'skip', '--lang', lang, '--yes'], { encoding: 'utf8' });
  try {
    const fr = init('fr');
    assert.equal(fr.status, 0, fr.stdout + fr.stderr);
    assert.match(fr.stdout, /no message catalog for "fr": hook messages stay English/);
    assert.match(fs.readFileSync(path.join(dir, 'project', 'config', 'PROJECT.md'), 'utf8'), /\*\*Project language\*\* <!-- k:language -->[^\n]*\bfr\./);
    assert.notEqual(init(D.russian).status, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
