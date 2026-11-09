#!/usr/bin/env node
// Local dashboard server - static files + a live data.json rebuild + an SSE push into the browser.
// No external dependencies: only the built-in http/fs. file:// does not serve index.html with
// data.json pulled in (CORS), so some HTTP server is needed, even a local one.
//
// Run: node .forma/dashboard/serve.js  ->  usually http://localhost:5050/, the port is dynamic -
// see "Port choice" below (every project has its own dashboard, 5050 is not guaranteed free).
//
// The real-time effect works so: fs.watch watches .devtool/features/ recursively; any card change
// (an edit by a node, a move into done/, a new card) with a 300 ms delay (so as not to rebuild three
// times per one Write tool call) rebuilds the snapshot in memory and sends the event to every open
// tab through Server-Sent Events - the browser refreshes the data itself, without F5 and without
// a manual `node generate.js`.
//
// The routes are the ROUTES table below: "method + path -> function". Whatever is absent from it is served as static files.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { writeJsonAtomic } = require('./lib/fs.cjs');
const i18n = require('./lib/i18n.cjs');
const { DEFAULT_PORT } = require('./port.cjs');
// Canonical English strings of the console log live in the core dictionary; the log language is fixed.
const { message: coreMessage } = require('../i18n/index.cjs');
const logMsg = (key, params) => coreMessage(key, params, 'en');

const ROOT = __dirname;
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const FEATURES_DIR = path.join(PROJECT_ROOT, '.devtool', 'features');
const GRAPHIFY_LOG = path.join(__dirname, 'graphify.log');
const BRIEF_DIR = path.join(PROJECT_ROOT, 'project', 'brief');
const ANSWERS_FILE = path.join(BRIEF_DIR, 'answers.jsonl');
// The brief's materials: everything the human attached in the interview lands here.
const MATERIALS_DIR = path.join(BRIEF_DIR, 'materials');
const GRILL_SERVER = path.join(PROJECT_ROOT, '.forma/skills', 'forma-grill-with-ui', 'server.mjs');
const CACHE_DIR = path.join(__dirname, '.cache');
const DATA_CACHE_FILE = path.join(CACHE_DIR, 'data.json');
const SERVER_FILE = path.join(CACHE_DIR, 'server.json');
const DEBOUNCE_MS = 300;
const GRILL_WAIT_MS = 8000;              // how long to wait for the interview page to come up
const MAX_ANSWER_BYTES = 256 * 1024;     // a human answer, not a file

fs.mkdirSync(CACHE_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// ---------- re-readable modules ----------
//
// The data builder and everything it reads (.forma/dashboard/generate.js, data/, lib/), plus the interview
// sessions module live in the `live` object: an edit of any of them reaches the running server by itself,
// see watchModules. Address them through `live.<name>` at the call moment, not kept in a constant.
function loadLive() {
  return {
    buildData: require('./generate.js').buildData,
    sessions: require('./lib/interview-sessions.cjs'),
    graphifyTrigger: require('./graphify-trigger.cjs'),
  };
}
let live = loadLive();

let latestData = live.buildData(PROJECT_ROOT);
const sseClients = new Set();

function rebuild(reason) {
  try {
    latestData = live.buildData(PROJECT_ROOT);
    // The disk cache is kept in sync - compatibility with a manual read/build.
    fs.writeFileSync(DATA_CACHE_FILE, JSON.stringify(latestData, null, 2), 'utf8');
    console.log(logMsg('serve.rebuilt', { time: new Date().toLocaleTimeString('en-GB'), reason, cards: latestData.totals.cardCount, tokens: JSON.stringify(latestData.totals.tokensByEngine) }));
    try { live.graphifyTrigger.check(); } catch (err) { console.error('graphify-trigger:', err.message); }
    for (const res of sseClients) {
      res.write(`data: ${JSON.stringify(latestData)}\n\n`);
    }
  } catch (err) {
    console.error(logMsg('serve.rebuild_failed'), err.message);
  }
}

// ---------- interview sessions ----------

// Reopens a finished session: a new question means the conversation continues.
// The record of the previous round is not lost - it goes into the list of finished rounds, from which
// one can later see that this conversation has already been submitted once.
function reopen(state) {
  if (state.finished) {
    state.finishedRounds = [...(state.finishedRounds || []), state.finished];
    delete state.finished;
  }
  state.agent = { ...(state.agent || {}), status: 'waiting', since: new Date().toISOString() };
}

// Finds a node in the picture's tree and along the way remembers which position it belongs to.
// The position is written not on every node but on the ancestors - the nearest one above is taken.
function findNode(node, id, position) {
  if (!node) return null;
  const mine = /(?:\u043f\u043e\u0437\u0438\u0446\u0438\u044f|position)\s*(\d)/.exec(String(node.from || '') + ' ' + String(node.tag || ''));
  const pos = mine ? Number(mine[1]) : position;
  if (node.id === id) return { node, position: pos || 1 };
  for (const c of node.children || []) {
    const hit = findNode(c, id, pos);
    if (hit) return hit;
  }
  return null;
}

// The question out of a node: the node's own words in quotes and a request to expand. Not a single word
// about what this node, in my reading, means - otherwise the human would agree with my reading instead
// of telling their own (`project/brief/picture.md`).
// `n` - how many expansions this session already had: the name comes out short and in order.
// The node is written in a separate field, not squeezed into the name: the name is seen in a narrow
// list column, and stuffing content into it breaks the list for something unreadable there anyway.
const expandQuestion = (node, n) => ({
  id: 'x-' + (n + 1),
  node: node.id,
  title: interviewCopy().grow.title,
  text: interviewCopy().grow.text.replace('{label}', node.label),
});

// The round with which a closed position is resumed: one open question and nothing more.
//
// There is nothing to suggest here. What the human wants to add, only they know; a list
// of ready-made topics would be my design served to them for approval - exactly what
// the first round avoids (`project/brief/picture.md`).
// The texts for the human are in the project's language (`data/interview-spec.cjs`, "Project language" in PROJECT.md).
const interviewCopy = () => {
  const { projectFile, readIfExists } = require('./lib/fs.cjs');
  const { langOf, localize } = require('./data/interview-spec.cjs');
  return localize(langOf(readIfExists(projectFile(PROJECT_ROOT, 'PROJECT.md'))));
};

const resumeQuestions = (position) => [{
  id: `p${position}-r${Date.now().toString(36)}`,
  ...interviewCopy().resume,
}];

// The questions a new round of a position is seeded with: exactly those written in `OPENING_ROUND`
// and named fit by the human. This is carrying over a ready text, not authorship - otherwise
// the dashboard would write `state.json`, which by the skill's contract belongs to the agent,
// and the conversation would be led by someone other than the one answerable for it.
const openingQuestions = (position) => {
  const interview = latestData.interview;
  const hit = interview && (interview.positions || []).find((p) => p.n === position);
  return (hit || {}).questions || [];
};

const readState = (session) => JSON.parse(fs.readFileSync(path.join(session, 'state.json'), 'utf8'));
const writeState = (session, state) => fs.writeFileSync(path.join(session, 'state.json'), JSON.stringify(state, null, 2), 'utf8');

// The first round is open: `options` are absent on purpose. The agent invents the variants,
// and a poll with ready variants would write the agent's design, approved by the human,
// into the brief instead of the human's design (`project/brief/picture.md`).
function seedQuestions(session, questions) {
  const state = readState(session);
  const { seed } = interviewCopy();
  state.note = seed.note;
  state.questions = questions.map((q, i) => ({
    id: q.id, round: 1, deps: [],
    // The name for the page's side list: "Question 1" says nothing there,
    // and by the list the human chooses what to return to.
    title: q.title || seed.question.replace('{n}', i + 1), body: q.text,
    options: [], status: 'open', durable: false, updated: false,
  }));
  state.agent = { status: 'waiting', since: new Date().toISOString(), handled: 0 };
  writeState(session, state);
}

// A new session folder from the skill; the round is appended into the position's map - the past ones
// stay in the list: they count as what has already been asked.
function createGrillSession(position, questions) {
  const out = execFileSync(process.execPath, [
    GRILL_SERVER, 'new',
    '--topic', interviewCopy().seed.topic.replace('{n}', position),
    '--doc', 'project/brief/interview.md',
  ], { cwd: PROJECT_ROOT, encoding: 'utf8' });
  const session = JSON.parse(out.trim().split('\n').pop()).session;
  const { readSessions, writeSessions, sessionList } = live.sessions;
  const all = readSessions(PROJECT_ROOT);
  all[String(position)] = [...sessionList(all[String(position)]), session];
  writeSessions(PROJECT_ROOT, all);
  seedQuestions(session, questions);
  return session;
}

// The page's server is a separate process and outlives this one. If it is already alive,
// a second one is not raised: two pages of one session would drift apart.
function startGrillServer(session) {
  if (live.sessions.serverOf(session).alive) return;
  const child = spawn(process.execPath, [GRILL_SERVER, 'serve', '--session', session],
    { cwd: PROJECT_ROOT, detached: true, stdio: 'ignore' });
  child.unref();
}

// Raises (or finds) the interview session for a position and returns its folder.
// `resume` - the position is closed, and the past conversation must not be appended to: it is recorded
// and submitted. A resume always starts a new round, the old session stays as it is.
function ensureGrillSession(position, questions, resume) {
  const { readSessions, currentSession } = live.sessions;
  let session = resume ? null : currentSession(readSessions(PROJECT_ROOT)[String(position)]);
  if (!session || !fs.existsSync(path.join(session, 'state.json'))) {
    session = createGrillSession(position, questions);
  }
  startGrillServer(session);
  return session;
}

function grillUrl(session, deadlineMs) {
  const until = Date.now() + deadlineMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const { url, alive } = live.sessions.serverOf(session);
      if (url && alive) return resolve(url);
      if (Date.now() >= until) return reject(new Error('the interview page did not start'));
      setTimeout(tick, 120);
    };
    tick();
  });
}

// ---------- carrying the answers from the sessions into the brief ----------
//
// The interview page writes its submissions into the session's `events.jsonl`. From there what was
// said is carried into `project/brief/answers.jsonl` - verbatim and inside the brief, because the
// record of the conversation belongs to the project, not to the skill's session folder, which will
// one day be cleaned up.
//
// The picture is not touched by this carrying: `picture.json` is a synthesis by `Intent`, and
// assembling it automatically from the raw answer would mean passing the heard off as the understood.
// How far it has been carried lives on disk, not in the process's memory: an in-memory mark reset
// on restart, and every launch appended all the past answers into the brief anew. `sessions.json`
// is fit exactly for this - it is machine-owned and outside git.
const watchedSessions = new Set();   // which sessions this process already watches

// Carries one file into brief/materials and returns the path from the project root.
// A namesake is not overwritten: two same-named files from different sessions are a common thing.
function absorbUpload(session, name) {
  const from = path.join(session, 'uploads', name);
  if (!fs.existsSync(from)) return null;
  const dir = MATERIALS_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let out = name;
  let i = 1;
  while (fs.existsSync(path.join(dir, out))) {
    // The same file, already carried, has no need to be carried a second time.
    if (fs.statSync(path.join(dir, out)).size === fs.statSync(from).size) break;
    out = `${stem}-${++i}${ext}`;
  }
  const to = path.join(dir, out);
  if (!fs.existsSync(to)) fs.copyFileSync(from, to);
  console.log(logMsg('serve.upload_absorbed', { file: out }));
  return path.relative(PROJECT_ROOT, to).split(path.sep).join('/');
}

// Records for answers.jsonl out of one page event.
function recordsOf(ev, session, position) {
  const at = ev.at || new Date().toISOString();
  const actions = ev.actions || [];
  const records = [];

  // Only the answers are taken. Threads, defer, reopen and visualize are a conversation about
  // the conversation; they do not go into the verbatim record, otherwise the brief stops being
  // a record of what was said about the subject.
  const answers = actions
    .filter((a) => a.type === 'answer')
    .map((a) => ({ id: String(a.q || ''), text: String(a.text || '').trim() }))
    .filter((a) => a.id && a.text);
  if (answers.length) records.push({ at, position, answers });

  // Attached files. They are not retold in words - they are carried and named.
  for (const a of actions.filter((x) => x.type === 'upload' && x.file)) {
    const moved = absorbUpload(session, a.file);
    if (!moved) continue;
    records.push({
      at, position,
      answers: [{
        id: String(a.q || ''),
        text: '',
        file: moved,
        bytes: Number(a.bytes) || 0,
        ...(a.note ? { note: String(a.note) } : {}),
      }],
    });
  }
  return records;
}

function appendAnswerRecords(records, position) {
  try {
    fs.mkdirSync(BRIEF_DIR, { recursive: true });
    fs.appendFileSync(ANSWERS_FILE, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    console.log(logMsg('serve.answers_absorbed', { position, n: records.reduce((n, r) => n + r.answers.length, 0) }));
  } catch (err) {
    console.error(logMsg('serve.answers_failed'), err.message);
  }
}

function absorbSessionEvents(session, position) {
  let lines;
  try { lines = fs.readFileSync(path.join(session, 'events.jsonl'), 'utf8').split(/\r?\n/); } catch { return; }

  const seen = live.sessions.readAbsorbedSeq(PROJECT_ROOT, session);
  let maxSeq = seen;
  const records = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    let ev;
    try { ev = JSON.parse(t); } catch { continue; }   // a torn line - skipped
    const seq = Number(ev.seq) || 0;
    if (seq <= seen) continue;
    maxSeq = Math.max(maxSeq, seq);
    records.push(...recordsOf(ev, session, position));
  }

  if (maxSeq > seen) live.sessions.writeAbsorbedSeq(PROJECT_ROOT, session, maxSeq);
  if (records.length) appendAnswerRecords(records, position);
}

function watchSessionEvents(session, position) {
  if (watchedSessions.has(session)) return;   // already watching
  watchedSessions.add(session);
  absorbSessionEvents(session, position);     // catch up with what has already been sent
  try {
    fs.watch(session, (eventType, filename) => {
      if (filename && path.basename(filename) !== 'events.jsonl') return;
      absorbSessionEvents(session, position);
    });
    console.log(logMsg('serve.watch_session_on', { position }));
  } catch (err) {
    console.log(logMsg('serve.watch_session_off', { reason: err.message }));
  }
}

// Sessions started in the past run are picked up: the human may have answered while the dashboard
// server was off, and those answers must not be lost. Every round of the position is watched -
// the answer could have been given in any of them.
function resumeSessionWatchers() {
  for (const { position, dirs } of live.sessions.positionSessions(PROJECT_ROOT)) {
    for (const session of dirs) {
      if (fs.existsSync(session)) watchSessionEvents(session, position);
    }
  }
}

// ---------- watching: rebuild on disk changes ----------

let debounceTimer = null;
function scheduleRebuild(reason) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => rebuild(reason), DEBOUNCE_MS);
}

// An edit of the builder or of any dashboard module reaches the running server by itself.
//
// A manual restart is not the answer: it requires remembering that an edit happened at all, and pays
// with the board disappearing for a second. Here the dashboard directory's modules (the server itself
// excepted) are dropped from the cache and read anew, and if the new edit is broken - the previous
// ones stay in force and this is said out loud, instead of felling the server.
const isReloadable = (file) => file.startsWith(ROOT + path.sep) && file !== __filename;

function reloadModules() {
  const dropped = new Map();
  for (const file of Object.keys(require.cache)) {
    if (!isReloadable(file)) continue;
    dropped.set(file, require.cache[file]);
    delete require.cache[file];
  }
  try {
    live = loadLive();
  } catch (err) {
    for (const [file, mod] of dropped) require.cache[file] = mod;   // a broken edit must not stop the board
    throw err;
  }
}

let reloadTimer = null;
function scheduleReload(filename) {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    try {
      reloadModules();
      rebuild(logMsg('serve.reload_reason', { file: filename }));
    } catch (err) {
      console.error(logMsg('serve.reload_kept_old', { file: filename, reason: err.message }));
    }
  }, DEBOUNCE_MS);
}

// The directories are watched without recursion, by extension: the server writes `.cache/data.json`
// itself, and recursive watching would loop the rebuild on its own writing.
function watchModules() {
  const dirs = [ROOT, path.join(ROOT, 'data'), path.join(ROOT, 'lib')];
  try {
    for (const dir of dirs) {
      fs.watch(dir, (eventType, filename) => {
        if (filename && /\.c?js$/.test(filename)) scheduleReload(filename);
      });
    }
    console.log(logMsg('serve.watch_modules_on', { dir: path.relative(PROJECT_ROOT, ROOT) + '/' }));
  } catch (err) {
    console.log(logMsg('serve.watch_modules_off', { reason: err.message }));
  }
}

function watchFeatures() {
  if (!fs.existsSync(FEATURES_DIR)) {
    console.log(logMsg('serve.features_missing', { dir: path.relative(PROJECT_ROOT, FEATURES_DIR) }));
    return;
  }
  try {
    // recursive:true is supported on Windows and macOS; on Linux fs.watch is not recursive - on that
    // platform the live update arrives with a delay, by the next manual run, but the server and a
    // manual `node generate.js` keep working as before.
    fs.watch(FEATURES_DIR, { recursive: true }, (eventType, filename) => {
      if (filename && !filename.endsWith('.md')) return;
      scheduleRebuild(filename || eventType);
    });
    console.log(logMsg('serve.watch_on', { dir: path.relative(PROJECT_ROOT, FEATURES_DIR) }));
  } catch (err) {
    console.log(logMsg('serve.watch_platform_off', { reason: err.message }));
  }
}

function watchPicture() {
  // The directory is watched, not the file: the picture may not exist yet (the interview not
  // started), and fs.watch throws on a nonexistent path - the watching would not come up exactly
  // at the moment it was started for.
  if (!fs.existsSync(BRIEF_DIR)) return;
  try {
    fs.watch(BRIEF_DIR, (eventType, filename) => {
      const name = filename && path.basename(filename);
      // Three layers worth watching: the parsed, the verbatim and the coherent.
      const WATCHED = ['picture.json', 'answers.jsonl', 'idea.md'];
      if (name && !WATCHED.includes(name)) return;
      scheduleRebuild(name || 'brief');
    });
    console.log(logMsg('serve.watch_brief_on', { dir: path.relative(PROJECT_ROOT, BRIEF_DIR) }));
  } catch (err) {
    console.log(logMsg('serve.watch_brief_off', { reason: err.message }));
  }
}

function watchGraphifyLog() {
  if (!fs.existsSync(GRAPHIFY_LOG)) return;
  try {
    // A file, not a directory: watch(ROOT) would also catch the server's own writing of data.json
    // into the same directory - a rebuild loop with no external cause.
    fs.watch(GRAPHIFY_LOG, () => scheduleRebuild('graphify.log'));
    console.log(logMsg('serve.watch_on', { dir: path.relative(PROJECT_ROOT, GRAPHIFY_LOG) }));
  } catch (err) {
    console.log(logMsg('serve.watch_log_off', { reason: err.message }));
  }
}

// ---------- routes ----------

const queryOf = (req) => new URL(req.url, 'http://x').searchParams;

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': MIME['.json'] });
  res.end(JSON.stringify(obj));
}

// Waits for the session page to come up and answers with its address. `o.extra` - what to add to the response,
// `o.watchPosition` - the position whose session to start watching, `o.failMessage` - an own phrase instead of the wait error.
function replyGrillUrl(res, session, o = {}) {
  grillUrl(session, GRILL_WAIT_MS).then((url) => {
    if (o.watchPosition !== undefined) watchSessionEvents(session, o.watchPosition);
    sendJson(res, 200, { ok: true, url, session, ...o.extra });
  }).catch((err) => sendJson(res, 500, { ok: false, error: o.failMessage || err.message }));
}

function handleEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(`data: ${JSON.stringify(latestData)}\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
}

function handleData(req, res) {
  res.writeHead(200, { 'Content-Type': MIME['.json'] });
  res.end(JSON.stringify(latestData, null, 2));
}

// How many expansions the position's current round already has.
function countExpanded(position) {
  try {
    const { readSessions, currentSession } = live.sessions;
    const cur = currentSession(readSessions(PROJECT_ROOT)[String(position)]);
    return cur ? (readState(cur).questions || []).filter((x) => /^x-/.test(x.id)).length : 0;
  } catch {
    return 0;   // no session or state.json did not parse - there were no expansions
  }
}

// Where the expansion question lands. A live conversation on the position is going - the question goes
// into it: one channel, one tab (`existing` - the same node already asked and not yet answered, nothing
// to duplicate). No live one - a new round is started.
function attachExpandQuestion(hit, q) {
  const { readSessions, currentSession, serverOf } = live.sessions;
  const session = currentSession(readSessions(PROJECT_ROOT)[String(hit.position)]);
  const hasLive = session && fs.existsSync(path.join(session, 'state.json')) && serverOf(session).alive;
  if (!hasLive) return { session: ensureGrillSession(hit.position, [q], true) };

  const state = readState(session);
  const already = (state.questions || []).find((x) => x.node === hit.node.id && x.status === 'open');
  if (already) return { session, existing: already.id };
  const round = Math.max(0, ...(state.questions || []).map((x) => Number(x.round) || 0)) + 1;
  state.questions.push({
    id: q.id, round, deps: [], title: q.title, body: q.text, node: q.node,
    options: [], status: 'open', durable: false, updated: false,
  });
  state.note = logMsg('serve.expand_note', { label: hit.node.label });
  reopen(state);
  writeState(session, state);
  return { session };
}

// Growing a node of the picture's tree. The dashboard opens the interview page in a tab; there is no
// form inside the dashboard on purpose: two input places for the same questions is that very tiredness
// of different windows, for the sake of which everything is brought into one familiar format.
function handleExpand(req, res) {
  const nodeId = queryOf(req).get('node');
  const hit = findNode((latestData.interview || {}).tree, nodeId, 1);
  if (!hit) return sendJson(res, 404, { ok: false, error: 'node not found: ' + nodeId });
  const { position } = hit;
  const q = expandQuestion(hit.node, countExpanded(position));
  let target;
  try {
    target = attachExpandQuestion(hit, q);
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: 'could not expand the node: ' + err.message });
  }
  if (target.existing) {
    return replyGrillUrl(res, target.session, {
      extra: { position, existing: target.existing }, failMessage: 'the interview page is not responding',
    });
  }
  replyGrillUrl(res, target.session, { extra: { position }, watchPosition: position });
}

// The position's button: serves the interview page's address - the dashboard opens it in a tab.
function handleOpen(req, res) {
  const params = queryOf(req);
  const position = Number(params.get('position'));
  const resume = params.get('resume') === '1';
  const questions = resume ? resumeQuestions(position) : openingQuestions(position);
  if (!questions.length) return sendJson(res, 400, { ok: false, error: 'the questions for this position are not written yet' });
  let session;
  try {
    session = ensureGrillSession(position, questions, resume);
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: 'the session did not start: ' + err.message });
  }
  replyGrillUrl(res, session, { watchPosition: position });
}

// The human answer's body -> `{ position, answers }` or `{ error }`.
function parseAnswerBody(body) {
  let position, answers;
  try {
    const parsed = JSON.parse(body);
    position = Number(parsed.position);
    answers = Array.isArray(parsed.answers) ? parsed.answers : null;
  } catch {
    return { error: 'bad JSON' };
  }
  if (!Number.isInteger(position) || !answers) return { error: 'position and answers are required' };
  return { position, answers };
}

// Empty answers are dropped here, not on the screen: the human may have answered one question of
// three, and that is normal - but an emptiness must not be recorded as an answer, it could not be
// told from "said, but unclear" later. An element unlike an object (`null`, a number, a string) is
// not an answer: it is skipped, not felling the process.
const cleanAnswers = (answers) => answers
  .filter((a) => a && typeof a === 'object')
  .map((a) => ({ id: String(a.id || ''), text: String(a.text || '').trim() }))
  .filter((a) => a.id && a.text);

function saveAnswers(res, body) {
  const parsed = parseAnswerBody(body);
  if (parsed.error) return sendJson(res, 400, { ok: false, error: parsed.error });
  const { position } = parsed;
  const clean = cleanAnswers(parsed.answers);
  if (!clean.length) return sendJson(res, 400, { ok: false, error: 'an empty answer is not recorded' });
  try {
    fs.mkdirSync(BRIEF_DIR, { recursive: true });
    const record = { at: new Date().toISOString(), position, answers: clean };
    fs.appendFileSync(ANSWERS_FILE, JSON.stringify(record) + '\n', 'utf8');
    sendJson(res, 200, { ok: true, position, saved: clean.length });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
}

// The human's answers are taken verbatim and **appended**, they do not rewrite the past ones: what
// was said once stays as it was said. The picture (`picture.json`) is not touched by this path at
// all - the picture is a synthesis by `Intent`, and writing it from here would mean passing the raw
// answer off as the understood one.
function handleAnswer(req, res) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > MAX_ANSWER_BYTES) req.destroy();
  });
  req.on('end', () => saveAnswers(res, body));
}

// The rest - files. The graphs live in .forma/living/graphs/ (the dynamic - apart from the dashboard code), the /graphs/ address is the old one.
function handleStatic(req, res, urlPath) {
  const base = urlPath.startsWith('/graphs/') ? path.join(PROJECT_ROOT, '.forma/living') : ROOT;
  const filePath = path.join(base, urlPath === '/' ? 'index.html' : urlPath);
  if (!filePath.startsWith(base)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found: ' + urlPath); return; }
    // The board is live, and its page is never cached. Without this the browser is free to show
    // yesterday's copy as long as it likes: the server has already rebuilt the data and served
    // fresh HTML, while the human looks at the old and cannot tell it from a breakdown.
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store, must-revalidate',
    });
    res.end(data);
  });
}

// The interface languages: one file per language in locales/ (web/js/i18n.js).
function handleLocales(req, res) { sendJson(res, 200, { default: i18n.FALLBACK, locales: i18n.listLocales() }); }

// The routes table: method + path -> a `(req, res)` function. No row - `handleStatic`.
// ANY - a route that never looked at the method, even before the table; left so on purpose, so that request parsing does not change behavior.
const ANY = '*';
const ROUTES = [
  { method: ANY, path: '/events', handle: handleEvents },
  { method: ANY, path: '/interview/expand', handle: handleExpand },
  { method: ANY, path: '/interview/open', handle: handleOpen },
  { method: 'POST', path: '/interview/answer', handle: handleAnswer },
  { method: ANY, path: '/data.json', handle: handleData },
  { method: ANY, path: '/locales.json', handle: handleLocales },
];

const findRoute = (method, urlPath) => ROUTES.find((r) => r.path === urlPath && (r.method === ANY || r.method === method));

// A broken %-sequence (`/%E0%A4%A`) and a null byte (`/%00`, fs does not take it) in the path - a client error:
// 400, not an exception in the handler.
function decodePath(rawUrl) {
  try {
    const decoded = decodeURIComponent(rawUrl.split('?')[0]);
    return decoded.includes('\0') ? null : decoded;
  } catch { return null; }
}

function handleRequest(req, res) {
  const urlPath = decodePath(req.url);
  if (urlPath === null) return sendJson(res, 400, { ok: false, error: 'bad address' });
  const route = findRoute(req.method, urlPath);
  if (route) route.handle(req, res);
  else handleStatic(req, res, urlPath);
}

// ---------- startup ----------

// Port choice: first the past run's port (.forma/dashboard/.cache/server.json), on business (EADDRINUSE) -
// a free ephemeral port from the OS; the real port is written into the file and printed to the console.
// Reading the remembered port - the shared interview sessions module, the same one the interview page's
// server uses. attempt=0 - "listen on the ephemeral port, whichever the OS gives" (node/libuv read an
// explicit 0 exactly so, not as "the port is unset"). While attempt is not 0 and the listener has not
// come up - EADDRINUSE switches to the ephemeral once and no more (a second failure of the same kind is
// no longer "the port is busy", it is a real network error - we fall as before).
const srv = http.createServer(handleRequest);
let attempt = live.sessions.rememberedPort(SERVER_FILE) || DEFAULT_PORT;

function onServerError(err) {
  if (!srv.listening && attempt !== 0 && err.code === 'EADDRINUSE') {
    console.log(logMsg('serve.port_busy', { port: attempt }));
    attempt = 0;
    srv.listen(0);
    return;
  }
  console.error(logMsg('serve.server_error'), err.message);
  process.exit(1);
}

function onListening() {
  const { port } = srv.address();
  const url = `http://localhost:${port}/`;
  writeJsonAtomic(SERVER_FILE, { url, port, pid: process.pid, started: new Date().toISOString() });
  console.log(logMsg('serve.started', { url }));
  console.log(logMsg('serve.built_at_start', { cards: latestData.totals.cardCount, tokens: JSON.stringify(latestData.totals.tokensByEngine) }));
  watchFeatures();
  watchGraphifyLog();
  watchPicture();
  watchModules();
  resumeSessionWatchers();
}

srv.on('error', onServerError);
srv.on('listening', onListening);
srv.listen(attempt);
