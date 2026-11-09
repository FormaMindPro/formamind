// Unit tests of dashboard/lib/card.cjs, rules.cjs and the shared spend-line regexes (spend-line.cjs).
// Russian card text below is data the parser reads (both-language zone headings, the legacy ru claim
// line pattern): byte-identical from ASCII source through unicode escapes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const card = require('../skills/forma/core/dashboard/lib/card.cjs');
const { ruleSince } = require('../skills/forma/core/dashboard/lib/rules.cjs');
const S = require('../skills/forma/core/dashboard/spend-line.cjs');

const D = {
  heading: '\u0417\u0430\u0433\u043e\u043b\u043e\u0432\u043e\u043a',
  task: '\u0417\u0430\u0434\u0430\u0447\u0430',
  doIt: '\u0434\u0435\u043b\u0430\u0439',
  history: '\u0418\u0441\u0442\u043e\u0440\u0438\u044f',
  result: '\u0420\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442',
  done: '\u0433\u043e\u0442\u043e\u0432\u043e',
  text: '\u0442\u0435\u0441\u0442',
  body: '\u0422\u0435\u043b\u043e',
  no: '\u043d\u0435\u0442',
  empty: '\u043f\u0443\u0441\u0442\u043e',
  noBlock: '\u0431\u0435\u0437 \u0431\u043b\u043e\u043a\u0430',
  noHeading: '\u0431\u0435\u0437 \u0437\u0430\u0433\u043e\u043b\u043e\u0432\u043a\u0430',
  noLabels: '\u0431\u0435\u0437 \u043c\u0435\u0442\u043e\u043a',
  made: '\u0441\u0434\u0435\u043b\u0430\u043d\u043e.',
  legacyClaim: '\u0437\u0430\u0445\u043e\u0434',
  tokensRu: '\u0442\u043e\u043a\u0435\u043d\u043e\u0432'
};

const CARD = [
  '---', 'id: "card-001-x"', 'status: "review"', 'assignee: null', 'created: "2021-05-04T10:00:00Z"',
  'labels: ["goal-protocol", "route-4"]', 'priority: medium', '---', '', `# ${D.heading}  `, '', `## ${D.task}`, D.doIt, '',
  `## ${D.history}`, '- `Kit`, 2021-05-04: attempt, 10 tokens (5 cache-read), 3 s, `abc12345` — claude-code: x.', '', `## ${D.result}`, D.done, '',
].join('\n');

test('frontmatterBlock / splitFrontmatter: the block and the body; LF and CRLF; no block', () => {
  assert.match(card.frontmatterBlock(CARD), /^id: "card-001-x"/);
  assert.equal(card.frontmatterBlock(CARD.replace(/\n/g, '\r\n')).split('\r\n')[0], 'id: "card-001-x"');
  assert.equal(card.frontmatterBlock('# ' + D.noBlock), null);
  const { block, rest } = card.splitFrontmatter(CARD);
  assert.ok(block.includes('status: "review"'));
  assert.ok(rest.startsWith('\n# ' + D.heading));
  assert.deepEqual(card.splitFrontmatter(D.text), { block: null, rest: D.text });
});

test('parseFrontmatter: null, a string, an array, a raw value', () => {
  assert.deepEqual(card.parseFrontmatter(CARD), {
    id: 'card-001-x', status: 'review', assignee: null, created: '2021-05-04T10:00:00Z',
    labels: ['goal-protocol', 'route-4'], priority: 'medium',
  });
  assert.deepEqual(card.parseFrontmatter(D.noBlock), {});
});

test('parseFrontmatterJson: the value as JSON, otherwise a string', () => {
  const fm = card.parseFrontmatterJson(CARD);
  assert.deepEqual(fm.labels, ['goal-protocol', 'route-4']);
  assert.equal(fm.assignee, null);
  assert.equal(fm.priority, 'medium');
});

test('parseFlatFrontmatter: flat role fields without quotes and the body', () => {
  const [o, body] = card.parseFlatFrontmatter('---\nname: "kit"\nmodel: sonnet\n---\n' + D.body + '\n');
  assert.deepEqual(o, { name: 'kit', model: 'sonnet' });
  assert.equal(body, D.body + '\n');
  assert.deepEqual(card.parseFlatFrontmatter(D.body), [{}, D.body]);
});

test('field / labelsOf / createdDay / cardTitle', () => {
  assert.equal(card.field(CARD, 'status'), 'review');
  assert.equal(card.field(CARD, 'assignee'), null);
  assert.equal(card.field(CARD, D.no), null);
  assert.deepEqual(card.labelsOf(CARD), ['goal-protocol', 'route-4']);
  assert.deepEqual(card.labelsOf(D.noLabels), []);
  assert.equal(card.createdDay(CARD), '2021-05-04');
  assert.equal(card.createdDay('---\n---'), '');
  assert.equal(card.cardTitle(CARD), D.heading);
  assert.equal(card.cardTitle(D.noHeading), null);
});

test('zone / zoneHeading / withoutHistory: two languages', () => {
  assert.equal(card.zone(CARD, 'task'), D.doIt);
  assert.equal(card.zone(CARD, 'result'), D.done);
  assert.equal(card.zone(CARD, 'kit'), '');
  const en = '## Task\ndo\n\n## History\n- h\n\n## Result\nok\n';
  assert.equal(card.zone(en, 'task'), 'do');
  assert.equal(card.zone(en, 'history'), '- h');
  // §6: zone headings are keys - English on any language.
  assert.equal(card.zoneHeading('history', 'ru'), 'History');
  assert.equal(card.zoneHeading('history', 'en'), 'History');
  assert.equal(card.zoneHeading('history', 'de'), 'History');
  assert.ok(card.HISTORY_HEADING_RE.test('## ' + D.history) && card.HISTORY_HEADING_RE.test('## History  '));
  assert.ok(!card.HISTORY_HEADING_RE.test('## ' + D.task));
  const stripped = card.withoutHistory(CARD);
  assert.ok(!stripped.includes('attempt') && stripped.includes('## ' + D.result) && stripped.includes('## ' + D.task));
});

test('cardFiles: the board, then done/; .md by default; a custom filter', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-card-'));
  try {
    const board = card.boardDir(root);
    fs.mkdirSync(path.join(board, 'done'), { recursive: true });
    fs.writeFileSync(path.join(board, 'card-002-b.md'), '');
    fs.writeFileSync(path.join(board, 'notes.txt'), '');
    fs.writeFileSync(path.join(board, 'done', 'card-001-a.md'), '');
    assert.deepEqual(card.cardFiles(root).map((f) => path.basename(f)), ['card-002-b.md', 'card-001-a.md']);
    assert.deepEqual(card.cardFiles(root, /^card-001/).map((f) => path.basename(f)), ['card-001-a.md']);
    assert.deepEqual(card.cardFiles(root, (n) => n === 'notes.txt').map((f) => path.basename(f)), ['notes.txt']);
    assert.deepEqual(card.cardFiles(path.join(root, D.empty)), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('ruleSince: the date from the log; no rule - tomorrow, and a log entry', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-rules-'));
  try {
    const log = path.join(root, '.forma', 'living', 'checks.json');
    fs.mkdirSync(path.dirname(log), { recursive: true });
    fs.writeFileSync(log, JSON.stringify({ old: '2021-01-02' }));
    assert.equal(ruleSince(root, 'old'), '2021-01-02');
    const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    assert.equal(ruleSince(root, 'fresh'), tomorrow);
    assert.deepEqual(JSON.parse(fs.readFileSync(log, 'utf8')), { old: '2021-01-02', fresh: tomorrow });
    assert.equal(ruleSince(root, 'fresh'), tomorrow, 'a repeated call does not move the date');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

const LINE = '- `Run`, 2021-05-04: attempt, 1 234 tokens (1 000 cache-read), 12 s, `0a1b2c3d4e5f` — claude-code: ' + D.made;

test('spend-line regexes: one copy recognizes the canonical line', () => {
  assert.ok(S.CLAIM_LINE_RE.test(LINE));
  assert.ok(S.PARSES_RE.test(LINE));
  assert.ok(S.HAS_CALL_ID_RE.test(LINE));
  assert.ok(S.ENGINE_TAG_RE.test(LINE));
  const m = LINE.match(S.SPEND_TOKENS_RE);
  assert.deepEqual([m[1], m[2], m[3].replace(/\s/g, '')], ['Run', '2021-05-04', '1234']);
  assert.equal(LINE.match(S.CALL_ID_RE)[3], '0a1b2c3d4e5f');
  // The legacy ru claim-line pattern keeps its Russian words (old lines in real cards parse as before).
  assert.equal(S.RU_CLAIM_LINE_RE.test('- `Kit`, 2021-01-01: ' + D.legacyClaim + ', 5 ' + D.tokensRu), true);
  assert.equal(S.EN_CLAIM_LINE_RE.test('- `Kit`, 2021-01-01: attempt, 5 tokens'), true);
});

test('spend-line regexes: unknown - a separate case, not a number', () => {
  const unk = '- `Kit`, 2021-05-04: attempt, unknown tokens (cache-read unknown), 5 s, `id unknown` — claude-code: x.';
  assert.equal(S.SPEND_TOKENS_RE.test(unk), false);
  assert.equal(S.SPEND_TOKENS_OR_UNKNOWN_RE.test(unk), true);
  assert.equal(S.PARSES_RE.test(unk), true);
  assert.ok(S.CALL_ID_UNKNOWN_RE.test(unk));
  assert.ok(S.HAS_CALL_ID_RE.test(unk));
});

test('ATTEMPT_FORMAT_RE: global, tokens, cache-read and seconds at once', () => {
  S.ATTEMPT_FORMAT_RE.lastIndex = 0;
  const m = S.ATTEMPT_FORMAT_RE.exec(LINE);
  assert.ok(m && m[4].includes('1 000') && m[5].includes('12'));
  S.ATTEMPT_FORMAT_RE.lastIndex = 0;
});
