'use strict';

/**
 * The production chain: interview → end-image → goal → epic → cards. It fixes nothing and advises nothing:
 * it shows where a link appeared before its predecessor. The order is broken - that is a fact for the human.
 */

const fs = require('fs');
const path = require('path');
const { walk, readIfExists, projectFile, opsFile } = require('../lib/fs.cjs');
const { boardDir, parseFrontmatter } = require('../lib/card.cjs');

const SETUP_STEPS = [
  { n: '1',   name: 'Brief (interview)',     file: 'project/brief/interview.md' },
  { n: '1b',  name: 'Nodes view',            file: 'project/brief/nodes-vision.md' },
  { n: '2',   name: 'History',              file: 'project/brief/history.md' },
  { n: '3',   name: 'Site map',             file: 'project/mockups/sitemap.md' },
  { n: '4',   name: 'Landing prompt',      file: 'project/brief/prompt.md' },
  { n: '5',   name: 'References',            file: 'project/brief/reference.md' },
  { n: '6',   name: 'Design system',        file: 'project/reference/design-system.md' },
  { n: '9',   name: 'Mockup uploaded',       dir:  'project/mockups', glob: /^v\d+$/ },
  { n: '10b', name: 'Kitting',                 file: 'project/brief/kitting.md' },
];

const readOrNull = (p) => readIfExists(p, null);

/**
 * The state of a preparation step. The presence of a file is not the step: some of them lie in the project as a ready template
 * from day one - with the method inside and empty places for answers. The filled one is the one where there is a record
 * with a date (the rule "spread - a new record with a date"). Not one date, with the blanks in place - that is a template,
 * not a done step, and it is called by its name.
 */
function setupState(root, step) {
  if (step.file) {
    const body = readOrNull(path.join(root, step.file));
    if (body === null) return 'missing';
    const dated = /\b20\d\d-\d\d-\d\d\b/.test(body);
    const placeholder = /<!--/.test(body);
    return dated ? 'done' : (placeholder || body.trim().length < 400) ? 'template' : 'done';
  }
  const dir = path.join(root, step.dir);
  if (!fs.existsSync(dir)) return 'missing';
  return fs.readdirSync(dir).some((d) => step.glob.test(d)) ? 'done' : 'missing';
}

/** Project preparation - the common gate, once per project. */
function readSetup(root) {
  return SETUP_STEPS.map((s) => {
    const state = setupState(root, s);
    return { n: s.n, name: s.name, target: s.file || s.dir, state, done: state === 'done' };
  });
}

/** Process epic names - from PROJECT.md, by the same rule as sync-engines. */
function readProcessEpics(root) {
  const names = new Set();
  const projectMd = readOrNull(projectFile(root, 'PROJECT.md'));
  if (!projectMd) return names;
  for (const line of projectMd.split('\n')) {
    const m = line.match(/^\|\s*`(incoming|value|infra|config)`\s*\|\s*([^|]+?)\s*\|/);
    if (m) names.add(m[2]);
  }
  return names;
}

/** Goals: the catalog gives existence, GOAL.md - whether the end-image is filled. */
function readGoalDirs(root) {
  const goalsDir = path.join(root, 'project', 'goals');
  const goals = new Map();
  if (!fs.existsSync(goalsDir)) return goals;
  for (const d of fs.readdirSync(goalsDir)) {
    // goal-NN - a subgoal, goal-<code> - the goal form's main goal.
    const m = d.match(/^(goal-\d+)/) || d.match(/^(goal-[a-z][a-z-]*)$/);
    if (!m || !fs.statSync(path.join(goalsDir, d)).isDirectory()) continue;
    const goalMd = readOrNull(path.join(goalsDir, d, 'GOAL.md'));
    goals.set(m[1], {
      id: m[1], dir: d, roadmapName: null,
      hasGoalMd: goalMd !== null, draft: goalMd ? /^draft:\s*true\s*$/m.test(goalMd) : true,
      bytes: goalMd ? Buffer.byteLength(goalMd, 'utf8') : 0,
      epic: null, cards: 0, cardsDone: 0,
    });
  }
  return goals;
}

/** ROADMAP.md gives the goal its name. */
function nameGoalsFromRoadmap(root, goals) {
  const roadmap = readOrNull(opsFile(root, 'ROADMAP.md'));
  if (!roadmap) return;
  for (const line of roadmap.split('\n')) {
    const m = line.match(/(goal-(?:\d+|[a-z][a-z-]*))\s*[·:—]\s*(.+?)\s*$/);
    if (m && goals.has(m[1]) && !goals.get(m[1]).roadmapName) {
      goals.get(m[1]).roadmapName = m[2];
    }
  }
}

/**
 * Board epics tied to goals: writes the number of cards in a goal, returns the epics without a goal (name → card count).
 * The truth is the goal label in labels; the old epic name "goal-NN .../SKRIC" is the fallback path for old cards.
 */
function attachEpics(root, goals, processEpics) {
  const orphanEpics = new Map();
  const dir = boardDir(root);
  const files = fs.existsSync(dir) ? walk(dir, { ext: '.md', abs: true }) : [];
  for (const file of files) {
    const fm = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    if (!fm.id || !fm.epic) continue;
    if (processEpics.has(fm.epic)) continue;
    const lab = (Array.isArray(fm.labels) ? fm.labels : []).find((l) => goals.has(l));
    const g = lab ? [lab, lab] : String(fm.epic).match(/^(goal-\d+)\s+(.+?)\/SKRIC$/);
    if (g && goals.has(g[1])) {
      const goal = goals.get(g[1]);
      goal.epic = fm.epic;
      goal.cards += 1;
      if (file.includes(`${path.sep}done${path.sep}`)) goal.cardsDone += 1;
    } else {
      const key = String(fm.epic);
      orphanEpics.set(key, (orphanEpics.get(key) || 0) + 1);
    }
  }
  return orphanEpics;
}

function goalViolations(goal) {
  const out = [];
  const production = /^goal-(\d+|goal)$/.test(goal.id); // an interview under a draft is the norm: it is what forms the end-image
  if (production && goal.cards > 0 && goal.draft) {
    out.push({
      kind: 'cards-without-image', goal: goal.id, count: goal.cards,
      vars: { goal: goal.id, count: goal.cards },
    });
  }
  if (/^goal-\d+$/.test(goal.id) && goal.epic && goal.roadmapName && !goal.roadmapName.startsWith(
    goal.epic.replace(/^goal-\d+\s+/, '').replace(/\/SKRIC$/, ''))) {
    out.push({
      kind: 'epic-name-drift', goal: goal.id,
      vars: { goal: goal.id, name: goal.roadmapName },
    });
  }
  if (!goal.hasGoalMd) {
    out.push({ kind: 'no-goal-md', goal: goal.id, vars: { goal: goal.id } });
  }
  return out;
}

/** Order violations: cards without an end-image, an epic diverged from ROADMAP, no GOAL.md, an epic without a goal, an end-image without an interview. */
function chainViolations(goals, orphanEpics, interviewDone) {
  const violations = [];
  for (const goal of goals.values()) violations.push(...goalViolations(goal));
  for (const [epic, count] of orphanEpics) {
    violations.push({
      kind: 'epic-without-goal', goal: null, count,
      vars: { epic, count },
    });
  }
  const withImage = [...goals.values()].filter((g) => !g.draft).length;
  if (!interviewDone && withImage) {
    violations.push({
      kind: 'image-without-interview', goal: null,
      vars: { n: withImage },
    });
  }
  return violations;
}

function chainSummary(goals) {
  const all = [...goals.values()];
  return {
    goalsTotal: goals.size,
    goalsWithImage: all.filter((g) => !g.draft).length,
    goalsWithEpic: all.filter((g) => g.epic).length,
    cardsUnderDraft: all.filter((g) => g.draft).reduce((s, g) => s + g.cards, 0),
  };
}

function buildChain(projectRoot) {
  const setup = readSetup(projectRoot);
  const interviewDone = setup[0].done;
  const goals = readGoalDirs(projectRoot);
  nameGoalsFromRoadmap(projectRoot, goals);
  const orphanEpics = attachEpics(projectRoot, goals, readProcessEpics(projectRoot));
  return {
    setup,
    interviewDone,
    goals: [...goals.values()].sort((a, b) => a.id.localeCompare(b.id)),
    violations: chainViolations(goals, orphanEpics, interviewDone),
    summary: chainSummary(goals),
  };
}

module.exports = { buildChain };
