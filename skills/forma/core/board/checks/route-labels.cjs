'use strict';

// Route labels. From the rule's day of entry a card has exactly one route-N; route-0…route-5 are opened only by the
// human's approval of the five fields (outside backlog) - the `Intent` line "human approved…" in the history. The old
// route-intent-run label reads as route-2. after-card-NNN - onto an existing card and from an earlier wave.

const fs = require('fs');
const path = require('path');
const { cardFiles, boardDir, labelsOf, createdDay } = require('../../dashboard/lib/card.cjs');

const i18n = require('../../i18n/index.cjs');
const APPROVAL_RE = new RegExp('(' + i18n.alt('hist.approved') + ')', 'i');
const msg = (key, params) => i18n.message(key, params, 'ru');

/** Board cards by number: `Map NNN → { name, labels, text, created }`. */
function readCards(root) {
  const cards = new Map();
  for (const file of cardFiles(root, /^card-\d+.*\.md$/)) {
    const name = path.basename(file);
    const text = fs.readFileSync(file, 'utf8');
    const labels = labelsOf(text).map((l) => (l === 'route-intent-run' ? 'route-2' : l));
    cards.set(name.match(/^card-(\d+).*\.md$/)[1], { name, labels, text, created: createdDay(text) });
  }
  return cards;
}

const waveOf = (c) => {
  const w = c.labels.find((l) => /^wave-\d+$/.test(l));
  return w ? +w.slice(5) : null;
};

/** Label forms: route-0…8, over-1…4, wave-/seg- - natural numbers. */
function formProblems({ name, labels }) {
  const problems = [];
  for (const l of labels.filter((l) => /^route-/.test(l))) {
    if (!/^route-[0-8]$/.test(l)) problems.push(msg('board.route-labels.no_route', { name, l }));
  }
  for (const l of labels.filter((l) => /^over-/.test(l))) {
    if (!/^over-[1-4]$/.test(l)) problems.push(msg('board.route-labels.no_overlay', { name, l }));
  }
  for (const l of labels.filter((l) => /^(wave|seg)-/.test(l))) {
    if (!/^(wave|seg)-[1-9]\d*$/.test(l)) problems.push(msg('board.route-labels.bad_number', { name, l }));
  }
  return problems;
}

/** Exactly one route label; route-0…5 - with the five-field approval (in backlog it is still awaited - that is lawful). */
function routeProblems(c) {
  const routes = c.labels.filter((l) => /^route-/.test(l));
  if (routes.length !== 1) return [msg('board.route-labels.count', { name: c.name, n: routes.length })];
  if (!/^route-[0-5]$/.test(routes[0]) || /^status:\s*"backlog"/m.test(c.text)) return [];
  // §7: the approval is an event line without `attempt`; the former "attempt, 0 tokens, 0 s" lines count too.
  const approved = c.text.split('\n').some((l) => /^-\s*`Intent`/.test(l) && APPROVAL_RE.test(l) &&
    (/0 tokens, 0 s/.test(l) || !/:\s*attempt,/.test(l)));
  return approved ? [] : [msg('board.route-labels.no_approval', { name: c.name, route: routes[0] })];
}

/** after-card-NNN: the label's form, the card's existence and an earlier wave. */
function afterProblems(c, cards) {
  const problems = [];
  const w = waveOf(c);
  for (const l of c.labels.filter((l) => /^after-/.test(l))) {
    const am = l.match(/^after-card-(\d{3,})$/);
    if (!am) { problems.push(msg('board.route-labels.expect_after', { name: c.name, l })); continue; }
    const dep = cards.get(am[1]);
    if (!dep) { problems.push(msg('board.route-labels.no_card', { name: c.name, l, num: am[1] })); continue; }
    const dw = waveOf(dep);
    if (w !== null && dw !== null && !(w > dw)) problems.push(msg('board.route-labels.wave_order', { name: c.name, l, dw, w }));
  }
  return problems;
}

function run({ root, since }) {
  if (!fs.existsSync(boardDir(root))) return [];
  const cards = readCards(root);
  const problems = [];
  for (const c of cards.values()) {
    if (c.created < since) continue;
    problems.push(...formProblems(c), ...routeProblems(c), ...afterProblems(c, cards));
  }
  return problems;
}

module.exports = { id: 'route-labels', since: 'route-labels', run };
