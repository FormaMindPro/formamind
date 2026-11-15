// The installer's hygiene pass over the engine folders: a foreign file moves into project/source/engine-archive-*/,
// a stale forma file is removed, hook registrations pointing at archived files are cleaned; the journal rolls back.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const FORMA = path.resolve(__dirname, '..', 'bin', 'forma.cjs')
const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'layout', 'clean-engine-files.cjs')
const { cleanEngineFiles, rollback } = require(SCRIPT)

function w(dir, f, t = 'x') {
  fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true })
  fs.writeFileSync(path.join(dir, f), t)
}
const abs = (dir, ...p) => path.join(dir, ...p)

// a mini tree: three owned files (the installer wrote them this pass), a foreign file with its hook,
// a stale forma file (the previous manifest lists it), an extension copy, a protected name
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-clean-'))
  w(dir, '.claude/agents/kit.md', 'role kit')
  w(dir, '.claude/scripts/check-ready.sh', 'echo ok')
  w(dir, '.claude/hooks/check-ready.sh', 'echo ok')
  w(dir, '.claude/agents/gsd-fake.md', 'foreign role, dated 2025-01-15')
  w(dir, '.claude/hooks/gsd-fake.js', 'module.exports = 1')
  w(dir, '.claude/scripts/old-forma.sh', 'echo old')
  w(dir, '.claude/agents/ext-role.md', '# extension')
  w(dir, '.claude/hooks/project-layer.txt', 'layer')
  w(dir, '.claude/settings.json', JSON.stringify({
    hooks: {
      SessionStart: [
        { matcher: 'startup', hooks: [{ type: 'command', command: 'node .claude/hooks/gsd-fake.js' }] },
        { matcher: 'startup', hooks: [{ type: 'command', command: 'bash .claude/hooks/check-ready.sh' }] },
      ],
    },
  }, null, 2))
  w(dir, '.forma/install-manifest.json', JSON.stringify({
    manifestVersion: 1,
    files: { '.claude/scripts/old-forma.sh': 'a', '.claude/hooks/check-ready.sh': 'b', '.claude/agents/kit.md': 'c' },
  }))
  return dir
}

const ownedOf = (dir) => new Set([
  abs(dir, '.claude', 'agents', 'kit.md'),
  abs(dir, '.claude', 'scripts', 'check-ready.sh'),
  abs(dir, '.claude', 'hooks', 'check-ready.sh'),
])

test('the foreign file is archived, the stale forma file removed, the hook cleaned; the journal rolls back', () => {
  const dir = fixture()
  const owned = ownedOf(dir)
  const ext = new Set([abs(dir, '.claude', 'agents', 'ext-role.md')])
  const r = cleanEngineFiles(dir, { owned, extensionPaths: ext })
  assert.equal(r.archived, 2)
  assert.equal(r.deleted, 1)
  assert.equal(r.unhooked, 1)
  assert.match(r.report, /foreign files: 2 archived → project\/source\/engine-archive-/)
  assert.match(r.report, /1 stale forma files removed/)
  assert.match(r.report, /1 hook entries cleaned/)
  assert.match(r.report, /journal \.forma\/living\/migrations\/engine-clean-/)
  // the archive holds the foreign files whole, relative paths kept
  const arc = abs(dir, r.archiveDir)
  assert.equal(fs.readFileSync(abs(arc, '.claude', 'agents', 'gsd-fake.md'), 'utf8'), 'foreign role, dated 2025-01-15')
  assert.ok(fs.existsSync(abs(arc, '.claude', 'hooks', 'gsd-fake.js')))
  // the sources are gone; owned, extension, protected and manifest-listed-owned stay
  assert.ok(!fs.existsSync(abs(dir, '.claude', 'agents', 'gsd-fake.md')))
  assert.ok(!fs.existsSync(abs(dir, '.claude', 'hooks', 'gsd-fake.js')))
  assert.ok(!fs.existsSync(abs(dir, '.claude', 'scripts', 'old-forma.sh')), 'stale forma file removed')
  assert.ok(fs.existsSync(abs(dir, '.claude', 'agents', 'kit.md')))
  assert.ok(fs.existsSync(abs(dir, '.claude', 'agents', 'ext-role.md')))
  assert.ok(fs.existsSync(abs(dir, '.claude', 'scripts', 'check-ready.sh')))
  assert.ok(fs.existsSync(abs(dir, '.claude', 'hooks', 'project-layer.txt')), 'protected name kept')
  // the journal: every action, the rollback command inside
  const j = JSON.parse(fs.readFileSync(abs(dir, r.journal), 'utf8'))
  const kinds = j.actions.map((a) => a.action).sort()
  assert.deepEqual(kinds, ['archive', 'archive', 'delete', 'unhook'])
  assert.match(j.actions.find((a) => a.action === 'delete').note, /reinstalling the old package/)
  assert.match(j.rollback, /--rollback/)
  // the hook registration is cut out, the forma hook and the JSON shape stay
  const s = JSON.parse(fs.readFileSync(abs(dir, '.claude', 'settings.json'), 'utf8'))
  const text = JSON.stringify(s)
  assert.ok(!text.includes('gsd-fake'))
  assert.ok(text.includes('check-ready.sh'))
  assert.equal(s.hooks.SessionStart.length, 2)
  // rollback: the archives move home, the hook goes back, the stale forma file stays gone
  const b = rollback(dir, r.journal)
  assert.equal(b.restored, 2)
  assert.equal(b.rehooked, 1)
  assert.equal(b.skipped, 1)
  assert.equal(fs.readFileSync(abs(dir, '.claude', 'agents', 'gsd-fake.md'), 'utf8'), 'foreign role, dated 2025-01-15')
  assert.ok(!fs.existsSync(abs(arc, '.claude', 'agents', 'gsd-fake.md')))
  assert.match(fs.readFileSync(abs(dir, '.claude', 'settings.json'), 'utf8'), /gsd-fake\.js/)
  assert.ok(!fs.existsSync(abs(dir, '.claude', 'scripts', 'old-forma.sh')), 'a stale forma file has no content rollback')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('the zcode mirror zone follows the regeneration: foreign mirrors archive, forma mirrors stay', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-clean-mirror-'))
  w(dir, '.claude/agents/kit.md', 'role kit')
  w(dir, '.zcode/rules/zcode-8.md', 'rules')
  w(dir, '.zcode/agents/shipped.md', 'shipped snapshot role')
  w(dir, '.zcode/agents/kit.md', 'mirror of kit')
  w(dir, '.zcode/agents/gsd-mirror.md', 'mirror of a gone foreign source')
  w(dir, '.zcode/rules/gsd-junk.md', 'junk in a managed rules folder')
  // the fake regeneration: the mirror it would write now is kit.md only
  w(dir, '.zcode/scripts/gen-roles.cjs', "console.log('kit.md')")
  const owned = new Set([abs(dir, '.claude', 'agents', 'kit.md'), abs(dir, '.zcode', 'rules', 'zcode-8.md'), abs(dir, '.zcode', 'agents', 'shipped.md')])
  const r = cleanEngineFiles(dir, { owned, mirrors: [{ target: '.zcode/agents', genScript: '.zcode/scripts/gen-roles.cjs' }] })
  assert.equal(r.archived, 2)
  assert.ok(fs.existsSync(abs(dir, '.zcode', 'agents', 'kit.md')), 'the regeneration names it - forma mirror kept')
  assert.ok(fs.existsSync(abs(dir, '.zcode', 'agents', 'shipped.md')))
  assert.ok(!fs.existsSync(abs(dir, '.zcode', 'agents', 'gsd-mirror.md')), 'no source, no longer named - archived')
  assert.ok(!fs.existsSync(abs(dir, '.zcode', 'rules', 'gsd-junk.md')))
  assert.ok(fs.existsSync(abs(dir, '.zcode', 'scripts', 'gen-roles.cjs')), 'not a managed zone - the generator itself stays')
  const arc = abs(dir, r.archiveDir)
  assert.equal(fs.readFileSync(abs(arc, '.zcode', 'agents', 'gsd-mirror.md'), 'utf8'), 'mirror of a gone foreign source')
  fs.rmSync(dir, { recursive: true, force: true })
})

// The template's files are forma's even when the template step did not run this pass (a plain --yes update
// keeps the recorded template): a skill written this pass, a skill kept as is (whether the previous manifest
// lists it or not) and any file the recorded template still puts in place survive; a file the template no
// longer ships is not in the set and is still removed as stale.
test('template files survive the clean: written this pass, kept as is, expected by the recorded template; a dropped one is still stale', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-clean-template-'))
  w(dir, '.claude/skills/forma-core/SKILL.md', 'engine skill written this pass')
  w(dir, '.claude/skills/novamira-wp-elementor/SKILL.md', 'template skill written this pass')
  w(dir, '.claude/skills/forma-wordpress-novamira/SKILL.md', 'template skill installed by an earlier release')
  w(dir, '.claude/skills/forma-wordpress-novamira/mcp.json', '{}')
  w(dir, '.claude/skills/novamira-wp-deploy/SKILL.md', 'template skill the manifest does not list')
  w(dir, '.claude/skills/old-skill/SKILL.md', 'skill the current template no longer ships')
  w(dir, '.forma/install-manifest.json', JSON.stringify({
    manifestVersion: 1,
    files: {
      '.claude/skills/forma-wordpress-novamira/SKILL.md': 'a',
      '.claude/skills/forma-wordpress-novamira/mcp.json': 'b',
      '.claude/skills/old-skill/SKILL.md': 'c',
    },
  }))
  const owned = new Set([
    abs(dir, '.claude', 'skills', 'forma-core', 'SKILL.md'),
    abs(dir, '.claude', 'skills', 'novamira-wp-elementor', 'SKILL.md'),
  ])
  const template = new Set([
    abs(dir, '.claude', 'skills', 'forma-wordpress-novamira', 'SKILL.md'),
    abs(dir, '.claude', 'skills', 'forma-wordpress-novamira', 'mcp.json'),
    abs(dir, '.claude', 'skills', 'novamira-wp-deploy', 'SKILL.md'),
    abs(dir, '.claude', 'skills', 'novamira-wp-elementor', 'SKILL.md'),
  ])
  const r = cleanEngineFiles(dir, { owned, templatePaths: template })
  assert.equal(r.archived, 0)
  assert.equal(r.deleted, 1)
  assert.match(r.report, /1 stale forma files removed/)
  assert.ok(fs.existsSync(abs(dir, '.claude', 'skills', 'novamira-wp-elementor', 'SKILL.md')), 'a template skill written this pass survives')
  assert.ok(fs.existsSync(abs(dir, '.claude', 'skills', 'forma-wordpress-novamira', 'SKILL.md')), 'a manifest-listed template skill kept as is survives')
  assert.ok(fs.existsSync(abs(dir, '.claude', 'skills', 'forma-wordpress-novamira', 'mcp.json')))
  assert.ok(fs.existsSync(abs(dir, '.claude', 'skills', 'novamira-wp-deploy', 'SKILL.md')), 'a template skill the manifest does not list survives')
  assert.ok(!fs.existsSync(abs(dir, '.claude', 'skills', 'old-skill', 'SKILL.md')), 'a skill the template no longer ships is still removed as stale')
  assert.ok(fs.existsSync(abs(dir, '.claude', 'skills', 'forma-core', 'SKILL.md')), 'the engine skill written this pass stays')
  fs.rmSync(dir, { recursive: true, force: true })
})

// the full scenario of the readiness criterion: a foreign framework (its agent, hook and settings entry)
// sat in the engine folders before the install; after init the install is intact without hand cleaning
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-clean-init-'))
const init = (...extra) => spawnSync(process.execPath, [FORMA, 'init', '--dir', dir, '--engines', 'claude,zcode', '--board', 'skip', '--yes', ...extra], { encoding: 'utf8' })
const p = (...s) => path.join(dir, ...s)
test.after(() => fs.rmSync(dir, { recursive: true, force: true }))

test('full init with a foreign framework planted: the foreign files are archived into project/source/engine-archive-*, the journal written, the hook cleaned, the install intact', () => {
  w(dir, '.claude/agents/gsd-fake.md', 'foreign agent, dated 2025-01-15')
  w(dir, '.claude/hooks/gsd-fake.js', 'module.exports = 1')
  w(dir, '.claude/settings.json', JSON.stringify({
    hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'node .claude/hooks/gsd-fake.js' }] }] },
  }, null, 2))
  const r = init()
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /foreign files: 3 archived → project\/source\/engine-archive-/)
  assert.match(r.stdout, /1 hook entries cleaned/)
  assert.match(r.stdout, /undo: node .*clean-engine-files\.cjs --rollback/)
  assert.match(r.stdout, /install is intact/)
  // the foreign agent, its hook and its mirror are out of the engine folders
  assert.ok(!fs.existsSync(p('.claude', 'agents', 'gsd-fake.md')))
  assert.ok(!fs.existsSync(p('.claude', 'hooks', 'gsd-fake.js')))
  assert.ok(!fs.existsSync(p('.zcode', 'agents', 'gsd-fake.md')), 'the mirror followed its source out')
  // the journal names the archive; the archive holds all three files
  const journal = r.stdout.match(/journal (\.forma\/living\/migrations\/engine-clean-[^)]+\.json)/)[1]
  const j = JSON.parse(fs.readFileSync(p(journal), 'utf8'))
  const archives = j.actions.filter((a) => a.action === 'archive')
  assert.equal(archives.length, 3)
  for (const a of archives) assert.ok(fs.existsSync(p(a.to)), a.to)
  assert.equal(j.actions.filter((a) => a.action === 'unhook').length, 1)
  // the settings hold the forma hooks, not the foreign one
  const s = JSON.parse(fs.readFileSync(p('.claude', 'settings.json'), 'utf8'))
  const text = JSON.stringify(s)
  assert.ok(!text.includes('gsd-fake'))
  assert.ok(text.includes('check-ready.sh'))
})

test('an update finds nothing foreign; the rollback CLI restores the archive and the hook', () => {
  const r = init()
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /foreign files: none/)
  const journal = fs.readdirSync(p('.forma', 'living', 'migrations')).filter((f) => f.startsWith('engine-clean-'))[0]
  const b = spawnSync(process.execPath, [SCRIPT, '--rollback', `.forma/living/migrations/${journal}`, '--root', dir], { encoding: 'utf8' })
  assert.equal(b.status, 0, b.stdout + b.stderr)
  assert.match(b.stdout, /rolled back: 3 archived file\(s\) restored, 1 hook entry re-inserted/)
  assert.ok(fs.existsSync(p('.claude', 'agents', 'gsd-fake.md')))
  assert.ok(fs.existsSync(p('.claude', 'hooks', 'gsd-fake.js')))
  assert.match(fs.readFileSync(p('.claude', 'settings.json'), 'utf8'), /gsd-fake\.js/)
})

// The wiring in bin/forma.cjs: the recorded template's set (the same protectedTemplatePaths the engines get)
// reaches the clean. The live reinstall that exposed the defect ran a plain init --yes: the template step did
// not run ("kept the recorded"), and the clean removed the template's skill files as stale. Now they survive.
const TEMPLATE = 'forma-wordpress-novamira'
test('a plain --yes update on a template project keeps the template files the clean used to remove', () => {
  const tdir = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-clean-tpl-'))
  try {
    const tinit = (...extra) => spawnSync(process.execPath, [FORMA, 'init', '--dir', tdir, '--engines', 'claude', '--board', 'skip', '--yes', ...extra], { encoding: 'utf8' })
    const tp = (...s) => path.join(tdir, ...s)
    const first = tinit('--template', TEMPLATE)
    assert.equal(first.status, 0, first.stdout + first.stderr)
    const skillDirs = fs.readdirSync(tp('.claude', 'skills')).filter((n) => fs.statSync(tp('.claude', 'skills', n)).isDirectory())
    assert.ok(skillDirs.includes(TEMPLATE), 'the template skill dir from the first install')
    // a plain update: no --template flag - the template step does not run ("kept the recorded")
    const upd = tinit()
    assert.equal(upd.status, 0, upd.stdout + upd.stderr)
    assert.match(upd.stdout, /kept the recorded/)
    assert.match(upd.stdout, /foreign files: none/, 'the clean keeps every template file: ' + upd.stdout)
    for (const s of skillDirs) {
      for (const rel of fs.readdirSync(tp('.claude', 'skills', s), { recursive: true })) {
        assert.ok(fs.existsSync(tp('.claude', 'skills', s, rel)), 'the template skill survives the update clean: ' + s + '/' + rel)
      }
    }
    assert.ok(fs.existsSync(tp('.claude', 'agents', 'run', 'run-site-upload.md')), 'a template run role survives the update clean')
    assert.match(fs.readFileSync(tp('.claude', 'project-layer.txt'), 'utf8'), /run-site-upload\.md/, 'project-layer.txt keeps the recorded roles')
  } finally { fs.rmSync(tdir, { recursive: true, force: true }) }
})
