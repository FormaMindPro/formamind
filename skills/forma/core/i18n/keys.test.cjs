// Dictionary of machine keys: every key is English, every label (all languages) reads back to its key,
// the readers that moved to the dictionary accept each spelling. node --test .forma/i18n/keys.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const i18n = require('./index.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const { KEYS } = i18n;

// Keys fixed by the card that introduced the dictionary: audit table of the introducing card.
const REQUIRED = [
  'zone.task', 'zone.kit', 'zone.history', 'zone.result',
  'kind.work', 'kind.tooling', 'kind.decision',
  'kit.role', 'kit.access', 'kit.model', 'kit.data', 'kit.skill', 'kit.tool', 'kit.sources', 'kit.order', 'kit.steps', 'kit.forbidden', 'kit.budget',
  'hist.card', 'hist.attempt', 'hist.closed', 'hist.approved', 'hist.override', 'hist.window_end', 'hist.error', 'hist.session', 'service',
  'plumb.leader', 'plumb.gap', 'plumb.clarity', 'plumb.noul',
  'routes.kit_cap', 'routes.small_task', 'routes.parallel', 'routes.dispatcher', 'routes.plumb', 'routes.plumb_model', 'routes.default_epic',
  'release', 'volume', 'project.image', 'project.closer', 'project.guard', 'id.prohibition', 'translate.col', 'translate.service',
];

test('every required key is in the dictionary with en and ru labels', () => {
  for (const key of REQUIRED) {
    const l = KEYS.labels[key];
    assert.ok(l, `missing key ${key}`);
    assert.ok(l.en && l.en.length, `${key}: no en label`);
    assert.ok(l.ru && l.ru.length, `${key}: no ru label`);
    assert.ok(['exact', 'prefix'].includes(l.match), `${key}: match must be exact or prefix`);
  }
});

test('keys are English: no Cyrillic in any key', () => {
  for (const key of Object.keys(KEYS.labels)) assert.ok(!/[\u0410-\u042f\u0430-\u044f\u0401\u0451]/.test(key), key);
  for (const key of Object.keys(KEYS.phrases)) assert.ok(!/[\u0410-\u042f\u0430-\u044f\u0401\u0451]/.test(key), key);
});

for (const key of Object.keys(KEYS.labels)) {
  test(`key ${key}: every label reads back to the key, by label and by anchor`, () => {
    const labels = i18n.labelsOf(key);
    assert.ok(labels.length >= 2, 'at least one label per language');
    for (const label of labels) {
      assert.ok(i18n.isKey(label, key), `${key} ← "${label}"`);
      assert.ok(i18n.isKey(`${label} ${i18n.anchor(key)}`, key), `${key} ← anchored "${label}"`);
      assert.ok(new RegExp('^(?:' + i18n.alt(key) + ')$').test(label), `alt(${key}) matches "${label}"`);
    }
    assert.ok(i18n.isKey(`Some words ${i18n.anchor(key)}`, key), 'the anchor wins over the visible text');
    assert.ok(!i18n.isKey(`${labels[0]} ${i18n.anchor('zzz.other')}`, key), 'another anchor never matches');
  });
}

test('group lookup: keyOf maps a label to its key, longest label wins', () => {
  assert.equal(i18n.keyOf('\u0420\u043e\u043b\u044c', 'kit'), 'kit.role');
  assert.equal(i18n.keyOf('Skills', 'kit'), 'kit.skill');
  assert.equal(i18n.keyOf('\u0423\u043c\u0435\u043d\u0438\u0435', 'kit'), 'kit.skill');
  assert.equal(i18n.keyOf('\u0418\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u044b', 'kit'), 'kit.tool');
  assert.equal(i18n.keyOf('\u0437\u0430\u043a\u0440\u044b\u0442\u043e', 'hist'), 'hist.closed');
  assert.equal(i18n.keyOf('closed', 'hist'), 'hist.closed');
  assert.equal(i18n.keyOf('\u0437\u0430\u0437\u043e\u0440', 'plumb'), 'plumb.gap');
  assert.equal(i18n.keyOf('nothing', 'kit'), null);
});

test('zone headings: anchor, English and Russian read as one key', () => {
  for (const [key, en, ru] of [['zone.task', 'Task', '\u0417\u0430\u0434\u0430\u0447\u0430'], ['zone.kit', 'Kit', '\u0421\u043d\u0430\u0440\u044f\u0436\u0435\u043d\u0438\u0435'],
    ['zone.history', 'History', '\u0418\u0441\u0442\u043e\u0440\u0438\u044f'], ['zone.result', 'Result', '\u0420\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442']]) {
    for (const h of [`## ${en}`, `## ${ru}`, `## ${ru} ${i18n.anchor(key)}`, `## ${en}\r`]) {
      assert.ok(i18n.headingRe(key, '').test(h), `${key} ← ${JSON.stringify(h)}`);
    }
    assert.ok(!i18n.headingRe(key, '').test('## Other'));
  }
});

test('rowNumber: volume by anchor and by every label, in a table', () => {
  for (const cell of ['Cycle volume', 'Volume', '\u041e\u0431\u044a\u0451\u043c \u0446\u0438\u043a\u043b\u0430, \u043a\u0430\u0440\u0442\u043e\u0447\u0435\u043a (\u043d\u0430 \u044d\u043f\u0438\u043a)', `Whatever ${i18n.anchor('volume')}`]) {
    assert.equal(i18n.rowNumber(`| ${cell} | 25 |`, 'volume'), 25, cell);
  }
  assert.equal(i18n.rowNumber('| Cycle volume | not set |', 'volume'), null);
  assert.equal(i18n.rowNumber('| Attempts | 3 |', 'volume'), null);
});

test('hasPhrase: awaiting decision and access statuses in both languages', () => {
  assert.ok(i18n.hasPhrase('Awaiting a decision from the human', 'awaiting_decision'));
  assert.ok(i18n.hasPhrase('\u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0430 \u043e\u0436\u0438\u0434\u0430\u0435\u0442 \u0440\u0435\u0448\u0435\u043d\u0438\u044f \u0447\u0435\u043b\u043e\u0432\u0435\u043a\u0430', 'awaiting_decision'));
  assert.ok(i18n.hasPhrase('\u043d\u0435\u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0451\u043d', 'access_unconfirmed'));
  assert.ok(i18n.hasPhrase('unconfirmed', 'access_unconfirmed'));
  assert.ok(i18n.hasPhrase('\u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0451\u043d', 'access_ok'));
  assert.ok(!i18n.hasPhrase('nothing here', 'access_ok'));
});

// --- readers that moved to the dictionary ---

function projectWith(row) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keys-'));
  fs.mkdirSync(path.join(dir, 'project', 'config'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'project', 'config', 'PROJECT.md'), row);
  return dir;
}

test('plumb-run reads each threshold under every label of its key', () => {
  const { readThresholds } = require(path.join(ROOT, '.forma', 'plumb', 'plumb-run.cjs'));
  const spell = (key, n) => i18n.labelsOf(key).map((label) => [label, n]);
  const names = { leader: 'plumb.leader', gap: 'plumb.gap', clarity: 'plumb.clarity', noul: 'plumb.noul' };
  for (const [field, key] of Object.entries(names)) {
    for (const [label] of spell(key, 0)) {
      const parts = { leader: 'leader ≥ 70 %', gap: 'gap ≥ 20 pp', clarity: 'clarity ≥ 3 of 4', noul: 'noul ≥ 70 %' };
      parts[field] = `${label} ≥ ${{ leader: 71, gap: 22, clarity: 3, noul: 73 }[field]} units`;
      const dir = projectWith(`| Plumb \`plumb\` | \`jev\`: ${Object.values(parts).join(', ')} |\n`);
      const t = readThresholds(dir, 'jev');
      assert.ok(t, `${field} via "${label}"`);
      assert.equal(t[field], { leader: 71, gap: 22, clarity: 3, noul: 73 }[field], `${field} via "${label}"`);
    }
  }
});

test('plumb-run and plumb-scrub find the zone by key', () => {
  const { extractTask } = require(path.join(ROOT, '.claude', 'scripts', 'plumb-scrub.cjs'));
  for (const h of ['## Task', '## \u0417\u0430\u0434\u0430\u0447\u0430', `## Task ${i18n.anchor('zone.task')}`]) {
    assert.ok(extractTask(`# t\n\n${h}\nonly this\n\n## Kit\nnot this\n`), h);
  }
});

test('route checks and attempt/closed readers accept every spelling', () => {
  const attempts = require(path.join(ROOT, '.forma', 'dashboard', 'data', 'attempts.cjs'));
  for (const w of i18n.labelsOf('hist.closed')) {
    assert.equal(attempts.parseClosedDate(`- \`Core\`, 1999-01-02: ${w} — ok.\n`), '1999-01-02', w);
  }
  for (const w of i18n.labelsOf('service')) {
    assert.equal(attempts.parseServiceLines(`- ${w}, 1999-01-02: 5 credits (x/y) — z.\n`).length, 1, w);
  }
});

test('board-card splits the kit by unit key, English and Russian labels alike', () => {
  const { parseBoardCard } = require(path.join(ROOT, '.forma', 'dashboard', 'data', 'board-card.cjs'));
  const card = (kit) => parseBoardCard('card-1-x.md', `---\nstatus: "backlog"\nlabels: ["route-1"]\n---\n# card-1 · x\n\n## Task\na | b | c | 3 | d\n\n## Kit\n${kit}\n\n## History\n- \`Intent\`, 1999-01-01: human approved.\n`, []);
  const en = card('- **Role:** run · **Skill:** s1 · **Tool:** t · **Access:** confirmed · **Data:** d · **Model:** haiku');
  const ru = card('- **\u0420\u043e\u043b\u044c:** run · **\u0421\u043a\u0438\u043b\u043b:** s1 · **\u0418\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442:** t · **\u0414\u043e\u0441\u0442\u0443\u043f:** \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0451\u043d · **\u0414\u0430\u043d\u043d\u044b\u0435:** d · **\u041c\u043e\u0434\u0435\u043b\u044c:** haiku');
  for (const c of [en, ru]) {
    assert.deepEqual(c.ready.kitUnits, ['role', 'skill', 'tool', 'access', 'data', 'model']);
    assert.equal(c.kitParts.role, 'run');
    assert.equal(c.ready.access, true);
    assert.equal(c.ready.approval, true);
  }
});

test('PROJECT.md: every field the code reads carries its anchor; anchorise is idempotent', () => {
  const md = fs.readFileSync(path.join(ROOT, 'project', 'config', 'PROJECT.md'), 'utf8');
  for (const key of ['language', 'template', 'name', 'source', 'status', 'epics', 'thresholds', 'attempts', 'volume', 'routes', 'tooling', 'references',
    'routes.enabled', 'routes.kit_cap', 'routes.small_task', 'routes.over2', 'routes.over4', 'routes.parallel', 'routes.dispatcher', 'routes.plumb',
    'routes.plumb_model', 'routes.default_epic', 'plumb.haiku.leader', 'plumb.haiku.gap', 'plumb.jev.leader', 'plumb.jev.gap', 'plumb.jev.noul',
    'plumb.jev.clarity', 'cycle_cache']) {
    assert.ok(md.includes(i18n.anchor(key)), `PROJECT.md: no anchor ${key}`);
  }
  assert.equal(i18n.anchorise(md), md);
});

test('anchorise puts anchors on a legacy routes table (every language)', () => {
  const legacy = '**\u041c\u0430\u0440\u0448\u0440\u0443\u0442\u044b**\n\n| \u041f\u043e\u043b\u0435 | \u0417\u043d\u0430\u0447\u0435\u043d\u0438\u0435 |\n|---|---|\n| \u0414\u0438\u0441\u043f\u0435\u0442\u0447\u0435\u0440 | |\n| Plumb haiku: \u043f\u043e\u0440\u043e\u0433 \u043b\u0438\u0434\u0435\u0440\u0430, % | 60 |\n| Plumb `plumb` (x) | `jev` |\n';
  const out = i18n.anchorise(legacy);
  for (const key of ['routes', 'routes.dispatcher', 'plumb.haiku.leader', 'routes.plumb']) assert.ok(out.includes(i18n.anchor(key)), key);
  assert.equal(i18n.rowNumber(out, 'plumb.haiku.leader'), 60);
});

test('writers: a new card on a Russian project gets English zone headings and kind', () => {
  const { spawnSync } = require('node:child_process');
  const r = spawnSync(process.execPath, [path.join(ROOT, '.forma', 'board', 'new-card.cjs'), '--kind', 'protocol', '--title', 'Probe', '--route', '1', '--lang', 'ru', '--dry'], { encoding: 'utf8', cwd: ROOT });
  assert.equal(r.status, 0, r.stderr);
  for (const h of ['## Task', '## Kit', '## History', '## Result']) assert.ok(r.stdout.includes('\n' + h + '\n'), h);
  assert.ok(/\n\d+ · tooling \|/.test(r.stdout), 'kind is English');
  assert.ok(!/## (\u0417\u0430\u0434\u0430\u0447\u0430|\u0421\u043d\u0430\u0440\u044f\u0436\u0435\u043d\u0438\u0435|\u0418\u0441\u0442\u043e\u0440\u0438\u044f|\u0420\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442)/.test(r.stdout));
});

test('card.cjs: zoneHeading is English; zoneHeadingIn finds the heading as written in the card', () => {
  const card = require(path.join(ROOT, '.forma', 'dashboard', 'lib', 'card.cjs'));
  assert.equal(card.zoneHeading('history', 'ru', true), 'History');
  assert.equal(card.zoneHeadingIn('## \u0417\u0430\u0434\u0430\u0447\u0430\n\n## \u0418\u0441\u0442\u043e\u0440\u0438\u044f\n', 'history'), '\u0418\u0441\u0442\u043e\u0440\u0438\u044f');
  assert.equal(card.zoneHeadingIn('## History <!-- k:zone.history -->\n', 'history'), 'History <!-- k:zone.history -->');
  assert.equal(card.zoneHeadingIn('## Task\n', 'history'), null);
});

test('session spend writer: window end key and manual mark are English, readers still take the old spelling', () => {
  const spend = require(path.join(ROOT, '.forma', 'dashboard', 'spend-line.cjs'));
  assert.ok(spend.sessionWindowEnd('desc, window end 1999-01-02T03:04:05.000Z') > 0);
  assert.ok(spend.sessionWindowEnd('desc, \u0433\u0440\u0430\u043d\u0438\u0446\u0430 1999-01-02T03:04:05.000Z') > 0);
  assert.ok(i18n.hasPhrase('x (set by --from/--to)', 'manual_window'));
  assert.ok(i18n.hasPhrase('x (\u0437\u0430\u0434\u0430\u043d\u043e --from/--to)', 'manual_window'));
});

test('migrate-keys: Russian keys become English, texts stay, second pass changes nothing', () => {
  const { migrate } = require(path.join(ROOT, '.forma', 'board', 'migrate-keys.cjs'));
  const src = [
    '---', 'id: "card-1-x"', '---', '# card-1 · x', '',
    '## \u0417\u0430\u0434\u0430\u0447\u0430', '001 · \u043e\u0441\u043d\u0430\u0441\u0442\u043a\u0430 | \u0434\u0435\u043b\u0430\u0435\u0442 | \u043a\u0440\u0438\u0442\u0435\u0440\u0438\u0439 | 3 | \u0434\u0430\u043b\u044c\u0448\u0435', '',
    '## \u0421\u043d\u0430\u0440\u044f\u0436\u0435\u043d\u0438\u0435', '- **\u0420\u043e\u043b\u044c:** run-text · **\u0421\u043a\u0438\u043b\u043b:** s1 · **\u0418\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u044b:** t', '- \u0414\u043e\u0441\u0442\u0443\u043f: \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0451\u043d', '\u0414\u0430\u043d\u043d\u044b\u0435: \u0444\u0430\u0439\u043b. \u041c\u043e\u0434\u0435\u043b\u044c: haiku', '',
    '## \u0418\u0441\u0442\u043e\u0440\u0438\u044f',
    '- `Intent`, 1999-01-01: \u0447\u0435\u043b\u043e\u0432\u0435\u043a \u043e\u0434\u043e\u0431\u0440\u0438\u043b \u043f\u044f\u0442\u044c \u043f\u043e\u043b\u0435\u0439.',
    '- `Run`, 1999-01-02: \u0437\u0430\u0445\u043e\u0434, 5 tokens (cache-read unknown), 2 s, `id unknown` — \u0442\u0435\u0441\u0442.',
    '- `Core`, 1999-01-03: \u0437\u0430\u043a\u0440\u044b\u0442\u043e — \u043f\u0440\u0438\u043d\u044f\u0442\u043e.',
    '- \u0421\u0435\u0440\u0432\u0438\u0441, 1999-01-04: 5 \u043a\u0440\u0435\u0434\u0438\u0442\u043e\u0432 (a/b) — \u0442\u0435\u0441\u0442.',
    '', '## \u0420\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442', '\u0420\u043e\u043b\u044c: \u043d\u0435 \u043a\u043b\u044e\u0447 \u0432 \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442\u0435', '',
  ].join('\r\n');
  const r = migrate(src);
  assert.ok(r.changed);
  for (const want of ['## Task', '## Kit', '## History', '## Result', '001 · tooling |', '**Role:**', '**Skill:**', '**Tools:**', 'Access:', 'Data:', 'Model:',
    'human approved \u043f\u044f\u0442\u044c \u043f\u043e\u043b\u0435\u0439', 'attempt, 5 tokens', 'closed — \u043f\u0440\u0438\u043d\u044f\u0442\u043e', '- Service, 1999-01-04']) assert.ok(r.text.includes(want), want);
  assert.ok(r.text.includes('\u0420\u043e\u043b\u044c: \u043d\u0435 \u043a\u043b\u044e\u0447 \u0432 \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442\u0435'), 'only the Kit zone is rewritten');
  assert.ok(r.text.includes('\r\n') && !/[^\r]\n/.test(r.text), 'line endings kept');
  assert.equal(migrate(r.text).changed, false, 'idempotent');
});

test('check key-language: a Russian key in a card is a finding with address and expected value; English card is clean', () => {
  const check = require(path.join(ROOT, '.forma', 'board', 'checks', 'key-language.cjs'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-'));
  const dir = path.join(root, '.devtool', 'features');
  fs.mkdirSync(dir, { recursive: true });
  const body = (task, hist) => `---\nid: "card-1-x"\nstatus: "backlog"\nlabels: []\n---\n# card-1 · x\n\n## ${task}\n1 · ${task === 'Task' ? 'work' : '\u0434\u0435\u043b\u043e'} | a | b | 1 | c\n\n## ${hist}\n- \`Intent\`, 1999-01-01: ok\n`;
  fs.writeFileSync(path.join(dir, 'card-1-x.md'), body('Task', 'History'));
  assert.deepEqual(check.run({ root }), []);
  fs.writeFileSync(path.join(dir, 'card-1-x.md'), body('\u0417\u0430\u0434\u0430\u0447\u0430', '\u0418\u0441\u0442\u043e\u0440\u0438\u044f'));
  const found = check.run({ root });
  assert.equal(found.length, 1);
  assert.match(found[0], /card-1-x\.md:\d+/);
  assert.match(found[0], /Task/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('name sections: exact code sets, exactly the languages declared, en always present, nothing empty', () => {
  const langs = Object.keys(KEYS.languages).sort();
  assert.ok(langs.includes('en'), 'en is always declared');
  const sets = {
    routeNames: [...Array(9).keys()].map((n) => 'route-' + n).concat([1, 2, 3, 4].map((n) => 'over-' + n)),
    lawSections: [1, 2, 3, 4, 5, 6, 7].map((n) => 'law-' + n),
    prohibitionNames: Array.from({ length: 18 }, (_, i) => 'prohibition-' + (i + 1)),
    namedKeys: ['plumb'],
  };
  for (const [name, codes] of Object.entries(sets)) {
    const dict = KEYS[name];
    assert.ok(dict, `section ${name} exists`);
    assert.deepEqual(Object.keys(dict).sort(), codes.slice().sort(), `${name}: exact code set`);
    for (const c of codes) {
      const e = dict[c];
      assert.ok(e, `${name}.${c} exists`);
      assert.deepEqual(Object.keys(e).sort(), name === 'routeNames' ? langs.concat('key').sort() : langs.slice(), `${name}.${c}: exactly the declared languages`);
      for (const l of langs) assert.ok(e[l] !== undefined && String(e[l]).length, `${name}.${c}: ${l} not empty`);
      if (name === 'routeNames') assert.ok(/^[a-z]+(-[a-z]+)*$/.test(e.key), `${c}: movement key is English`);
    }
  }
});

test('routeNames: both dashboard locales carry the route and overlay names', () => {
  const en = require('../dashboard/locales/en.json'), ru = require('../dashboard/locales/ru.json');
  for (const [c, r] of Object.entries(KEYS.routeNames)) {
    assert.equal(en['board.rn.' + c.replace('-', '')], r.en, c);
    assert.equal(ru['board.rn.' + c.replace('-', '')], r.ru, c);
  }
});
