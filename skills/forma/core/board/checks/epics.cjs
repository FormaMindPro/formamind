'use strict';

// Reconciliation of the board with the roadmap: a content epic = a goal, one to one.
// The goal label is the truth; the epic is the lane of its kind. The label is obligatory going forward, from the day
// of entry of the `goal-label` rule.

const fs = require('fs');
const { projectFile, opsFile } = require('../../dashboard/lib/fs.cjs');
const path = require('path');
const i18n = require('../../i18n/index.cjs');
const { cardFiles, boardDir, labelsOf, createdDay } = require('../../dashboard/lib/card.cjs');

// Nine kinds of a goal: the code is language-independent, the epic label - in the second column of the PROJECT.md table. Only the human changes the codes.
const CODES = ['analytics', 'structure', 'protocol', 'resources', 'balance', 'discussion', 'channels', 'competencies', 'results'];
const GOAL_LABEL_RE = new RegExp('^goal-(\\d+|' + CODES.join('|') + ')$');

const read = (file) => fs.readFileSync(file, 'utf8');

/** Kind code → epic label, from the epic table of `project/config/PROJECT.md` (the first line of a code wins). */
function readLanes(root) {
  const laneOf = new Map();
  const projectMd = projectFile(root, 'PROJECT.md');
  if (!fs.existsSync(projectMd)) return laneOf;
  const re = new RegExp('^\\|\\s*`(' + CODES.join('|') + ')`\\s*\\|\\s*([^|]+?)\\s*\\|');
  for (const line of read(projectMd).split('\n')) {
    const m = line.match(re);
    if (m && !laneOf.has(m[1])) laneOf.set(m[1], m[2].replace(/`/g, ''));
  }
  return laneOf;
}

/** Goals - from the directory names of `project/goals/`: main goal-<code>, subgoal goal-NN-*; a draft - GOAL.md with `draft: true` or without GOAL.md. */
function readGoals(root) {
  const goals = new Set();
  const draft = new Set();
  const goalsDir = path.join(root, 'project', 'goals');
  if (!fs.existsSync(goalsDir)) return { goals, draft };
  for (const d of fs.readdirSync(goalsDir)) {
    if (!fs.statSync(path.join(goalsDir, d)).isDirectory()) continue;
    const m = d.match(/^goal-(\d+)/) || d.match(new RegExp('^goal-(' + CODES.join('|') + ')$'));
    if (!m) continue;
    goals.add('goal-' + m[1]);
    const goalMd = path.join(goalsDir, d, 'GOAL.md');
    if (!fs.existsSync(goalMd) || /^draft:\s*true\s*$/m.test(read(goalMd))) draft.add('goal-' + m[1]);
  }
  return { goals, draft };
}

/** Kind of a subgoal - from the map `project/ops/ROADMAP.md`: the subgoal stands under its main goal (a goal-<code> line), deeper than it. */
function readKinds(root) {
  const kindOf = new Map();
  for (const c of CODES) kindOf.set('goal-' + c, c);
  const roadmap = opsFile(root, 'ROADMAP.md');
  if (!fs.existsSync(roadmap)) return kindOf;
  let current = null;
  let depth = -1;
  const mainRe = new RegExp('^(.*?)goal-(' + CODES.join('|') + ')\\b');
  for (const line of read(roadmap).split('\n')) {
    if (!line.includes('── ')) continue;               // only the map tree lines, not the prose under them
    const mm = line.match(mainRe);
    if (mm && !/goal-\d/.test(line.slice(0, mm[1].length + 8))) { current = mm[2]; depth = mm[1].length; continue; }
    const sm = line.match(/^(.*?)(goal-\d+)\b/);
    if (sm && current && sm[1].length > depth) kindOf.set(sm[2], current);
  }
  return kindOf;
}

/** Violations of one card: no more than one before the goal reconciliation, after it - the goal draft and the kind lane. */
function cardProblems(name, text, model) {
  const em = text.match(/^epic:\s*"(.+?)"/m);
  if (!em) return [i18n.message('board.epics.no_epic', { name }, 'ru')];
  const epic = em[1];
  if (!model.lanes.has(epic)) return [i18n.message('board.epics.epic_unknown', { name, epic }, 'ru')];
  const gl = labelsOf(text).filter((l) => GOAL_LABEL_RE.test(l));
  if (gl.length !== 1) {
    return createdDay(text) >= model.since ? [i18n.message('board.epics.label_count', { name, n: gl.length }, 'ru')] : [];
  }
  const g = gl[0];
  if (model.goals.size && !model.goals.has(g)) return [i18n.message('board.epics.no_catalog', { name, g }, 'ru')];
  const problems = [];
  const kind = model.kindOf.get(g);
  // Production under a draft goal - a start stop. The interview and other kinds are fine: they form the image themselves. Closed ones are not touched.
  // The exception - a demonstration cycle (the demo label): the human agreed to it with the start gate closed.
  const demo = labelsOf(text).includes('demo');
  if (kind === 'channels' && model.draft.has(g) && !demo && !/^status:\s*"done"/m.test(text)) {
    problems.push(i18n.message('board.epics.draft_production', { name, g }, 'ru'));
  }
  if (kind && epic !== model.laneOf.get(kind) && epic !== model.laneOf.get('discussion')) {
    problems.push(i18n.message('board.epics.wrong_lane', { name, epic, g, lane: model.laneOf.get(kind) }, 'ru'));
  }
  return problems;
}

function run({ root, since }) {
  if (!fs.existsSync(boardDir(root))) return [];            // no board yet - nothing to check
  const laneOf = readLanes(root);
  if (!laneOf.size) {
    return [i18n.message('board.epics.no_table', null, 'ru')];
  }
  const model = { laneOf, lanes: new Set(laneOf.values()), kindOf: readKinds(root), since, ...readGoals(root) };
  return cardFiles(root).flatMap((f) => cardProblems(path.basename(f), read(f), model));
}

module.exports = { id: 'epics', since: 'goal-label', run };
