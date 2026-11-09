// project/extensions/: the project's own work survives uninstall and reinstall; the copies in the engine directories are secondary.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const FORMA = path.resolve(__dirname, '..', 'bin', 'forma.cjs')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-ext-'))
const forma = (...a) => spawnSync(process.execPath, [FORMA, ...a, '--dir', dir], { encoding: 'utf8' })
const init = () => forma('init', '--engines', 'claude', '--template', 'none', '--board', 'skip', '--lang', 'en', '--yes', '--no-dashboard')
const ext = (...a) => spawnSync(process.execPath, [path.join(dir, '.forma', 'extensions', 'extensions.cjs'), ...a, '--dir', dir], { encoding: 'utf8' })
const p = (...s) => path.join(dir, ...s)
const read = (...s) => fs.readFileSync(p(...s), 'utf8')

test.after(() => fs.rmSync(dir, { recursive: true, force: true }))

test('the install creates project/extensions/ with a README and lays the sync script into .forma/', () => {
  const r = init()
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.ok(fs.existsSync(p('project', 'extensions', 'README.md')))
  assert.ok(fs.existsSync(p('.forma', 'extensions', 'extensions.cjs')))
  assert.ok(!fs.existsSync(p('.forma', 'extensions', 'PROJECT-README.md')))
  assert.ok(fs.existsSync(p('.claude', 'hooks', 'sync-extensions.sh')))
  assert.match(read('.claude', 'settings.json'), /sync-extensions\.sh/)
})

test('sync copies the project file, marks the engine file overlap, check sees a copy edit', () => {
  fs.mkdirSync(p('project', 'extensions', 'claude', 'agents', 'run'), { recursive: true })
  fs.writeFileSync(p('project', 'extensions', 'claude', 'agents', 'run', 'run-seo.md'), '# mine\n')
  fs.writeFileSync(p('project', 'extensions', 'claude', 'agents', 'run', 'run-text.md'), '# override\n')
  const r = ext('sync')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /override: \.claude\/agents\/run\/run-text\.md/)
  assert.equal(read('.claude', 'agents', 'run', 'run-seo.md'), '# mine\n')
  assert.equal(read('.claude', 'agents', 'run', 'run-text.md'), '# override\n')
  assert.match(read('.gitignore'), /\/\.claude\/agents\/run\/run-seo\.md/)
  assert.equal(ext('check').status, 0)

  fs.appendFileSync(p('.claude', 'agents', 'run', 'run-seo.md'), 'hand edit\n')
  const c = ext('check')
  assert.equal(c.status, 1)
  assert.match(c.stdout, /edited by hand: \.claude\/agents\/run\/run-seo\.md/)
  const s = ext('sync')
  assert.equal(s.status, 1)
  assert.match(read('.claude', 'agents', 'run', 'run-seo.md'), /hand edit/) // the edit was not silently overwritten
})

test('uninstall: a dry-run lists the foreign files, --yes moves them into extensions/ before the engine removal', () => {
  fs.mkdirSync(p('.claude', 'scripts'), { recursive: true })
  fs.writeFileSync(p('.claude', 'scripts', 'my-tool.cjs'), 'x\n')
  const d = forma('uninstall')
  assert.match(d.stdout, /\.claude\/scripts\/my-tool\.cjs -> project\/extensions\/claude\/scripts\/my-tool\.cjs/)
  assert.match(d.stdout, /run-seo\.md\.edited/)
  assert.doesNotMatch(d.stdout, /run-text\.md ->/) // a copy, not an edit
  assert.ok(!fs.existsSync(p('project', 'extensions', 'claude', 'scripts', 'my-tool.cjs')), 'the dry-run moves nothing')

  const r = forma('uninstall', '--yes')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.ok(!fs.existsSync(p('.claude')))
  assert.equal(read('project', 'extensions', 'claude', 'scripts', 'my-tool.cjs'), 'x\n')
  assert.match(read('project', 'extensions', 'claude', 'agents', 'run', 'run-seo.md.edited'), /hand edit/)
  assert.equal(read('project', 'extensions', 'claude', 'agents', 'run', 'run-seo.md'), '# mine\n') // the source untouched
  assert.doesNotMatch(read('.gitignore'), /Forma: extension copies/)
})

test('a reinstall returns the work into the engine directory with no manual steps', () => {
  fs.rmSync(p('project', 'extensions', 'claude', 'agents', 'run', 'run-seo.md.edited'))
  const r = init()
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /override: \.claude\/agents\/run\/run-text\.md/)
  assert.equal(read('.claude', 'agents', 'run', 'run-seo.md'), '# mine\n')
  assert.equal(read('.claude', 'agents', 'run', 'run-text.md'), '# override\n')
  assert.equal(read('.claude', 'scripts', 'my-tool.cjs'), 'x\n')
  assert.equal(ext('check').status, 0)
  assert.equal(read('project', 'extensions', 'claude', 'agents', 'run', 'run-seo.md'), '# mine\n')
})

test('the source removed - the untouched copy removed too', () => {
  fs.rmSync(p('project', 'extensions', 'claude', 'agents', 'run', 'run-seo.md'))
  const r = ext('sync')
  assert.match(r.stdout, /removed: \.claude\/agents\/run\/run-seo\.md/)
  assert.ok(!fs.existsSync(p('.claude', 'agents', 'run', 'run-seo.md')))
})

test('template/ is copied, then custom/ overrides; check without drift', () => {
  for (const layer of ['template', 'custom']) fs.mkdirSync(p('project', 'extensions', layer, 'claude', 'agents', 'run'), { recursive: true })
  const run = (layer, name, text) => fs.writeFileSync(p('project', 'extensions', layer, 'claude', 'agents', 'run', name), text)
  run('template', 'run-a.md', '# template a\n')
  run('template', 'run-b.md', '# template b\n')
  run('custom', 'run-b.md', '# custom b\n')
  const r = ext('sync')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(read('.claude', 'agents', 'run', 'run-a.md'), '# template a\n')
  assert.equal(read('.claude', 'agents', 'run', 'run-b.md'), '# custom b\n')
  const c = ext('check')
  assert.equal(c.status, 0, c.stdout)
})
