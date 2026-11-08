#!/usr/bin/env node
'use strict';
// An action on the human's command "connect Jev": switches the Plumb's executor from haiku to
// the external deciding model. It does not call Jev itself - only checks the condition and edits PROJECT.md.
//
// Usage: node .claude/scripts/plumb-switch.cjs [--root DIR]
// Exit code 0 - switched, the question to ask the human printed (the call limit).
// Exit code 2 - a stop: no OPENROUTER_API_KEY in .env, PROJECT.md untouched (prohibition 15).
//
// Printed labels come from the core dictionary: English key in code, ru value as data.

const fs = require('fs');
const path = require('path');
const i18n = require('../../.forma/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');

function hasKey(root) {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return false;
  const m = /^OPENROUTER_API_KEY=(.*)$/m.exec(fs.readFileSync(envPath, 'utf8'));
  return !!(m && m[1].trim());
}

function switchProjectMd(root) {
  const file = path.join(root, 'project', 'config', 'PROJECT.md');
  const before = fs.readFileSync(file, 'utf8');
  // Only the selector word in the Plumb `plumb` row is changed (by any label of routes.plumb, ru or en);
  // the thresholds and the rest of the same cell's text (they belong to haiku) are not touched -
  // the prohibition on setting the Jev thresholds of one's own accord.
  const after = before.replace(
    new RegExp('(\\|\\s*(?:' + i18n.alt('routes.plumb') + ') `plumb`[^|]*\\|\\s*)`haiku`'),
    '$1`jev`'
  );
  if (after === before) {
    throw new Error(msg('pswitch.not_found'));
  }
  fs.writeFileSync(file, after, 'utf8');
  return file;
}

function main() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--root');
  const root = i >= 0 ? path.resolve(argv[i + 1]) : process.cwd();

  if (!hasKey(root)) {
    console.error(
      msg('pswitch.stop_no_key')
    );
    process.exit(2);
  }

  const file = switchProjectMd(root);
  console.log(msg('pswitch.written', { file }));
  console.log(msg('pswitch.thresholds_note'));
  console.log(
    msg('pswitch.ask_human')
  );
}

main();
