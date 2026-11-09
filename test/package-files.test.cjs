// Everything bin/forma.cjs requires from scripts/ is part of the package "files": otherwise npx github:... will not find the module.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const files = require('../package.json').files
const covered = (rel) => files.some((f) => (f.endsWith('/') ? rel.startsWith(f) : rel === f))

test('the scripts bin/forma.cjs requires are part of the package "files"', () => {
  const src = fs.readFileSync(path.join(root, 'bin', 'forma.cjs'), 'utf8')
  const used = [...src.matchAll(/require\('\.\.\/(scripts\/[^']+)'\)/g)].map((m) => m[1])
  assert.ok(used.length > 0)
  for (const rel of used) {
    assert.ok(fs.existsSync(path.join(root, rel)), rel + ' exists')
    assert.ok(covered(rel), rel + ' is not part of the package.json "files"')
  }
})
