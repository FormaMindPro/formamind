// The dashboard server survives broken input: a bad %-sequence in the path and non-objects in `answers`
// answer 4xx, the process stays alive and the next request passes. The behavior on normal input -
// in serve-routes.test.cjs; here only what used to fell the process with an unhandled exception.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeFixture } = require('./helpers/fixture.cjs');
const { startServer, request, isAlive } = require('./helpers/serve.cjs');

let fx;
let server;

// A server per test: a fallen process must not fell the neighboring tests in a chain.
test.before(() => { fx = makeFixture(); });
test.beforeEach(async () => { server = await startServer(fx); });
test.afterEach(async () => { if (server) await server.stop(); });
test.after(() => { if (fx) fx.cleanup(); });

const post = (body) => request(server.port, 'POST', '/interview/answer', { body, headers: { 'content-type': 'application/json' } });
const answersFile = () => path.join(fx.root, 'project', 'brief', 'answers.jsonl');

/** The process is alive and answers: the same pid, the page is served. */
async function assertAlive(step) {
  assert.ok(isAlive(server.child.pid), `the server process fell after: ${step}\n${server.log()}`);
  const r = await request(server.port, 'GET', '/');
  assert.equal(r.status, 200, `GET / after: ${step}`);
}

test('a broken %-sequence and a zero byte in the path - 400, the process alive', async () => {
  for (const bad of ['/%E0%A4%A', '/%', '/%zz', '/graphs/%E0%A4%A', '/%00', '/a%00.html']) {
    const r = await request(server.port, 'GET', bad);
    assert.equal(r.status, 400, bad);
    await assertAlive(bad);
  }
});

test('null and non-objects in answers - skipped or 400, the process alive', async () => {
  const pos = 1;
  const allBad = await post(JSON.stringify({ position: pos, answers: [null, 5, 'string', [], true] }));
  assert.equal(allBad.status, 400, allBad.body);
  assert.ok(!fs.existsSync(answersFile()), 'the junk did not reach the brief');
  await assertAlive('answers of non-objects only');

  const mixed = await post(JSON.stringify({ position: pos, answers: [null, { id: 'q1', text: ' \u0441\u043a\u0430\u0437\u0430\u043d\u043e ' }, 7] }));
  assert.equal(mixed.status, 200, mixed.body);
  assert.deepEqual(JSON.parse(mixed.body), { ok: true, position: pos, saved: 1 });
  const lines = fs.readFileSync(answersFile(), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(lines[0].answers, [{ id: 'q1', text: '\u0441\u043a\u0430\u0437\u0430\u043d\u043e' }]);
  await assertAlive('answers mixed');
});

test('null and a non-object instead of the whole body - 400, the process alive', async () => {
  for (const body of ['null', '5', '"s"', '[]']) {
    const r = await post(body);
    assert.equal(r.status, 400, `${body}: ${r.body}`);
  }
  await assertAlive('the body is not an object');
});
