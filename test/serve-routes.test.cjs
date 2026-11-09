// The dashboard endpoints: the fixture server on an ephemeral port, every route answers as designed.
// A refactoring safety net for `dashboard/serve.js`: a lost route or a changed response code - the test falls.
// FORMA_SERVE_JS=<file> - run against another serve.js version; FORMA_ROUTES_REPORT=<file> - record observations.
// The brief tree labels are data the interview routes echo back: unicode escapes, byte-identical.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeFixture } = require('./helpers/fixture.cjs');
const { startServer, request, firstEvent } = require('./helpers/serve.cjs');
const DATA = {
  root: '\u041a\u043e\u0440\u0435\u043d\u044c',
  position1: '\u043f\u043e\u0437\u0438\u0446\u0438\u044f 1',
  firstNode: '\u041f\u0435\u0440\u0432\u044b\u0439 \u0443\u0437\u0435\u043b',
  probe: '\u043f\u0440\u043e\u0431\u0430',
  said: '\u0441\u043a\u0430\u0437\u0430\u043d\u043e'
};

const JSON_TYPE = 'application/json; charset=utf-8';
const HTML_TYPE = 'text/html; charset=utf-8';
const NO_STORE = 'no-store, must-revalidate';

let fx;
let server;
const observed = [];
const brief = (...p) => path.join(fx.root, 'project', 'brief', ...p);

// The picture with a tree: without it the node unwinding has nothing to look for. Written before the
// start - the brief watching turns on only if the directory exists at startup.
function writePicture() {
  fs.mkdirSync(brief(), { recursive: true });
  const tree = { id: 'root', label: DATA.root, tag: DATA.position1, children: [{ id: 'n1', label: DATA.firstNode }] };
  fs.writeFileSync(brief('picture.json'), JSON.stringify({ topic: DATA.probe, round: 1, positions: [], tree }));
}

test.before(async () => {
  fx = makeFixture();
  writePicture();
  fs.mkdirSync(path.join(fx.root, '.forma', 'living', 'graphs'), { recursive: true });
  fs.writeFileSync(path.join(fx.root, '.forma', 'living', 'graphs', 'probe.json'), '{"probe":true}');
  server = await startServer(fx);
});

test.after(async () => {
  if (server) await server.stop();
  if (fx) fx.cleanup();
  const report = process.env.FORMA_ROUTES_REPORT;
  if (report) fs.writeFileSync(report, JSON.stringify(observed, null, 2) + '\n');
});

/** A request + an observation record; the body goes to the report only where it is deterministic. */
async function hit(method, urlPath, { body, headers, keepBody = false } = {}) {
  const r = await request(server.port, method, urlPath, { body, headers });
  observed.push({
    method, path: urlPath, status: r.status, type: r.headers['content-type'] || null,
    cache: r.headers['cache-control'] || null, ...(keepBody ? { body: r.body } : {}),
  });
  return r;
}

const json = (r) => JSON.parse(r.body);

test('GET / and /index.html - the dashboard page, no cache', async () => {
  for (const p of ['/', '/index.html']) {
    const r = await hit('GET', p);
    assert.equal(r.status, 200, p);
    assert.equal(r.headers['content-type'], HTML_TYPE);
    assert.equal(r.headers['cache-control'], NO_STORE);
    assert.match(r.body, /<html/i);
  }
});

test('GET /data.json - the data cut: the three fixture cards', async () => {
  const r = await hit('GET', '/data.json');
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], JSON_TYPE);
  const data = json(r);
  assert.equal(data.totals.cardCount, 3);
  assert.equal(data.interview.tree.id, 'root', 'the picture written before the start is read');
});

test('GET /events - the stream: the first event carries the same cut', async () => {
  const r = await firstEvent(server.port);
  observed.push({ method: 'GET', path: '/events', status: r.status, type: r.headers['content-type'], cache: r.headers['cache-control'] });
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'text/event-stream; charset=utf-8');
  assert.equal(r.headers['cache-control'], 'no-cache');
  assert.ok(r.body.startsWith('data: {'), r.body.slice(0, 40));
  assert.equal(JSON.parse(r.body.slice('data: '.length)).totals.cardCount, 3);
});

test('statics: no file - 404, a directory escape - 403, graphs come from living/graphs', async () => {
  const missing = await hit('GET', '/nope.txt', { keepBody: true });
  assert.equal(missing.status, 404);
  assert.equal(missing.body, 'not found: /nope.txt');

  const escape = await hit('GET', '/../package.json', { keepBody: true });
  assert.equal(escape.status, 403);
  assert.equal(escape.body, 'forbidden');

  const graph = await hit('GET', '/graphs/probe.json', { keepBody: true });
  assert.equal(graph.status, 200);
  assert.equal(graph.headers['content-type'], JSON_TYPE);
  assert.equal(graph.body, '{"probe":true}');

  const noGraph = await hit('GET', '/graphs/absent.json');
  assert.equal(noGraph.status, 404);
});

test('POST /interview/answer - answers are appended verbatim, bad input - 400', async () => {
  const post = (body) => hit('POST', '/interview/answer', { body, keepBody: true, headers: { 'content-type': 'application/json' } });

  const bad = await post('{no');
  assert.equal(bad.status, 400);
  assert.deepEqual(json(bad), { ok: false, error: 'bad JSON' });

  const noFields = await post('{}');
  assert.equal(noFields.status, 400);
  assert.deepEqual(json(noFields), { ok: false, error: 'position and answers are required' });

  const empty = await post(JSON.stringify({ position: 1, answers: [{ id: 'q1', text: '   ' }, { text: 'no id' }] }));
  assert.equal(empty.status, 400);
  assert.deepEqual(json(empty), { ok: false, error: 'an empty answer is not recorded' });
  assert.ok(!fs.existsSync(brief('answers.jsonl')), 'the empty one did not reach the brief');

  const ok = await post(JSON.stringify({ position: 1, answers: [{ id: 'q1', text: ' ' + DATA.said + ' ' }, { id: 'q2', text: '' }] }));
  assert.equal(ok.status, 200);
  assert.deepEqual(json(ok), { ok: true, position: 1, saved: 1 });
  const lines = fs.readFileSync(brief('answers.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0].answers, [{ id: 'q1', text: DATA.said }]);
  assert.equal(lines[0].position, 1);
});

test('GET /interview/answer - the route is POST-only: the rest goes to statics and gives 404', async () => {
  const r = await hit('GET', '/interview/answer', { keepBody: true });
  assert.equal(r.status, 404);
  assert.equal(r.body, 'not found: /interview/answer');
});

test('/interview/open - a position without questions 400; with questions it raises the page, the second call the same one', async () => {
  const none = await hit('GET', '/interview/open?position=5', { keepBody: true });
  assert.equal(none.status, 400);
  assert.deepEqual(json(none), { ok: false, error: 'the questions for this position are not written yet' });
  const noParam = await hit('GET', '/interview/open', { keepBody: true });
  assert.equal(noParam.status, 400);

  const first = await hit('GET', '/interview/open?position=1');
  assert.equal(first.status, 200, first.body);
  const a = json(first);
  assert.equal(a.ok, true);
  assert.match(a.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  const { OPENING_ROUND } = require(path.join(fx.root, '.forma', 'dashboard', 'data', 'interview-spec.cjs'));
  const state = json(await request(Number(new URL(a.url).port), 'GET', '/state'));
  assert.equal(state.questions.length, OPENING_ROUND[1].length, 'the page is seeded with the first pass questions');

  const sessions = JSON.parse(fs.readFileSync(brief('sessions.json'), 'utf8'));
  assert.deepEqual(sessions['1'], [a.session], 'the session is written into sessions.json');

  const again = json(await hit('GET', '/interview/open?position=1'));
  assert.equal(again.session, a.session, 'a live session is not started a second time');
  assert.equal(again.url, a.url);

  const resumed = await hit('GET', '/interview/open?position=1&resume=1');
  assert.equal(resumed.status, 200);
  const r = json(resumed);
  assert.notEqual(r.session, a.session, 'a resume - a new session');
  const list = JSON.parse(fs.readFileSync(brief('sessions.json'), 'utf8'))['1'];
  assert.deepEqual(list, [a.session, r.session]);
});

test('/interview/expand - no node 404; the node unwinds into a live session, a repeat does not duplicate the question', async () => {
  const miss = await hit('GET', '/interview/expand?node=absent', { keepBody: true });
  assert.equal(miss.status, 404);
  assert.deepEqual(json(miss), { ok: false, error: 'node not found: absent' });
  const noNode = await hit('GET', '/interview/expand', { keepBody: true });
  assert.equal(noNode.status, 404);
  assert.deepEqual(json(noNode), { ok: false, error: 'node not found: null' });

  const first = await hit('GET', '/interview/expand?node=n1');
  assert.equal(first.status, 200, first.body);
  const a = json(first);
  assert.equal(a.ok, true);
  assert.equal(a.position, 1);
  assert.equal(a.existing, undefined);
  const state = json(await request(Number(new URL(a.url).port), 'GET', '/state'));
  const asked = state.questions.filter((q) => q.node === 'n1');
  assert.equal(asked.length, 1);
  assert.match(asked[0].body, new RegExp(DATA.firstNode));

  const again = json(await hit('GET', '/interview/expand?node=n1'));
  assert.equal(again.ok, true);
  assert.equal(again.session, a.session);
  assert.equal(again.existing, asked[0].id, 'an open question on a node is not duplicated');
});
