'use strict';

// `Run` executes on `haiku` by default (kit.md, "Kit of the task"; route-choice.md, "`Run` runs on
// `haiku` by default"). A stronger model (`sonnet` and above) is an override, and it must have a reason:
// a line in `## History` written before the card is handed to `Run`, with the word "override". Without it
// the `## Kit` entry silently raises the model, and `Core` cannot verify the choice by fact.

const fs = require('fs');
const path = require('path');
const { cardFiles, createdDay, zone } = require('../../dashboard/lib/card.cjs');

const STRONGER_MODEL_RE = /\b(sonnet|opus)\b/i;
const i18n = require('../../i18n/index.cjs');
const OVERRIDE_LINE_RE = new RegExp(i18n.alt('hist.override'), 'i');
// The short routes (`route-0`, `route-4`): the card is executed by `Intent`/`Kit` itself, `Run` is not called - the model in
// `## Kit` there is the node's own model (frontmatter), not an override of `Run`'s model.
const NO_RUN_ROUTE_RE = /\broute-[04]\b/;

function frontmatter(text) {
  const end = text.indexOf('\n---', 4);
  return end < 0 ? '' : text.slice(0, end);
}

function cardProblem(f, text) {
  if (NO_RUN_ROUTE_RE.test(frontmatter(text))) return null;
  const kitZone = zone(text, 'kit');
  if (!STRONGER_MODEL_RE.test(kitZone)) return null;
  const historyZone = zone(text, 'history');
  if (OVERRIDE_LINE_RE.test(historyZone)) return null;
  return i18n.message('board.run-model-override.no_override', { f, model: kitZone.match(STRONGER_MODEL_RE)[0] }, 'ru');
}

function run({ root, since }) {
  const problems = [];
  for (const file of cardFiles(root, /^card-\d+.*\.md$/)) {
    const text = fs.readFileSync(file, 'utf8');
    if (createdDay(text) < since) continue;
    const p = cardProblem(path.basename(file), text);
    if (p) problems.push(p);
  }
  return problems;
}

module.exports = { id: 'run-model-override', since: 'run-model-override', run };
