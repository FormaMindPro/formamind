// VibeForma discovery from the interview page server: the actual port comes
// from location.json, /health is checked for the app identity, and a busy or
// foreign port is reported instead of being mistaken for the engine.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { makeFixture } = require('./helpers/fixture.cjs');
const { freePort, waitDead, request } = require('./helpers/serve.cjs');

const TOKEN = 'voice-test-token'; // a test value, not a secret

let fx;
test.before(() => { fx = makeFixture(); });
test.after(() => { if (fx) fx.cleanup(); });

/** A fake VibeForma on loopback; `mode` switches the answer without rebinding. */
function startFakeVibe(mode = 'vibe') {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      if (req.headers['x-vibeforma-token'] !== TOKEN) {
        res.writeHead(401);
        res.end();
        return;
      }
      if (req.url !== '/health') {
        res.writeHead(404);
        res.end();
        return;
      }
      if (mode === 'foreign') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, version: '9.9.9' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        app: 'vibeforma',
        api: 1,
        port: srv.address().port,
        version: '0.2.4',
        model: 'large-v3-turbo',
        language: 'ru',
        state: 'idle',
      }));
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port, setMode: (m) => { mode = m; } }));
  });
}

async function startPage(localAppData, name) {
  const dir = path.join(fx.base, name);
  fs.mkdirSync(dir, { recursive: true });
  const port = await freePort();
  fs.writeFileSync(path.join(dir, 'server.json'), JSON.stringify({ port }));
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ topic: 'voice', questions: [] }));
  const server = path.join(fx.root, '.forma', 'skills', 'forma-grill-with-ui', 'server.mjs');
  const child = spawn(process.execPath, [server, 'serve', '--session', dir],
    { cwd: fx.root, env: { ...fx.env, LOCALAPPDATA: localAppData }, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = { out: '' };
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the page did not come up:\n' + log.out)), 15000);
    child.stdout.on('data', (c) => { log.out += c; if (log.out.includes('\n')) { clearTimeout(timer); resolve(); } });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`exited (${code}):\n${log.out}`)); });
  });
  return { port, log, stop: async () => { child.kill(); await waitDead(child.pid); } };
}

function writeDiscovery(localAppData, port, api = 'on') {
  const dir = path.join(localAppData, 'VibeForma');
  fs.mkdirSync(dir, { recursive: true });
  const config = path.join(dir, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ http_api: true, http_port: 8787, http_token: TOKEN }));
  fs.writeFileSync(path.join(dir, 'location.json'), JSON.stringify({
    schema: 1, app: 'vibeforma', version: '0.2.4', config, port, api,
  }));
}

test('the voice status takes the actual port from location.json and verifies /health', async () => {
  const localAppData = path.join(fx.base, 'localappdata-on');
  const fake = await startFakeVibe('vibe');
  writeDiscovery(localAppData, fake.port, 'on');
  const page = await startPage(localAppData, 'voice-on');
  try {
    const r = await request(page.port, 'GET', '/voice/status');
    assert.equal(r.status, 200);
    const status = JSON.parse(r.body);
    assert.equal(status.available, true);
    assert.equal(status.engine, 'vibeforma');
    assert.equal(status.port, fake.port, 'the location port wins over the config port');
    assert.equal(status.version, '0.2.4');
    assert.equal(status.model, 'large-v3-turbo');
  } finally {
    await page.stop();
    fake.srv.close();
  }
});

test('a foreign 200 answer on the port is not accepted as VibeForma', async () => {
  const localAppData = path.join(fx.base, 'localappdata-foreign');
  const fake = await startFakeVibe('vibe');
  writeDiscovery(localAppData, fake.port, 'on');
  fake.setMode('foreign');
  const page = await startPage(localAppData, 'voice-foreign');
  try {
    const r = await request(page.port, 'GET', '/voice/status');
    const status = JSON.parse(r.body);
    assert.equal(status.available, false);
    assert.equal(status.reason, 'not-vibeforma');
    assert.equal(status.port, fake.port);
  } finally {
    await page.stop();
    fake.srv.close();
  }
});

test('location.json api=error is reported as a busy port without probing', async () => {
  const localAppData = path.join(fx.base, 'localappdata-busy');
  writeDiscovery(localAppData, 49321, 'error');
  const page = await startPage(localAppData, 'voice-busy');
  try {
    const r = await request(page.port, 'GET', '/voice/status');
    const status = JSON.parse(r.body);
    assert.equal(status.available, false);
    assert.equal(status.reason, 'port-busy');
    assert.equal(status.port, 49321);
  } finally {
    await page.stop();
  }
});
