// A dashboard module edit reaches the running server by itself, without a restart; the supervisor raises
// a fallen server. Everything - in the fixture, on an ephemeral port. FORMA_SERVE_JS=<file> - run against
// another serve.js version. Russian position names and the server's ru log line are data: unicode escapes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeFixture } = require('./helpers/fixture.cjs');
const { startServer, request, waitDead } = require('./helpers/serve.cjs');
const DATA = {
  name: '\u041e\u0431\u043b\u0438\u043a',
  nameEdited: '\u041e\u0431\u043b\u0438\u043a-\u043f\u0440\u0430\u0432\u043a\u0430',
  nameFixed: '\u041e\u0431\u043b\u0438\u043a-\u0438\u0441\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u043e',
  probeBreak: '\u043f\u0440\u043e\u0431\u0430 \u043f\u043e\u043b\u043e\u043c\u043a\u0438',
  notReread: 'not re-read (the previous one stays)'
};

const POLL_MS = 100;
const REACT_MS = 15000;   // how long to wait for the server's reaction to an edit (watching + a 300 ms delay + a rebuild)
let fx;
let server;

const dash = (...p) => path.join(fx.root, '.forma', 'dashboard', ...p);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const data = async () => JSON.parse((await request(server.port, 'GET', '/data.json')).body);
const firstPosition = async () => (await data()).interview.positions[0];

async function until(check, what) {
  const stop = Date.now() + REACT_MS;
  let last;
  while (Date.now() < stop) {
    last = await check();
    if (last) return last;
    await sleep(POLL_MS);
  }
  throw new Error(`did not live to see: ${what}\n${server.log().slice(-1500)}`);
}

const append = (file, code) => fs.appendFileSync(file, '\n' + code + '\n');

test.before(async () => {
  fx = makeFixture();
  server = await startServer(fx);
});

test.after(async () => {
  if (server) await server.stop();
  if (fx) fx.cleanup();
});

test('a data/ module edit is picked up: the server serves the new one without a restart', async () => {
  assert.equal((await firstPosition()).name, DATA.name);
  const pid = server.servePid();
  append(dash('data', 'interview-spec.cjs'), `module.exports.POSITIONS[0].name = '${DATA.nameEdited}';`);
  await until(async () => (await firstPosition()).name === DATA.nameEdited, 'the new position name in /data.json');
  assert.equal(server.servePid(), pid, 'the same process - no restart happened');
});

test('a broken edit does not fell the server: the previous stays, the reason is in the log; a fix is picked up again', async () => {
  const file = dash('data', 'interview-spec.cjs');
  const good = fs.readFileSync(file, 'utf8');
  try {
    fs.writeFileSync(file, good + `\nthrow new Error('${DATA.probeBreak}');\n`);
    await until(() => server.log().includes(DATA.notReread), 'the message about the unread edit');
    const still = await request(server.port, 'GET', '/data.json');
    assert.equal(still.status, 200);
    assert.equal((await firstPosition()).name, DATA.nameEdited, 'the previous data remained');
  } finally {
    fs.writeFileSync(file, good + `\nmodule.exports.POSITIONS[0].name = '${DATA.nameFixed}';\n`);   // the file is not left broken
  }
  await until(async () => (await firstPosition()).name === DATA.nameFixed, 'the fixed edit');
});

test('a sessions module edit (lib/interview-sessions.cjs) is picked up by the same path', async () => {
  assert.equal((await data()).interview.positions[1].session, null, 'before the edit position 2 has no session');
  append(dash('lib', 'interview-sessions.cjs'),
    "const _pos = module.exports.positionSessions;\n"
    + "module.exports.positionSessions = (r) => [..._pos(r), { position: 2, dirs: ['/probe/none'] }];");
  const seen = await until(async () => (await data()).interview.positions[1].session, 'the session of position 2 in /data.json');
  assert.deepEqual(seen, { url: null, alive: false });
});

test('a generate.js builder edit is picked up', async () => {
  const before = (await data()).totals.cardCount;
  append(dash('generate.js'), "const _build = module.exports.buildData;\n"
    + "module.exports.buildData = (root) => { const d = _build(root); d.totals.cardCount += 100; return d; };");
  await until(async () => (await data()).totals.cardCount === before + 100, 'the builder with the edit');
});

test('watch.js: a fallen server is raised again on the same port and answers', async () => {
  await server.stop();
  const supervised = await startServer(fx, { entry: dash('watch.js') });
  try {
    const pid = supervised.servePid();
    assert.ok(pid, 'the server under the supervisor wrote its pid');
    process.kill(pid);
    await waitDead(pid);
    const next = await until(() => { const p = supervised.servePid(); return p && p !== pid ? p : 0; }, 'the new server pid in server.json');
    assert.notEqual(next, pid);
    const r = await until(async () => {
      try { const x = await request(supervised.port, 'GET', '/data.json'); return x.status === 200 ? x : null; } catch { return null; }
    }, 'the restarted server reply');
    assert.equal(JSON.parse(r.body).interview.positions.length, 5);
  } finally {
    await supervised.stop();
  }
});
