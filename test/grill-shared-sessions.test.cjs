// The interview skill and the dashboard share one sessions module (`dashboard/lib/interview-sessions.cjs`): the port
// of the previous run and the pid liveness are defined in one place. The skill sits at a different depth - in the core
// and in the copy delivered into the engine directory - and finds the module upward from itself; the path is engine-independent.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { makeFixture, runNode } = require('./helpers/fixture.cjs');
const { freePort, waitDead } = require('./helpers/serve.cjs');

const MODULE = ['.forma', 'dashboard', 'lib', 'interview-sessions.cjs'];
// The core and the delivered copy: the skill directory depth differs.
const LOCATIONS = [
  ['.forma', 'skills', 'forma-grill-with-ui', 'server.mjs'],
  ['.claude', 'skills', 'forma-grill-with-ui', 'server.mjs'],
];
let fx;

test.before(() => { fx = makeFixture(); });
test.after(() => { if (fx) fx.cleanup(); });

function sessionDir(name, serverJson) {
  const dir = path.join(fx.base, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), '{}');
  if (serverJson) fs.writeFileSync(path.join(dir, 'server.json'), JSON.stringify(serverJson));
  return dir;
}

for (const loc of LOCATIONS) {
  const server = () => path.join(fx.root, ...loc);
  const label = loc.slice(0, -2).join('/');

  test(`${label}: url - a live pid gives the address, a dead one - a refusal`, () => {
    assert.ok(fs.existsSync(server()), 'the skill is delivered');
    const alive = sessionDir('alive-' + loc.join('_'), { url: 'http://127.0.0.1:1/', pid: process.pid });
    const ok = runNode(fx, [server(), 'url', '--session', alive, '--timeout', '2']);
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(ok.stdout.trim(), 'http://127.0.0.1:1/');

    const dead = sessionDir('dead-' + loc.join('_'), { url: 'http://127.0.0.1:1/', pid: 2147483000 });
    const no = runNode(fx, [server(), 'url', '--session', dead, '--timeout', '1']);
    assert.equal(no.status, 1, no.stdout + no.stderr);
    assert.match(no.stderr, /no running server/);
  });

  test(`${label}: serve - takes the previous run port from server.json`, async () => {
    const port = await freePort();
    const dir = sessionDir('port-' + loc.join('_'), { port });
    const child = spawn(process.execPath, [server(), 'serve', '--session', dir], { cwd: fx.root, env: fx.env, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      const line = await new Promise((resolve, reject) => {
        let out = '';
        const timer = setTimeout(() => reject(new Error('the page did not come up:\n' + out)), 15000);
        child.stdout.on('data', (c) => { out += c; if (out.includes('\n')) { clearTimeout(timer); resolve(out.split('\n')[0]); } });
        child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`exited (${code}):\n${out}`)); });
      });
      assert.equal(new URL(JSON.parse(line).url).port, String(port));
    } finally {
      child.kill();
      await waitDead(child.pid);
    }
  });
}

test('without the sessions module the skill refuses with a clear message, and the commands without it work', () => {
  const module = path.join(fx.root, ...MODULE);
  const server = path.join(fx.root, ...LOCATIONS[0]);
  const alive = sessionDir('missing', { url: 'http://127.0.0.1:1/', pid: process.pid });
  fs.renameSync(module, module + '.off');
  try {
    const r = runNode(fx, [server, 'url', '--session', alive, '--timeout', '1']);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /interview-sessions\.cjs not found/);
    const pending = runNode(fx, [server, 'pending', '--session', alive]);
    assert.equal(pending.status, 0, 'pending does not load the module');
  } finally {
    fs.renameSync(module + '.off', module);
  }
});
