'use strict';

/**
 * The live interview's files in `project/brief/`: the picture (`picture.json`), the verbatim answers (`answers.jsonl`),
 * the write-up (`idea.md`), the first page's prompt, the map of live sessions (`sessions.json`, read by the `lib/interview-sessions.cjs` module).
 * The picture is written by `Intent` per round of answers, not by the dashboard: a human click changes a guess's status and
 * nothing else (`serve.js`, /interview/decide). No file - the interview is not running; that is not an error.
 */

const fs = require('fs');
const path = require('path');
const { readIfExists } = require('../lib/fs.cjs');
const { positionSessions, serverOf } = require('../lib/interview-sessions.cjs');

const PICTURE_PATH = ['project', 'brief', 'picture.json'];
// The human's verbatim answers are a separate file from the picture, and that is not a small thing: "what the human said" and "what the
// agent understood" must not lie in one place under one name. It is appended line by line, never rewritten.
const ANSWERS_PATH = ['project', 'brief', 'answers.jsonl'];
// A coherent statement of what the project is now. `Intent` writes it, wholly anew after each parsing.
const IDEA_PATH = ['project', 'brief', 'idea.md'];
// The first page's prompt: written along the way of the interview, like idea.md (`forma-grill-with-ui`).
const LANDING_PROMPT_PATH = ['project', 'brief', 'landing-prompt.md'];

const briefFile = (projectRoot, parts) => path.join(projectRoot, ...parts);

/** The file's text or `null`: not written yet - that is normal, not an error. */
const readIdea = (projectRoot) => readIfExists(briefFile(projectRoot, IDEA_PATH), null);
const readLandingPrompt = (projectRoot) => readIfExists(briefFile(projectRoot, LANDING_PROMPT_PATH), null);

/** The picture as text; no file - `null`. */
const readPictureText = (projectRoot) => readIfExists(briefFile(projectRoot, PICTURE_PATH), null);

/** The human's answers as JSONL lines. A broken line does not drop the rest: one spoiled record does not hide the earlier ones. */
function readAnswers(projectRoot) {
  const raw = readIfExists(briefFile(projectRoot, ANSWERS_PATH), null);
  if (raw === null) return [];
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      // A broken line does not drop the rest: the file is appended one line at a time.
      continue;
    }
  }
  return out;
}

// A live session's questions - what was actually asked: `Intent` appends rounds as the talk goes,
// and the hard-coded list on the board knows nothing of them.
function sessionQuestions(dir) {
  try {
    const st = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
    return (st.questions || []).map((q) => ({
      id: q.id,
      title: q.title || null,
      text: q.body || '',
      round: q.round || 1,
      status: q.status || 'open',
    }));
  } catch {
    return null; // no state.json or it did not parse - no questions from this session
  }
}

/** Questions from all approaches in order; one question carried into a new approach stays one. */
function questionsOf(dirs) {
  const seen = new Set();
  const questions = [];
  for (const d of dirs) {
    for (const q of sessionQuestions(d) || []) {
      if (seen.has(q.id)) continue;
      seen.add(q.id);
      questions.push(q);
    }
  }
  return questions;
}

/** Live sessions by position number: `{ url, alive, dir, questions }`. */
function sessionInfo(projectRoot) {
  const out = {};
  for (const { position, dirs } of positionSessions(projectRoot)) {
    if (!dirs.length) continue;
    const dir = dirs[dirs.length - 1]; // the live approach is the last one
    out[position] = { ...serverOf(dir), dir, questions: questionsOf(dirs) };
  }
  return out;
}

module.exports = { readIdea, readLandingPrompt, readPictureText, readAnswers, sessionInfo };
