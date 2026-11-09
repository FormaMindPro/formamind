'use strict';

/**
 * The command line: flag search and argument parsing. Part of the core's shared library (`.forma/dashboard/lib/`).
 * Three ways to read the same `argv` - by what the script needs from the value; the choice is the caller's.
 */

/**
 * Search over `argv` (without `node` and the script's path or with them - the indices do not matter).
 *   flag('dry')      - the flag is there
 *   arg('kind', d)   - the value after `--kind`; no next one or the next is itself a flag - `d`
 *   value('n', d)    - the raw next word after `--n` (the flag last - `undefined`, not `d`); no flag - `d`
 *   values('over')   - all values of a repeatable flag, raw
 *   eq('only', d)    - the value in the `--only=x` form
 *   positional()     - the words not starting with `--`
 *   die(prefix)      - prints `<prefix>: <message>` to stderr and ends the process with code 2
 */
function makeCli(argv = process.argv.slice(2)) {
  const name = (n) => '--' + n;
  return {
    argv,
    flag: (n) => argv.includes(name(n)),
    arg(n, def) {
      const i = argv.indexOf(name(n));
      return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
    },
    value(n, def) {
      const i = argv.indexOf(name(n));
      return i > -1 ? argv[i + 1] : def;
    },
    values: (n) => argv.flatMap((a, i) => a === name(n) ? [argv[i + 1]] : []),
    eq(n, def) {
      const p = name(n) + '=';
      const a = argv.find((x) => x.startsWith(p));
      return a === undefined ? def : a.slice(p.length);
    },
    positional: () => argv.filter((a) => !a.startsWith('--')),
    die: (prefix) => (msg) => { console.error(prefix + ': ' + msg); process.exit(2); },
  };
}

/**
 * All `--name`s at once into an object. A repeat - the last one wins.
 *   greedy: false (the default) - a flag without a value (no next word or the next is a flag) gets `true`
 *     and does not swallow the neighboring argument;
 *   greedy: true - the next word is always the flag's value (even `--x`); a last flag without a value - `undefined`.
 */
function parseOptions(argv, { greedy = false } = {}) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const name = argv[i].slice(2);
    const next = argv[i + 1];
    if (greedy) { out[name] = next; i++; }
    else if (next === undefined || next.startsWith('--')) out[name] = true;
    else { out[name] = next; i++; }
  }
  return out;
}

/**
 * Parsing by a list of known flags: `{ '--prompt': 'prompt', '--max-tokens': ['maxTokens', (v) => parseInt(v, 10)] }`.
 * A known flag takes the next word as is; an unknown word is skipped for one step - the unknown flag's
 * value is itself parsed as a word (that is how the external model's former parsing read).
 * Returns `target`, completed with what was found.
 */
function parseKnown(argv, spec, target = {}) {
  for (let i = 0; i < argv.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(spec, argv[i])) continue;
    const s = spec[argv[i]];
    const [key, convert] = Array.isArray(s) ? s : [s];
    const raw = argv[++i];
    target[key] = convert ? convert(raw) : raw;
  }
  return target;
}

/**
 * The words of the `--key=value` and `--key value` forms into an object; `booleans` - flags without a value;
 * the rest - `rest`. The key and the value are strings; `--key` as the last word gives `undefined`.
 */
function parseLong(argv, booleans = []) {
  const opts = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) { rest.push(argv[i]); continue; }
    if (booleans.includes(m[1])) { opts[m[1]] = true; continue; }
    opts[m[1]] = m[2] !== undefined ? m[2] : argv[++i];
  }
  return { opts, rest };
}

module.exports = { makeCli, parseOptions, parseKnown, parseLong };
