'use strict';

// Allowed `status` values of a card - exactly five (AGENTS.md §7): backlog, todo, in-progress, review, done.
// `done/` keeps closed cards, but the set of values is the same - moving the file into `done/` changes only
// the place on disk, not the form of the field. Old/alien forms ("in_progress", "completed") silently diverge
// from the engine registry (kanban-markdown) and break the wave counting and the `Core` closing.

const path = require('path');
const fs = require('fs');
const i18n = require('../../i18n/index.cjs');
const { cardFiles, field } = require('../../dashboard/lib/card.cjs');

const ALLOWED = ['backlog', 'todo', 'in-progress', 'review', 'done'];

function run({ root }) {
  const problems = [];
  for (const file of cardFiles(root)) {
    const status = field(fs.readFileSync(file, 'utf8'), 'status');
    if (!ALLOWED.includes(status)) {
      problems.push(`${path.basename(file)}: ` + i18n.message('board.status-values.not_allowed', { status, values: ALLOWED.join('/') }, 'ru'));
    }
  }
  return problems;
}

module.exports = { id: 'status-values', since: null, run };
