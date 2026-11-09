'use strict';

/**
 * The project's live picture during the brief interview - the "Interview" tab. The source of truth is
 * `project/brief/picture.json` (written by `Intent`, the files by `interview-files.cjs`); the positions' makeup and the
 * opening approach's questions - `interview-spec.cjs`. No file - the interview is not running; the tab gives the skeleton and the reason.
 */

const { POSITIONS, langOf, localize } = require('./interview-spec.cjs');
const { projectFile, readIfExists } = require('../lib/fs.cjs');
const { readIdea, readLandingPrompt, readPictureText, readAnswers, sessionInfo } = require('./interview-files.cjs');

/**
 * A position's state is computed here, not written to a file: it is derived wholly from the answers and dependencies,
 * and there must be no second record of it - they would diverge. `st`: `answered` - which are answered, `own` - the position's record
 * from the picture, `submitted` - the human sent an answer, `questions` - the approach's questions.
 */
function positionState(spec, st) {
  const { answered, own, submitted } = st;
  // A position's answeredness is a fact about its questions, not my mark on it. While at least one question of the approach is open,
  // the position is in work: marking it answered earlier would close the human out of a place where they have not finished speaking.
  const qs = st.questions || [];
  const asked = qs.length;
  const got = qs.filter((q) => q.given).length;
  if (asked && got && got < asked) return 'partial';
  if (own && own.state === 'answered') return asked && got < asked ? 'partial' : 'answered';
  const depsReady = spec.deps.every((d) => answered.has(d));
  if (spec.asks === 'intent') return depsReady ? 'ready' : 'blocked';
  // The human answered, `Intent` has not parsed it yet. A separate state, not "answered": the answer exists, the picture of it
  // does not yet, and passing one off for the other would show the work as done before it is done.
  if (submitted && !(own && own.text)) return 'sent';
  if (own && own.state === 'now') return 'now';
  return depsReady ? 'available' : 'blocked';
}

/** What was said and where they ask: the last submission per question wins (the file is appended, never rewritten). */
function answerContext(projectRoot) {
  const answers = readAnswers(projectRoot);
  const givenBy = new Map();
  for (const rec of answers) {
    for (const a of rec.answers || []) givenBy.set(a.id, { text: a.text, at: rec.at });
  }
  // The text the human reads is in the project's language; the positions' machine keys (`name`) do not depend on the language.
  const loc = localize(langOf(readIfExists(projectFile(projectRoot, 'PROJECT.md'))));
  return { sentFor: new Set(answers.map((o) => o.position)), sessions: sessionInfo(projectRoot), givenBy, loc };
}

const sessionOf = (ctx, spec) => (ctx.sessions[spec.n] && { url: ctx.sessions[spec.n].url, alive: ctx.sessions[spec.n].alive }) || null;

/** A position's questions: a session open - what was asked in it; none - what it will be seeded with. */
function questionsFor(spec, ctx) {
  const sess = ctx.sessions[spec.n] || null;
  const source = (sess && sess.questions && sess.questions.length) ? sess.questions : (ctx.loc.OPENING_ROUND[spec.n] || []);
  return source.map((q) => ({ ...q, given: ctx.givenBy.get(q.id) || null }));
}

function emptyLayers(spec) {
  return (spec.layers || []).map((l) => ({ key: l.key, label: l.label, hint: l.hint, text: null, answered: false }));
}

function emptyPosition(spec, ctx) {
  // The skeleton's state is computed over the questions as they are, without the human's answers: there is nothing to answer here yet.
  const rawQuestions = (ctx.sessions[spec.n] && ctx.sessions[spec.n].questions) || ctx.loc.OPENING_ROUND[spec.n] || [];
  return {
    n: spec.n, name: spec.name, label: spec.label, asks: spec.asks, hint: spec.hint,
    note: spec.note || null, deps: spec.deps,
    waitingFor: spec.deps.slice(),
    state: positionState(spec, { answered: new Set(), own: null, submitted: ctx.sentFor.has(spec.n), questions: rawQuestions }),
    session: sessionOf(ctx, spec),
    questions: questionsFor(spec, ctx),
    fill: 0, text: null,
    layers: emptyLayers(spec),
    guess: null,
  };
}

/**
 * A skeleton without a single answer. A separate branch, not readInterview(null), so that the empty state cannot
 * be told apart from the filled one by shape by accident.
 */
function emptyPicture(projectRoot) {
  const ctx = answerContext(projectRoot);
  return {
    topic: null, round: null, updated: null, finished: null, tree: null,
    idea: readIdea(projectRoot),
    landingPrompt: readLandingPrompt(projectRoot),
    answered: 0,
    guesses: { open: 0, confirmed: 0, rejected: 0 },
    positions: ctx.loc.POSITIONS.map((spec) => emptyPosition(spec, ctx)),
  };
}

function countStatus(acc, status) {
  const st = status || 'open';
  if (st === 'open') acc.open += 1;
  else if (st === 'confirmed') acc.confirmed += 1;
  else if (st === 'rejected') acc.rejected += 1;
}

function countGuesses(node, acc) {
  if (!node) return acc;
  if (node.kind === 'guess') countStatus(acc, node.status);
  for (const child of node.children || []) countGuesses(child, acc);
  return acc;
}

/** The tree's guesses and the positions' guesses - open, confirmed, declined. */
function guessTotals(tree, positions) {
  const guesses = countGuesses(tree, { open: 0, confirmed: 0, rejected: 0 });
  for (const p of positions) {
    if (p.guess) countStatus(guesses, p.guess.status);
  }
  return guesses;
}

function liveLayers(spec, own) {
  return (spec.layers || []).map((l) => {
    const got = ((own && own.layers) || {})[l.key] || null;
    return { key: l.key, label: l.label, hint: l.hint, text: got && got.text ? got.text : null, answered: Boolean(got && got.text) };
  });
}

function livePosition(spec, own, answered, ctx) {
  const qs = questionsFor(spec, ctx);
  const state = positionState(spec, { answered, own, submitted: ctx.sentFor.has(spec.n), questions: qs });
  return {
    n: spec.n,
    name: spec.name,
    label: spec.label,
    asks: spec.asks,
    hint: spec.hint,
    note: spec.note || null,
    deps: spec.deps,
    // What exactly a closed position awaits is said aloud, otherwise it reads as broken, not as
    // awaiting its turn.
    waitingFor: state === 'blocked' ? spec.deps.filter((d) => !answered.has(d)) : [],
    state, // answered | now | sent | available | blocked | ready (on the fifth)
    session: sessionOf(ctx, spec),
    questions: qs,
    fill: typeof (own && own.fill) === 'number'
      ? Math.max(0, Math.min(100, own.fill))
      : (state === 'answered' ? 100 : 0),
    text: (own && own.text) || null,
    layers: liveLayers(spec, own),
    guess: (own && own.guess) || null,
  };
}

/** Which are answered. Two passes: a position's state depends on its neighbors, and one pass would look at what is not yet filled. */
function answeredPositions(byName) {
  const answered = new Set();
  for (const spec of POSITIONS) {
    const own = byName.get(spec.name);
    if (own && own.state === 'answered') answered.add(spec.n);
  }
  return answered;
}

function livePicture(projectRoot, data) {
  const byName = new Map((data.positions || []).map((p) => [p.name, p]));
  const ctx = answerContext(projectRoot);
  const answered = answeredPositions(byName);
  const positions = ctx.loc.POSITIONS.map((spec) => livePosition(spec, byName.get(spec.name) || null, answered, ctx));
  const tree = data.tree || null;
  return {
    present: true,
    topic: data.topic || null,
    round: typeof data.round === 'number' ? data.round : null,
    updated: data.updated || null,
    finished: data.finished || null,
    positions,
    answered: positions.filter((p) => p.state === 'answered').length,
    tree,
    idea: readIdea(projectRoot),
    landingPrompt: readLandingPrompt(projectRoot),
    guesses: guessTotals(tree, positions),
  };
}

function readInterview(projectRoot) {
  const raw = readPictureText(projectRoot);
  // No file - the interview is not running, but the skeleton is given all the same: an empty tab says nothing,
  // while the skeleton says what will be asked.
  if (raw === null) return { present: false, reason: 'no-file', ...emptyPicture(projectRoot) };
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    // Broken JSON is not the same as absent: in the second case the interview is not running, in the first it is running
    // and the picture is broken. Silently showing "empty" would pass the breakage off as peace.
    return { present: false, reason: 'bad-json', error: String((err && err.message) || err), ...emptyPicture(projectRoot) };
  }
  return livePicture(projectRoot, data);
}

module.exports = { readInterview };
