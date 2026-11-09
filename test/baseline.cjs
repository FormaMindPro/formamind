#!/usr/bin/env node
// The "before" reference for a refactoring: the buildData snapshot and the check outputs on the fixture.
//   node test/baseline.cjs save   - write into test/.baseline/ (outside git: depends on the OS and line endings)
//   node test/baseline.cjs diff   - compare the current with the recorded; a drift - exit code 1
// npm test compares against test/.baseline/ itself when it exists.
const fs = require('node:fs');
const path = require('node:path');
const { makeFixture } = require('./helpers/fixture.cjs');
const { collect } = require('./helpers/outputs.cjs');

const DIR = path.join(__dirname, '.baseline');

function firstDiff(a, b) {
  const al = a.split('\n');
  const bl = b.split('\n');
  for (let i = 0; i < Math.max(al.length, bl.length); i++) {
    if (al[i] !== bl[i]) return `line ${i + 1}:\n  was:  ${al[i]}\n  now: ${bl[i]}`;
  }
  return '';
}

function main() {
  const mode = process.argv[2];
  if (mode !== 'save' && mode !== 'diff') {
    console.error('usage: node test/baseline.cjs save|diff');
    process.exit(2);
  }
  const fx = makeFixture();
  try {
    const now = collect(fx);
    if (mode === 'save') {
      fs.mkdirSync(DIR, { recursive: true });
      for (const [name, text] of Object.entries(now)) fs.writeFileSync(path.join(DIR, name), text);
      console.log(`written ${Object.keys(now).length} files -> ${path.relative(process.cwd(), DIR)}`);
      return;
    }
    let bad = 0;
    for (const [name, text] of Object.entries(now)) {
      const file = path.join(DIR, name);
      if (!fs.existsSync(file)) { console.log(`no ${name} - run save first`); bad++; continue; }
      const d = firstDiff(fs.readFileSync(file, 'utf8'), text);
      console.log(d ? `✗ ${name}: ${d}` : `✓ ${name}`);
      if (d) bad++;
    }
    process.exitCode = bad ? 1 : 0;
  } finally {
    fx.cleanup();
  }
}

main();
