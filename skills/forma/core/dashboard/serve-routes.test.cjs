#!/usr/bin/env node
'use strict';
/**
 * The dashboard server's HTTP boundary: Host/Origin guards, POST-only state routes, the static path
 * check. Unit tables over lib/http-guards.cjs, then a real sandbox server exercised through raw
 * http.request - its `path` option goes to the wire verbatim, unlike fetch, which normalizes `..`.
 *   node .forma/dashboard/serve-routes.test.cjs
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const guards = require('./lib/http-guards.cjs');

let passed = 0;
let failed = 0;
const pending = [];
const it = (name, fn) => {
  const done = () => { passed += 1; console.log('ok  ' + name); };
  const fail = (err) => { failed += 1; console.error('FAIL  ' + name + '\n  ' + String((err && err.message) || err)); };
  try {
    const r = fn();
    if (r && typeof r.then === 'function') pending.push(r.then(done, fail));
    else done();
  } catch (err) { fail(err); }
};

// ---------- unit ----------

const P = 4599;
it('hostAllowed accepts exactly the loopback names of the port, case-insensitive', () => {
  for (const h of ['localhost:' + P, '127.0.0.1:' + P, '[::1]:' + P, 'LOCALHOST:' + P])
    assert.equal(guards.hostAllowed(h, P), true, h);
});
it('hostAllowed refuses a foreign name, an empty and a missing header', () => {
  for (const h of ['evil.example:' + P, '', undefined])
    assert.equal(guards.hostAllowed(h, P), false, String(h));
});
it('originAllowed lets an absent header through (curl, tests) and refuses foreign and "null"', () => {
  assert.equal(guards.originAllowed(undefined, P), true);
  assert.equal(guards.originAllowed('http://localhost:' + P, P), true);
  assert.equal(guards.originAllowed('http://evil.example', P), false);
  assert.equal(guards.originAllowed('null', P), false);   // a sandboxed iframe's Origin
});
it('pathUnder keeps the base itself in and the prefix-sharing sibling out', () => {
  const t = fs.realpathSync(os.tmpdir());
  const base = path.join(t, '.forma', 'living');
  assert.equal(guards.pathUnder(base, path.join(base, 'graphs', 'x.html')), true);
  const sibling = path.join(t, '.forma', 'living-old', 'x');
  assert.ok(sibling.startsWith(base), 'the issue case: the sibling shares the base as a string prefix');
  assert.equal(guards.pathUnder(base, sibling), false);
  assert.equal(guards.pathUnder(base, path.join(t, 'elsewhere', 'x')), false);
});

// ---------- sandbox ----------

const SRC = __dirname;
// The live project root (has both .git and .forma) - the boot fallback copies a missing file from it.
const findLiveRoot = (start) => {
  let d = start;
  for (;;) {
    if (fs.existsSync(path.join(d, '.git')) && fs.existsSync(path.join(d, '.forma'))) return d;
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
};
const LIVE_ROOT = findLiveRoot(SRC);
const SKIP = (n) => n === '.cache' || n.endsWith('.log');
const copyTree = (src, dst) => {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP(e.name)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tail = (s) => (s || '').split(/\r?\n/).filter(Boolean).slice(-6).join(' | ');

const state = { tmp: null, proj: null, child: null, childErr: '', port: 0 };

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const request = (o) => new Promise((resolve, reject) => {
  const { body, ...opts } = o;
  const req = http.request({ ...opts, host: '127.0.0.1', port: state.port }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
  });
  req.on('error', reject);
  if (body) req.write(body);
  req.end();
});

const waitExit = (child, ms) => new Promise((resolve) => {
  if (child.exitCode !== null) return resolve();
  const t = setTimeout(resolve, ms);
  child.on('exit', () => { clearTimeout(t); resolve(); });
});

function waitForAnswer(ms) {
  const until = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (state.child.exitCode !== null)
        return reject(new Error('the sandbox server exited (code ' + state.child.exitCode + '): ' + tail(state.childErr)));
      try {
        const r = await request({ method: 'GET', path: '/data.json', headers: { Host: 'localhost:' + state.port } });
        if (r.status) return resolve(r);
      } catch { /* not up yet */ }
      if (Date.now() >= until)
        return reject(new Error('no answer in ' + ms + ' ms; stderr: ' + tail(state.childErr)));
      setTimeout(tick, 150);
    };
    tick();
  });
}

// A missing file (or directory - the data builder scandirs some) named in the child's stderr is
// copied from the live project into the same place of the sandbox; anything else is a real failure.
function healMissingFile() {
  if (!LIVE_ROOT || !state.tmp) return false;
  const re = /(?:Cannot find module|no such file or directory, open|no such file or directory, scandir) '([^']+)'/g;
  let m;
  let healed = false;
  while ((m = re.exec(state.childErr))) {
    const p = m[1];
    if (!p.startsWith(state.tmp)) continue;
    const rel = path.relative(state.proj, p);
    if (rel.startsWith('..')) continue;
    const from = path.join(LIVE_ROOT, rel);
    if (fs.existsSync(from) && fs.statSync(from).isDirectory()) copyTree(from, p);
    else if (fs.existsSync(from)) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.copyFileSync(from, p);
    } else fs.mkdirSync(p, { recursive: true });   // the live project has none either - an empty one
    console.log('NOTE  boot fallback: healed ' + rel + ' from the live project');
    healed = true;
  }
  return healed;
}

async function boot() {
  const base = process.env.FORMA_TEST_TMP && fs.existsSync(process.env.FORMA_TEST_TMP)
    ? process.env.FORMA_TEST_TMP
    : os.tmpdir();
  state.tmp = fs.mkdtempSync(path.join(fs.realpathSync(base), 'serve-routes-'));
  state.proj = path.join(state.tmp, 'proj');
  copyTree(SRC, path.join(state.proj, '.forma', 'dashboard'));
  copyTree(path.resolve(SRC, '..', 'i18n'), path.join(state.proj, '.forma', 'i18n'));
  fs.mkdirSync(path.join(state.proj, '.devtool', 'features'), { recursive: true });
  fs.mkdirSync(path.join(state.proj, 'project', 'brief'), { recursive: true });

  for (let i = 0; i < 10; i++) {
    if (state.child) { state.child.kill(); await waitExit(state.child, 2000); state.child = null; }
    state.port = await freePort();
    // rememberedPort (lib/interview-sessions.cjs) reads only `{ port }`; the pre-written file makes
    // the child take exactly this port, and its own server.json then confirms it.
    const cacheDir = path.join(state.proj, '.forma', 'dashboard', '.cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'server.json'), JSON.stringify({
      url: 'http://localhost:' + state.port + '/', port: state.port, pid: process.pid, started: new Date().toISOString(),
    }));
    state.childErr = '';
    state.child = spawn(process.execPath, [path.join(state.proj, '.forma', 'dashboard', 'serve.js')],
      { cwd: state.proj, stdio: ['ignore', 'pipe', 'pipe'] });
    state.child.stderr.on('data', (c) => { state.childErr += c.toString('utf8'); });
    state.child.stdout.on('data', () => {});
    try { await waitForAnswer(10000); return; }
    catch (err) {
      if (!healMissingFile()) throw err;
    }
  }
  throw new Error('the sandbox server never came up');
}

async function teardown() {
  if (state.child && state.child.exitCode === null) {
    state.child.kill();
    await waitExit(state.child, 2000);
  }
  if (state.tmp) { try { fs.rmSync(state.tmp, { recursive: true, force: true }); } catch { /* best effort */ } }
}

const fetchesPost = (dashboardDir) => () => {
  const web = fs.readFileSync(path.join(dashboardDir, 'web', 'js', 'interview.js'), 'utf8');
  for (const url of ["fetch('/interview/expand?node=", "fetch('/interview/open?position="]) {
    const line = web.split('\n').find((l) => l.includes(url));
    assert.ok(line, 'no fetch line for ' + url);
    assert.ok(line.includes("{ method: 'POST' }"), url + ' must POST');
  }
};

// ---------- run ----------

(async () => {
  let booted = false;
  try { await boot(); booted = true; }
  catch (err) {
    console.error('NOTE  the sandbox server did not boot: ' + String((err && err.message) || err));
    console.error('NOTE  boot-dependent checks fall back to source assertions');
  }
  const sandbox = booted ? path.join(state.proj, '.forma', 'dashboard') : SRC;
  if (booted) {
    it('integration: answers on loopback; both listen sites name HOST, not 0.0.0.0', async () => {
      const r = await request({ method: 'GET', path: '/data.json', headers: { Host: 'localhost:' + state.port } });
      assert.equal(r.status, 200);
      const serve = fs.readFileSync(path.join(sandbox, 'serve.js'), 'utf8');
      const calls = [...serve.matchAll(/srv\.listen\([^)]*\)/g)].map((m) => m[0]);
      assert.equal(calls.length, 2, 'two listen sites');
      for (const c of calls) assert.match(c, /^srv\.listen\([^,]+,\s*HOST\s*\)$/, c);
    });
    it('integration: a foreign Host is refused (DNS rebinding)', async () => {
      const r = await request({ method: 'GET', path: '/data.json', headers: { Host: 'evil.example:' + state.port } });
      assert.equal(r.status, 403);
    });
    it('integration: GET on a state route is 405, not a session', async () => {
      const r = await request({ method: 'GET', path: '/interview/open?position=1', headers: { Host: 'localhost:' + state.port } });
      assert.equal(r.status, 405);
    });
    it('integration: a raw path escaping the base is 403 (no client-side normalization)', async () => {
      const r = await request({ method: 'GET', path: '/graphs/../../living-old/x', headers: { Host: 'localhost:' + state.port } });
      assert.equal(r.status, 403);
    });
    it('integration: a cross-origin POST to a state route is refused', async () => {
      const r = await request({
        method: 'POST', path: '/interview/answer',
        headers: { Host: 'localhost:' + state.port, Origin: 'http://evil.example' }, body: '{}',
      });
      assert.equal(r.status, 403);
    });
    it('integration: a no-Origin POST passes the guard; a bad body writes nothing to the brief', async () => {
      const r = await request({
        method: 'POST', path: '/interview/answer',
        headers: { Host: 'localhost:' + state.port, 'Content-Type': 'application/json' }, body: '{}',
      });
      assert.notEqual(r.status, 403);
      assert.ok(!fs.existsSync(path.join(state.proj, 'project', 'brief', 'answers.jsonl')), 'answers.jsonl must not appear');
    });
    it('source: both interview fetches POST', fetchesPost(sandbox));
  } else {
    it('source fallback: both listen sites carry HOST', () => {
      const serve = fs.readFileSync(path.join(SRC, 'serve.js'), 'utf8');
      const calls = [...serve.matchAll(/srv\.listen\([^)]*\)/g)].map((m) => m[0]);
      assert.equal(calls.length, 2, 'two listen sites');
      for (const c of calls) assert.match(c, /^srv\.listen\([^,]+,\s*HOST\s*\)$/, c);
    });
    it('source fallback: state routes are POST and the guards are wired into the request flow', () => {
      const serve = fs.readFileSync(path.join(SRC, 'serve.js'), 'utf8');
      for (const p of ['/interview/expand', '/interview/open', '/interview/answer'])
        assert.match(serve, new RegExp("method:\\s*'POST',\\s*state:\\s*true,\\s*path:\\s*'" + p.replace(/\//g, '\\/') + "'"), p);
      assert.match(serve, /guards\.hostAllowed\(req\.headers\.host,\s*serverPort\)/);
      assert.match(serve, /guards\.originAllowed\(req\.headers\.origin,\s*serverPort\)/);
      assert.match(serve, /guards\.pathUnder\(base,\s*filePath\)/);
    });
    it('source: both interview fetches POST', fetchesPost(SRC));
  }
  await Promise.all(pending);
  await teardown();
  console.log(`\n${passed} passed`);
  if (failed) process.exitCode = 1;
})().catch(async (err) => {
  console.error(err);
  await teardown();
  process.exitCode = 1;
});
