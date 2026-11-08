#!/usr/bin/env node
// Running a script in a card's context - the "script ↔ card" link is made by the engine, not by the script's text (AGENTS.md §5, prohibition 16).
//
//   node .forma/board/run-in-card.cjs <card> -- <command> [arguments…]      <card> - "NNN" or "card-NNN"
//
// It verifies the card is on the board (live or in done/) and gives the command in the environment:
//   CARD_ID     - the card code, `card-NNN`
//   CARD_DIR    - the absolute path of the materials folder, `project/cards/card-NNN` (AGENTS.md §6); it does not create the folder -
//                 the script opens it when there is something to put in (the card-materials check complains about an empty one)
//   CARD_ASSETS - `CARD_DIR/assets`, assets outside git
//   CARD_WORK   - `CARD_DIR/work`, working material outside git
// The script does not know card numbers: it takes the paths from `--out` arguments or from CARD_*; none nearby - a neutral default.
// Part of the core: one for all engines, it knows no engine paths. The exit code - the command's code.

const path = require('path');
const { spawnSync } = require('child_process');
const i18n = require('../i18n/index.cjs');
const { cardFiles } = require('../dashboard/lib/card.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const msg = (key, params) => i18n.message(key, params, 'ru');

/** `NNN` | `card-NNN` → `card-NNN`; else null. */
function normalize(card) {
  const m = String(card || '').match(/^(?:card-)?(\d+)$/);
  return m ? 'card-' + m[1].padStart(3, '0') : null;
}

/** The card environment: CARD_ID/DIR/ASSETS/WORK. Throws when the card is not on the board. */
function cardEnv(root, card) {
  const id = normalize(card);
  if (!id) throw new Error(msg('board.run-in-card.not_code', { card }));
  const exists = cardFiles(root, /^card-\d+-.*\.md$/).some((f) => path.basename(f).startsWith(id + '-'));
  if (!exists) throw new Error(msg('board.run-in-card.not_found', { id }));
  const dir = path.join(root, 'project', 'cards', id);
  return { CARD_ID: id, CARD_DIR: dir, CARD_ASSETS: path.join(dir, 'assets'), CARD_WORK: path.join(dir, 'work') };
}

module.exports = { cardEnv, normalize };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const sep = argv.indexOf('--');
  if (sep < 1 || sep === argv.length - 1) {
    console.error(msg('board.run-in-card.usage'));
    process.exit(2);
  }
  let env;
  try { env = cardEnv(ROOT, argv[0]); } catch (e) { console.error('run-in-card: ' + e.message); process.exit(2); }
  const [cmd, ...args] = argv.slice(sep + 1);
  const res = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, env: { ...process.env, ...env } });
  if (res.error) { console.error('run-in-card: ' + res.error.message); process.exit(2); }
  process.exit(res.status === null ? 1 : res.status);
}
