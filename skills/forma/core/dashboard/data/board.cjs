'use strict';

/**
 * The "Board", "Goals", "Skills" and "Law" tabs: whole cards (`board-card.cjs`), the links between them -
 * materials, mentions, ADRs, commits -, the goals' thresholds and end-images, the project's skills.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { readIfExists, projectFile } = require('../lib/fs.cjs');
const { boardDir } = require('../lib/card.cjs');
const i18n = require('../../i18n/index.cjs');
const engines = require('../lib/engines.cjs');
const { parseBoardCard } = require('./board-card.cjs');
const { buildLaw } = require('./law.cjs');

/** The project's skills: name → description from the `SKILL.md` frontmatter. */
function readSkills(projectRoot) {
  const skills = {};
  const dir = engines.firstPath(projectRoot, 'skillsDir');
  if (!dir || !fs.existsSync(dir)) return skills;
  for (const d of fs.readdirSync(dir)) {
    const f = path.join(dir, d, 'SKILL.md');
    if (!fs.existsSync(f)) continue;
    const text = fs.readFileSync(f, 'utf8');
    skills[d] = ((text.match(/^description:\s*(.+)$/m) || [, ''])[1]).replace(/^["']|["']$/g, '');
  }
  return skills;
}

function readCards(dir, skillNames) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /^card-\d+.*\.md$/.test(f))
    .map((f) => parseBoardCard(f, fs.readFileSync(path.join(dir, f), 'utf8'), skillNames));
}

/** Goals: code → title from `GOAL.md`. */
function readGoals(projectRoot) {
  const dir = path.join(projectRoot, 'project', 'goals');
  if (!fs.existsSync(dir)) return {};
  const out = {};
  for (const d of fs.readdirSync(dir)) {
    const f = path.join(dir, d, 'GOAL.md');
    if (!fs.existsSync(f)) continue;
    out[d] = (fs.readFileSync(f, 'utf8').match(/^# (.+)$/m) || [, d])[1];
  }
  return out;
}

/** The end-image, the draft and "who closes" of each goal. */
function readGoalInfo(projectRoot) {
  const dir = path.join(projectRoot, 'project', 'goals');
  const info = {};
  if (!fs.existsSync(dir)) return info;
  for (const d of fs.readdirSync(dir)) {
    const f = path.join(dir, d, 'GOAL.md');
    if (!fs.existsSync(f)) continue;
    const t = fs.readFileSync(f, 'utf8');
    const bold = (key) => new RegExp('\\*\\*(?:' + i18n.alt(key) + ')\\*\\*:\\s*(.+)');
  const img = (t.match(bold('project.image')) || t.match(bold('project.image_default')) || [, ''])[1];
    info[d] = {
      image: img.trim().slice(0, 600),
      draft: /^draft:\s*true/m.test(t),
      closer: ((t.match(bold('project.closer')) || [, ''])[1]).trim(),
    };
  }
  return info;
}

/** The "attempts per task" and "cycle volume" thresholds from `PROJECT.md`; no number - `null`. */
function readThresholds(projectRoot) {
  const table = i18n.reader(readIfExists(projectFile(projectRoot, 'PROJECT.md'))).table('thresholds');
  const number = (key) => +((String(i18n.rowValue(table, key) || '').match(/^\d+/) || [])[0]) || null;
  return { attempts: number('attempts'), volume: number('volume') };
}

function readAdrs(projectRoot) {
  const dir = path.join(projectRoot, 'project', 'adr');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /^\d{4}-.*\.md$/.test(f)).map((f) => ({ f, t: fs.readFileSync(path.join(dir, f), 'utf8') }));
}

/** Git history: `[hash, date, subject]`; no git or history - empty, the cards stay without commit dates. */
function readCommits(projectRoot) {
  try {
    return execSync('git log --pretty=format:%h%x09%ad%x09%s --date=short', { cwd: projectRoot, encoding: 'utf8', maxBuffer: 1 << 26 })
      .split('\n').map((l) => l.split('\t'));
  } catch {
    return [];
  }
}

/** After-dependencies: `after-card-NNN` stays open until that card is in `done`. */
function markOpenDeps(cards) {
  const doneCodes = new Set(cards.filter((c) => c.status === 'done').map((c) => c.code));
  cards.forEach((c) => { c.ready.depsOpen = c.ready.deps.filter((d) => !doneCodes.has(d)); });
}

/** A card's links: materials, mentions in other cards, ADRs, commits, the "awaits a human decision" flag. */
function linkCards(cards, { projectRoot, adrs, commits }) {
  const cardsDir = path.join(projectRoot, 'project', 'cards');
  cards.forEach((c) => {
    const n = c.code.replace('card-', '');
    const re = new RegExp(`(card-${n}(?!\\d)|[\u041a\u043a]\u0430\u0440\u0442\u043e\u0447\u043a\\p{L}*\\s+${n}(?!\\d))`, 'u');
    const md = path.join(cardsDir, c.code);
    c.materials = fs.existsSync(md) ? fs.readdirSync(md, { recursive: true }).map(String).filter((f) => fs.statSync(path.join(md, f)).isFile()) : [];
    c.mentions = cards.filter((o) => o !== c && re.test(o.text)).map((o) => o.code);
    c.adrs = adrs.filter((a) => re.test(a.t)).map((a) => a.f);
    c.commits = commits.filter(([, , s]) => re.test(s || '')).slice(0, 15);
    c.humanFlag = i18n.hasPhrase(c.text, 'awaiting_decision') && c.status !== 'done';
  });
}

function buildBoard(projectRoot) {
  const skills = readSkills(projectRoot);
  const names = Object.keys(skills);
  const dir = boardDir(projectRoot);
  const cards = [...readCards(dir, names), ...readCards(path.join(dir, 'done'), names)]
    .sort((a, b) => String(b.modified).localeCompare(String(a.modified)));
  markOpenDeps(cards);
  linkCards(cards, { projectRoot, adrs: readAdrs(projectRoot), commits: readCommits(projectRoot) });
  cards.forEach((c) => { delete c.text; }); // text is needed only for link search
  return {
    law: buildLaw(projectRoot),
    thresholds: readThresholds(projectRoot),
    goalInfo: readGoalInfo(projectRoot),
    project: path.basename(projectRoot),
    skills,
    generated: new Date().toISOString(),
    goals: readGoals(projectRoot),
    cards,
  };
}

module.exports = { buildBoard };
