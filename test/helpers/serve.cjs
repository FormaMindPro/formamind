// The dashboard server in the fixture: a separate process on an ephemeral port, an isolated HOME, stopped explicitly.
// The live project dashboard is not touched: the port is picked in advance and written into the fixture server.json,
// so the fixture server never even tries the DEFAULT_PORT (5050).
const fs = require('node:fs');
const net = require('node:net');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const READY_RE = /\u0414\u0430\u0448\u0431\u043e\u0440\u0434: http:\/\/localhost:(\d+)\//;
const START_TIMEOUT_MS = 60000;

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function waitDead(pid, ms = 5000) {
  const until = Date.now() + ms;
  while (isAlive(pid) && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
}

/** The pids of the interview page servers the fixture dashboard raised (they are separate from it and do not stop by themselves). */
function grillPids(home) {
  const root = path.join(home, '.grill-with-ui', 'sessions');
  const pids = [];
  const visit = (dir) => {
    for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) visit(p);
      else if (e.name === 'server.json') {
        try { pids.push(Number(JSON.parse(fs.readFileSync(p, 'utf8')).pid)); } catch { /* not written - no server */ }
      }
    }
  };
  visit(root);
  return pids.filter(Boolean);
}

/**
 *  * Raises the fixture's `dashboard/serve.js`. `opts.serveJs` (or the FORMA_SERVE_JS variable) - another file in
 * its place: this is how the test runs against an older server version.
 */
async function startServer(fx, opts = {}) {
  const override = opts.serveJs || process.env.FORMA_SERVE_JS;
  const serveFile = path.join(fx.root, '.forma', 'dashboard', 'serve.js');
  if (override) fs.copyFileSync(override, serveFile);
  const cache = path.join(fx.root, '.forma', 'dashboard', '.cache');
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(path.join(cache, 'server.json'), JSON.stringify({ port: await freePort() }));

  const env = { ...fx.env, GRILL_HOME: path.join(fx.home, '.grill-with-ui') };
  const child = spawn(process.execPath, [opts.entry || serveFile], { cwd: fx.root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let log = '';
  // Under the supervisor (watch.js) the server is a grandchild: only server.json knows its pid. The supervisor is stopped first,
  // otherwise it would raise the server again.
  const servePid = () => {
    try { return Number(JSON.parse(fs.readFileSync(path.join(cache, 'server.json'), 'utf8')).pid) || 0; } catch { return 0; }
  };
  const stop = async () => {
    const pids = [child.pid, servePid(), ...grillPids(fx.home)].filter(Boolean);
    for (const pid of pids) { try { process.kill(pid); } catch { /* already gone */ } }
    for (const pid of pids) await waitDead(pid);
  };
  // It did not come up - no processes left behind: the supervisor would restart the fallen server endlessly.
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the server did not come up in the allotted time:\n' + log)), START_TIMEOUT_MS);
    const onData = (chunk) => {
      log += chunk;
      const m = READY_RE.exec(log);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (c) => { log += c; });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`the server exited (code ${code}):\n${log}`)); });
  }).catch(async (err) => { await stop(); throw err; });

  return { port, child, servePid, log: () => log, stop };
}

/** One request; the path goes as is (the `http` client does not normalize `/../`). */
function request(port, method, urlPath, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('request timeout ' + method + ' ' + urlPath)));
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** The first chunk of the /events stream, then the connection is closed. */
function firstEvent(port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/events' }, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk.toString('utf8');
        if (!body.includes('\n\n')) return;   // an event arrives in chunks; the end - an empty line
        req.destroy();
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', (err) => { if (err.code !== 'ECONNRESET') reject(err); });
  });
}

module.exports = { startServer, request, firstEvent, freePort, isAlive, waitDead };
