#!/usr/bin/env node
'use strict'
// Installer of the Forma protocol: `npx github:FormaMindPro/formamind init`.
// Dependency-free Node. Always installs the core, then three steps: engines, project template, Kanban Markdown.
// A rerun is an update: the schema configuration is overwritten; `project/`, the board and `.forma/living/` are left alone.

const fs = require('node:fs')
const path = require('node:path')
const readline = require('node:readline')
const { spawnSync } = require('node:child_process')
const os = require('node:os')
const { walk, projectFile } = require('../skills/forma/core/dashboard/lib/fs.cjs')
const i18n = require('../skills/forma/core/i18n/index.cjs')
const { parseLong } = require('../skills/forma/core/dashboard/lib/cli.cjs')
const verifyInstall = require('../skills/forma/core/verify/verify-install.cjs')
const extensions = require('../skills/forma/core/extensions/extensions.cjs')
const adoptExisting = require('../scripts/layout/adopt-existing.cjs')
const { findBash } = require('../skills/forma/adapters/claude/verify-profile.cjs')

const PKG = path.resolve(__dirname, '..')
const VERSION = require('../package.json').version
// Protocol line: version numbering was once reset (0.4.x -> 0.0.x), so semver alone cannot tell newer from older.
// The line is compared first (a missing one is line 1), semver only within one line.
const LINE = Number(require('../package.json').line) || 1
const SKILL = path.join(PKG, 'skills', 'forma')
const CORE = path.join(SKILL, 'core')
const ADAPTERS = path.join(SKILL, 'adapters')
const TEMPLATES = path.join(PKG, 'templates')
const SCAFFOLD = path.join(TEMPLATES, '_scaffold')
const EXT_ID = 'LachyFS.kanban-markdown'
const EDITOR_CLIS = ['code', 'antigravity-ide', 'antigravity']
const ENGINES = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'gemini', label: 'Gemini (Antigravity)' },
  { id: 'zcode', label: 'ZCode' },
  { id: 'codex', label: 'Codex' },
  { id: 'minimax', label: 'MiniMax Code' },
]
// Dormant engines (core/engines.json): shipped as files, but not offered in the menu and not installed; wake up = remove from the list.
const DORMANT = (() => { try { return JSON.parse(fs.readFileSync(path.join(CORE, 'engines.json'), 'utf8')).dormant || [] } catch { return [] } })()
const ACTIVE_ENGINES = ENGINES.filter((e) => !DORMANT.includes(e.id))

// ---------- arguments ----------
function parseArgs(argv) {
  const { opts, rest } = parseLong(argv, ['help', 'yes', 'version', 'dashboard', 'no-dashboard', 'adopt', 'no-adopt', 'check', 'allow-downgrade'])
  const o = { cmd: 'init', dir: process.cwd(), ...opts }
  if (rest[0]) o.cmd = rest[0]
  o.dir = path.resolve(o.dir)
  return o
}

const HELP = `forma ${VERSION} init — install/update the Forma protocol in the current folder

  npx github:FormaMindPro/formamind init [flags]

  --engines  claude[,gemini,zcode]   engines (claude is always core; codex and minimax are dormant: core/engines.json)
  --template <name>|none             project template from templates/ (default: none)
  --board    auto|skip               Kanban Markdown: find editor CLIs and install (default: auto)
  --lang     <code>                  project document language (default: en). Catalogs shipped: en, ru; any other code (fr, de, ...)
                                     works too: the agent translates the scaffold after install, hook messages stay English
  --dir      <path>                  project root (default: current folder)
  --compact  <n>|off                 Claude Code auto-compact window for this project (default: 250000); off — leave
                                     Claude Code's default. Your own value (env, ~/.claude, settings.local.json) is never changed
  --adopt / --no-adopt               first install only: move the folders and files already in the project root into
                                     project/source/; only the protocol's files, Git's and .env* stay in the
                                     root. Without either flag: asked in a terminal, skipped otherwise
  --allow-downgrade                  install even if this installer is older than the installed version or than the .forma/protocol clone
  --yes                              no questions, defaults for anything missing
  --dashboard / --no-dashboard       start the dashboard at the end (default: start it when run in a terminal); print the link either way
  --version                          print the installer version and exit

  npx github:FormaMindPro/formamind uninstall [--dir <path>] [--yes]
                                     remove the protocol from the project (engine folders, .forma, AGENTS.md, .env.example,
                                     installer lines in .gitignore). Dry run unless --yes. project/, .devtool/, .env, .mcp.json stay

  npx github:FormaMindPro/formamind extensions [--check] [--dir <path>]
                                     copy project/extensions/<engine>/ into the engine folders (project wins on a name clash);
                                     --check only reports missing, stale and hand-edited copies

All four flags set (or --yes, or no terminal) — the menu is not shown.
`

// ---------- input ----------
function makeAsk() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const lines = []
  let waiter = null
  rl.on('line', (l) => { if (waiter) { const w = waiter; waiter = null; w(l) } else lines.push(l) })
  rl.on('close', () => { if (waiter) { const w = waiter; waiter = null; w('') } })
  const ask = (q) => new Promise((res) => {
    process.stdout.write(q)
    if (lines.length) { const l = lines.shift(); process.stdout.write(l + '\n'); res(l) } else waiter = res
  })
  ask.close = () => rl.close()
  return ask
}

// ---------- files ----------
const stats = { written: 0, kept: 0 }
const owned = new Set() // files written by the installer in this pass: the install manifest is built from them
// live counter of installed files (terminal only, so piped output and tests stay clean)
function progress() {
  if (process.stdout.isTTY && stats.written % 5 === 0) process.stdout.write(`\r  installing files: ${stats.written}`)
}
function progressDone() {
  if (process.stdout.isTTY) process.stdout.write(`\r  installing files: ${stats.written} — done
`)
}
function copyFile(src, dst, { overwrite = true } = {}) {
  if (fs.existsSync(dst) && !overwrite) { stats.kept++; return false }
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(src, dst)
  stats.written++
  progress()
  owned.add(dst)
  return true
}
function copyTree(src, dst, opts = {}) {
  if (!fs.existsSync(src)) return
  const st = fs.statSync(src)
  if (st.isFile()) { copyFile(src, dst, opts); return }
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name === '.sessions' || e.name === 'node_modules') continue
    const s = path.join(src, e.name)
    const d = path.join(dst, e.name)
    if (opts.skip && opts.skip(d)) { stats.kept++; continue }
    if (e.isDirectory()) copyTree(s, d, opts)
    else copyFile(s, d, opts)
  }
}
function ensureLine(file, line, comment) {
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  if (text.split(/\r?\n/).some((l) => l.trim() === line)) return
  fs.appendFileSync(file, (text && !text.endsWith('\n') ? '\n' : '') + (comment ? `# ${comment}\n` : '') + line + '\n')
}

// ---------- step 0: Git ----------
function gitBoundary(root) {
  const r = spawnSync(process.execPath, [path.join(PKG, 'scripts', 'initialize-project-git.cjs'), root], { encoding: 'utf8' })
  if (r.status !== 0) {
    process.stderr.write(r.stderr || r.stdout)
    process.exit(1)
  }
  return r.stdout.trim()
}

// ---------- adopting an existing folder (first install only) ----------
// What is already in the root moves into project/source/ (scripts/layout/adopt-existing.cjs). Planned before the
// core is copied, applied after it, so project/ still gets its scaffold. An update never adopts: folders made later are the human's.
function isFirstInstall(root) {
  return !fs.existsSync(path.join(root, verifyInstall.MANIFEST))
}

async function chooseAdopt(o, root, ask) {
  if (o['no-adopt'] || !isFirstInstall(root)) return { items: [], note: null }
  const items = adoptExisting.plan(root)
  if (!items.length) return { items, note: null }
  const list = items.map((m) => `${m.name}${m.kind === 'dir' ? '/' : ''}`).join(', ')
  if (o.adopt) return { items, note: null }
  const live = ask || (o.yes || process.stdin.isTTY === false ? null : makeAsk())
  if (!live) return { items: [], note: `adopt: found ${items.length} item(s) in the root (${list}) — not moved; rerun with --adopt to move them into project/source/` }
  console.log(`
Found in the project root: ${list}`)
  console.log("      They can move into project/source/ — only the protocol's files, Git's and .env* stay in the root.")
  const a = (await live('Move them? [y/N]: ')).trim().toLowerCase()
  if (!ask) live.close()
  return a === 'y' || a === '\u0434' || a === 'yes' || a === '\u0434\u0430' ? { items, note: null } : { items: [], note: 'adopt: declined — nothing moved' }
}

function adoptStep(root, adopt) {
  if (adopt.note) return adopt.note
  if (!adopt.items.length) return 'adopt: nothing to move'
  let r
  try { r = adoptExisting.apply(root, adopt.items) } catch (e) { return `adopt: failed (${e.message}) — nothing is lost; the install goes on, run adopt-existing.cjs --apply afterwards` }
  const script = path.join(PKG, 'scripts', 'layout', 'adopt-existing.cjs')
  const parts = [`adopt: ${r.moved} item(s) moved into project/source/${r.journal ? ` (journal ${r.journal}; undo: node ${script} --rollback ${r.journal} --root .)` : ''}`]
  if (r.failed.length) parts.push(`adopt: NOT moved — ${r.failed.map((f) => `${f.name} (${f.error})`).join('; ')}. Close whatever holds them (editor, Explorer), then: node ${script} --apply --allow-dirty --root .`)
  return parts.join('\n')
}

// ---------- core ----------
function installCore(root, protectedPaths, lang = 'en') {
  const skip = (d) => protectedPaths.has(path.resolve(d))
  const forma = path.join(root, '.forma')
  copyFile(path.join(CORE, 'AGENTS.md'), path.join(root, 'AGENTS.md'))
  copyFile(path.join(CORE, 'engines.json'), path.join(forma, 'engines.json'))
  copyTree(path.join(CORE, 'manual'), path.join(forma, 'manual'))
  copyTree(path.join(CORE, 'board'), path.join(forma, 'board'))
  copyTree(path.join(CORE, 'verify'), path.join(forma, 'verify'))
  copyTree(path.join(CORE, 'plumb'), path.join(forma, 'plumb')) // the Plumb driver the roles call: node .forma/plumb/plumb-run.cjs
  copyTree(path.join(CORE, 'i18n'), path.join(forma, 'i18n'))
  copyTree(path.join(CORE, 'extensions'), path.join(forma, 'extensions'), { skip: (d) => path.basename(d) === 'PROJECT-README.md' })
  copyTree(path.join(CORE, 'skills'), path.join(forma, 'skills'), { skip })
  // dashboard: code is overwritten, the human's settings are not
  copyTree(path.join(CORE, 'dashboard'), path.join(forma, 'dashboard'), {
    skip: (d) => /graphify\.config\.json$/.test(d) && fs.existsSync(d),
  })
  // living files — only add what is missing
  copyTree(path.join(CORE, 'living'), path.join(forma, 'living'), { overwrite: false })
  const features = path.join(root, '.devtool', 'features')
  const boardState = fs.existsSync(features) ? 'already present, untouched' : 'created'
  if (!fs.existsSync(features)) copyTree(path.join(CORE, '.devtool', 'features'), features)
  // project/ — first install only
  const projectDir = path.join(root, 'project')
  let projectState = 'already existed, untouched'
  if (!fs.existsSync(projectDir)) {
    const scaffoldDir = path.join(SCAFFOLD, lang)
    const enScaffold = path.join(SCAFFOLD, 'en')
    const src = fs.existsSync(scaffoldDir) ? scaffoldDir : (fs.existsSync(enScaffold) ? enScaffold : path.join(CORE, 'project'))
    copyTree(src, projectDir)
    projectState = 'scaffold created'
  }
  // project/extensions/ — the project's own roles, skills, scripts; never overwritten, survives uninstall
  const extReadme = path.join(root, extensions.ROOT_DIR, 'README.md')
  if (!fs.existsSync(extReadme)) {
    const langExtReadme = path.join(SCAFFOLD, lang, 'extensions', 'README.md')
    if (fs.existsSync(langExtReadme)) copyFile(langExtReadme, extReadme)
    else copyFile(path.join(CORE, 'extensions', 'PROJECT-README.md'), extReadme)
  }
  ensureLine(path.join(root, '.gitignore'), '.forma/dashboard/.cache/', 'Forma: dashboard runtime')
  ensureLine(path.join(root, '.gitignore'), 'project/cards/*/assets/', 'Forma: card assets stay out of git')
  ensureLine(path.join(root, '.gitignore'), 'project/cards/*/work/', 'Forma: card work files stay out of git')
  return { boardState, projectState, projectCreated: projectState === 'scaffold created' }
}

// ---------- Claude adapter ----------
const CLAUDE_HOOKS = {
  PreToolUse: [{ hooks: ['guard-delete.sh', 'tool-usage.sh'] }],
  UserPromptSubmit: [{ hooks: ['unlock-delete.sh'] }],
  SessionStart: [{ matcher: 'startup', hooks: ['check-ready.sh', ['check-plugin-update.sh', 15], 'check-dashboard.sh', 'intent-start.sh'] }],
  PostToolUse: [{ matcher: 'Write|Edit', hooks: ['check-card.sh', 'sync-extensions.sh', 'auto-graphs.sh'] }],
}
// Auto-compact window. Forma proposes COMPACT_DEFAULT and asks first; the human's own value always wins:
// found in the environment, ~/.claude/settings.json or .claude/settings.local.json, Forma writes nothing. A project
// settings.json value that Forma itself wrote (an old unasked default or the current one) is Forma's to change.
const COMPACT_KEY = 'CLAUDE_CODE_AUTO_COMPACT_WINDOW'
const COMPACT_DEFAULT = '250000'
const COMPACT_OURS = ['200000', COMPACT_DEFAULT] // 200000 was written unasked before the question existed
function envValue(file) {
  try { return (JSON.parse(fs.readFileSync(file, 'utf8')).env || {})[COMPACT_KEY] || null } catch { return null }
}
function ownCompact(root) {
  if (process.env[COMPACT_KEY]) return { value: process.env[COMPACT_KEY], where: 'environment variable' }
  const places = [[path.join(os.homedir(), '.claude', 'settings.json'), '~/.claude/settings.json'], [path.join(root, '.claude', 'settings.local.json'), '.claude/settings.local.json']]
  for (const [file, where] of places) { const value = envValue(file); if (value) return { value, where } }
  const project = envValue(path.join(root, '.claude', 'settings.json'))
  if (project && !COMPACT_OURS.includes(String(project))) return { value: project, where: '.claude/settings.json' }
  return null
}
/** Applies the choice to settings.env; returns the summary line. `compact`: a number string, 'off', or { own }. */
function applyCompact(env, compact) {
  const ours = COMPACT_OURS.includes(String(env[COMPACT_KEY]))
  if (compact.own) {
    if (ours && compact.own.where !== '.claude/settings.json') delete env[COMPACT_KEY]
    return `auto-compact window: your ${compact.own.value} (${compact.own.where}) — left as is`
  }
  if (compact === 'off') { // reached only without a value of the human's own, or by the explicit --compact off
    delete env[COMPACT_KEY]
    return 'auto-compact window: Claude Code default (not set by Forma)'
  }
  env[COMPACT_KEY] = compact
  return `auto-compact window: ${compact} (.claude/settings.json; change it with --compact <n|off>)`
}

function mergeClaudeSettings(root, compact) {
  const file = path.join(root, '.claude', 'settings.json')
  let s = {}
  if (fs.existsSync(file)) {
    try { s = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { throw new Error(`.claude/settings.json is not valid JSON — fix it by hand and rerun`) }
  }
  s.env = s.env || {}
  const compactLine = applyCompact(s.env, compact)
  if (!Object.keys(s.env).length) delete s.env
  s.hooks = s.hooks || {}
  for (const [event, groups] of Object.entries(CLAUDE_HOOKS)) {
    s.hooks[event] = s.hooks[event] || []
    for (const g of groups) {
      let group = s.hooks[event].find((x) => (x.matcher || '') === (g.matcher || ''))
      if (!group) { group = g.matcher ? { matcher: g.matcher, hooks: [] } : { hooks: [] }; s.hooks[event].push(group) }
      group.hooks = group.hooks || []
      for (const h of g.hooks) {
        const [name, timeout] = Array.isArray(h) ? h : [h]
        const command = `bash .claude/hooks/${name}`
        if (group.hooks.some((x) => x.command === command)) continue
        const entry = { type: 'command', command }
        if (timeout) entry.timeout = timeout
        group.hooks.push(entry)
      }
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n')
  return compactLine
}
function installClaude(root, protectedPaths, compact) {
  const A = path.join(ADAPTERS, 'claude')
  const C = path.join(root, '.claude')
  const skip = (d) => protectedPaths.has(path.resolve(d))
  copyFile(path.join(A, 'forma-adapter.cjs'), path.join(C, 'forma-adapter.cjs')) // core/adapter boundary: the core finds it by file name
  copyFile(path.join(A, 'verify-profile.cjs'), path.join(C, 'verify-profile.cjs')) // install verify profile: the core finds it via the manifest
  copyFile(path.join(A, 'permission-levels.json'), path.join(C, 'permission-levels.json')) // access levels read by scripts/permissions-level.cjs
  copyTree(path.join(A, 'rules'), path.join(C, 'rules'))
  copyTree(path.join(A, 'agents'), path.join(C, 'agents'))
  copyTree(path.join(A, 'hooks'), path.join(C, 'hooks'))
  for (const f of fs.readdirSync(path.join(C, 'hooks'))) {
    if (f.endsWith('.sh')) try { fs.chmodSync(path.join(C, 'hooks', f), 0o755) } catch { /* exec bits cannot be set on filesystems without chmod (Windows) — bash will run the hook */ }
  }
  copyTree(path.join(A, 'scripts'), path.join(C, 'scripts'), { skip })
  copyTree(path.join(A, 'skills'), path.join(C, 'skills'), { skip })
  // interview delivered from the core — a copy, no edits
  copyTree(path.join(CORE, 'skills'), path.join(C, 'skills'), { skip })
  copyTree(path.join(A, 'dashboard'), path.join(root, '.forma', 'dashboard'))
  const compactLine = mergeClaudeSettings(root, compact)
  const rootClaude = path.join(root, 'CLAUDE.md')
  const warn = fs.existsSync(rootClaude)
    ? 'CLAUDE.md found in the root — it shadows reading AGENTS.md; move anything unique into .claude/rules/claude-8.md and delete it'
    : null
  return { warn, compactLine }
}

// ---------- templates ----------
function listTemplates() {
  if (!fs.existsSync(TEMPLATES)) return []
  return fs.readdirSync(TEMPLATES, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'))
    .map((e) => {
      const readme = path.join(TEMPLATES, e.name, 'README.md')
      let title = ''
      if (fs.existsSync(readme)) title = (fs.readFileSync(readme, 'utf8').split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#')) || '').trim()
      return { name: e.name, title: title.slice(0, 110) }
    })
}
function readProjectTemplate(root) {
  const f = projectFile(root, 'PROJECT.md')
  if (!fs.existsSync(f)) return null
  const name = i18n.rowValue(i18n.reader(fs.readFileSync(f, 'utf8')).table('template'), 'name')
  const value = name && name.trim()
  return value && value !== '—' && value !== '\u043d\u0435\u0442' && value !== 'none' ? value : null
}
function templateFiles(name) {
  // what a template puts into the project: [source, path in the project]
  const T = path.join(TEMPLATES, name, 'skills')
  const out = []
  const own = path.join(T, name, 'template')
  const add = (src, dst) => {
    for (const rel of walk(src, { symlinks: true })) out.push([path.join(src, rel), path.join(dst, rel)])
  }
  add(path.join(own, 'project'), 'project')
  add(path.join(own, 'scripts'), path.join('.claude', 'scripts'))
  // the template's own skill: SKILL.md and template/mcp.json lie down into .claude/skills/<name>/
  // (mcp.json is data next to the skill - it connects nothing by itself, the SKILL.md step 5b semantics)
  if (fs.existsSync(path.join(T, name, 'SKILL.md'))) out.push([path.join(T, name, 'SKILL.md'), path.join('.claude', 'skills', name, 'SKILL.md')])
  if (fs.existsSync(path.join(own, 'mcp.json'))) out.push([path.join(own, 'mcp.json'), path.join('.claude', 'skills', name, 'mcp.json')])
  // the template's Run roles: .claude/agents/run/ - the names are recorded in .claude/project-layer.txt
  const runDir = path.join(own, 'agents', 'run')
  if (fs.existsSync(runDir)) {
    for (const e of fs.readdirSync(runDir, { withFileTypes: true })) {
      if (e.isFile() && /\.md$/.test(e.name)) out.push([path.join(runDir, e.name), path.join('.claude', 'agents', 'run', e.name)])
    }
  }
  for (const e of fs.readdirSync(T, { withFileTypes: true })) {
    if (e.isDirectory() && e.name !== name) add(path.join(T, e.name), path.join('.claude', 'skills', e.name))
  }
  return out
}
function installTemplate(root, name, projectCreated) {
  const files = templateFiles(name)
  let written = 0, kept = 0
  const runRoles = { written: [], kept: [] }
  const layerLines = []
  for (const [src, rel] of files) {
    const dst = path.join(root, rel)
    const inProject = rel.split(path.sep)[0] === 'project'
    const inRun = rel.startsWith(path.join('.claude', 'agents', 'run') + path.sep)
    if (inRun) layerLines.push('.claude/agents/run/' + path.basename(rel))
    if (inProject && !projectCreated) { if (inRun) runRoles.kept.push(path.basename(rel)); kept++; continue }
    if (fs.existsSync(dst) && !projectCreated) { if (inRun) runRoles.kept.push(path.basename(rel)); kept++; continue }
    copyFile(src, dst); if (inRun) runRoles.written.push(path.basename(rel)); written++
  }
  // the template's run roles travel into .claude/project-layer.txt (the layer-4 list): the names are
  // appended, an existing line and an existing role file are never overwritten silently
  if (layerLines.length) {
    const layerPath = path.join(root, '.claude', 'project-layer.txt')
    let layer = ''
    try { layer = fs.readFileSync(layerPath, 'utf8') } catch { /* no file yet */ }
    const have = new Set(layer.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))
    const add = layerLines.filter((l) => !have.has(l))
    if (add.length) {
      fs.mkdirSync(path.dirname(layerPath), { recursive: true })
      fs.writeFileSync(layerPath, layer + (layer && !layer.endsWith('\n') ? '\n' : '') + add.join('\n') + '\n')
    }
  }
  if (projectCreated) {
    const f = projectFile(root, 'PROJECT.md')
    let t = fs.readFileSync(f, 'utf8')
    // a fresh scaffold is English (translation comes later); the rows are found by anchor
    t = i18n.setRow(t, 'name', `\`${name}\``)
    t = i18n.setRow(t, 'source', `forma plugin, \`templates/${name}\``)
    t = i18n.setRow(t, 'status', '`forming with the human`')
    fs.writeFileSync(f, t)
  }
  return { written, kept, runRoles }
}

// ---------- Kanban Markdown ----------
function runCli(cli, args) {
  const extra = process.env.FORMA_EXTENSIONS_DIR ? ['--extensions-dir', process.env.FORMA_EXTENSIONS_DIR] : []
  const win = process.platform === 'win32'
  const all = [...extra, ...args]
  // Windows: editor CLIs are .cmd wrappers and run only through the shell; arguments are our constants and a quoted path
  return win
    ? spawnSync([cli, ...all.map((a) => (/\s/.test(a) ? `"${a}"` : a))].join(' '), { encoding: 'utf8', shell: true, timeout: 180000 })
    : spawnSync(cli, all, { encoding: 'utf8', timeout: 180000 })
}
function board(mode) {
  const lines = []
  if (mode === 'skip') return [`skipped (--board skip); install it yourself: code --install-extension ${EXT_ID}`]
  let found = 0
  for (const cli of EDITOR_CLIS) {
    const list = runCli(cli, ['--list-extensions'])
    if (list.error || list.status !== 0) continue
    found++
    if (list.stdout.toLowerCase().split(/\r?\n/).includes(EXT_ID.toLowerCase())) { lines.push(`${cli}: ${verifyInstall.colorMark(true)} ok`); continue }
    const inst = runCli(cli, ['--install-extension', EXT_ID])
    const again = runCli(cli, ['--list-extensions'])
    if (inst.status === 0 && again.stdout.toLowerCase().includes(EXT_ID.toLowerCase())) lines.push(`${cli}: ${verifyInstall.colorMark(true)} installed`)
    else lines.push(`${cli}: ${verifyInstall.colorMark(false)} failed — run manually: ${cli} --install-extension ${EXT_ID}`)
  }
  if (!found) lines.push(`No editor CLI found (${EDITOR_CLIS.join(', ')}). Install the extension yourself: code --install-extension ${EXT_ID} (or from the extensions marketplace: Kanban Markdown, LachyFS)`)
  return lines
}

/// step 1: engines — by flag, from the menu, or claude by default; an unknown one exits with 2.
/// Claude Code is the default core: pre-selected as 1, cannot be deselected (the unshift below enforces it).
async function chooseEngines(o, ask) {
  let engines = o.engines
  if (!engines && ask) {
    console.log('\n[1/5] Engines (Claude Code is the core — selected by default):')
    ACTIVE_ENGINES.forEach((e, i) => console.log(e.id === 'claude'
      ? `  ${i + 1}. ${e.label}  ${verifyInstall.colorMark(true)} default — the core, always installed`
      : `  ${i + 1}. ${e.label}`))
    const a = await ask('Numbers to add, comma-separated (Enter — Claude Code only): ')
    engines = (a.trim() || '1').split(/[\s,]+/).map((x) => (ACTIVE_ENGINES[Number(x) - 1] || {}).id || x).join(',')
  }
  engines = (engines || 'claude').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)
  if (!engines.includes('claude')) engines.unshift('claude')
  for (const e of engines) {
    if (DORMANT.includes(e)) { console.error(`Engine ${e} is dormant in this protocol version and is not installed (core/engines.json)`); process.exit(2) }
    if (!ENGINES.some((x) => x.id === e)) { console.error(`Unknown engine: ${e}`); process.exit(2) }
  }
  return engines
}

// step 2: template — by flag, from the menu, or none; an unknown one exits with 2
async function chooseTemplate(o, ask, templates) {
  let template = o.template
  if (!template && ask) {
    console.log('\n[2/5] Project template:')
    console.log('  0. no template — the route is worked out in the interview (default)')
    templates.forEach((t, i) => console.log(`  ${i + 1}. ${t.name}${t.title ? ' — ' + t.title : ''}`))
    const a = (await ask('Number [0]: ')).trim()
    template = !a || a === '0' ? 'none' : ((templates[Number(a) - 1] || {}).name || a)
  }
  template = template || 'none'
  if (template !== 'none' && !templates.some((t) => t.name === template)) { console.error(`No such template: ${template}. Available: ${templates.map((t) => t.name).join(', ') || '—'}`); process.exit(2) }
  return template
}

// step 3: board — by flag, from the menu, or auto
async function chooseBoard(o, ask) {
  let boardMode = o.board
  if (!boardMode && ask) {
    console.log('\n[3/5] Kanban board — the Kanban Markdown editor extension:')
    const a = (await ask('Find editors and install it? [Y/n]: ')).trim().toLowerCase()
    boardMode = a === 'n' || a === '\u043d' || a === 'no' ? 'skip' : 'auto'
  }
  return boardMode || 'auto'
}

// step 4: project document language — by flag, from the menu, or en. A language with a message catalog
// (core/i18n/messages/<code>.json) gets hook output in it; any other code is accepted: the agent translates the scaffold
// (keeping the anchors), the hooks print English.
const MESSAGES = path.join(CORE, 'i18n', 'messages')
const catalogLangs = () => fs.readdirSync(MESSAGES).filter((n) => /^[a-z]{2,3}\.json$/.test(n)).map((n) => n.slice(0, -5)).sort((x, y) => (x === 'en' ? -1 : y === 'en' ? 1 : x.localeCompare(y)))
const scaffoldLangs = () => {
  if (!fs.existsSync(SCAFFOLD)) return ['en']
  return fs.readdirSync(SCAFFOLD, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^[a-z]{2,3}$/.test(e.name))
    .map((e) => e.name)
    .sort((x, y) => (x === 'en' ? -1 : y === 'en' ? 1 : x.localeCompare(y)))
}
// the name written into PROJECT.md: the native name of a known language (from keys.json), else code
const langName = (code) => { const n = (i18n.KEYS.languages[code] || [])[0]; return n ? n[0].toUpperCase() + n.slice(1) : code }
const langDisplay = (code) => {
  const names = i18n.KEYS.languages[code] || []
  const native = names[names.length - 1]
  return native ? native[0].toUpperCase() + native.slice(1) : code
}
async function chooseLang(o, ask) {
  const bundled = scaffoldLangs()
  let lang = o.lang
  if (!lang && ask) {
    console.log('\n[4/5] Project document language:')
    bundled.forEach((id, i) => console.log(`  ${i + 1}. ${langName(id)}${id === 'en' ? ' (default)' : ' (bundled scaffold)'}`))
    console.log('  or type another language code (fr, de, ...): installs English scaffold, agent translates after install')
    const a = (await ask('Number or code [1]: ')).trim()
    lang = !a ? 'en' : (bundled[Number(a) - 1] || a)
  }
  lang = String(lang || 'en').toLowerCase()
  if (!/^[a-z]{2,3}$/.test(lang)) { console.error(`Language not supported: ${lang}. Use a language code such as ${bundled.join(', ')}, fr, de`); process.exit(2) }
  return lang
}

// Project language: a field in PROJECT.md and, for non-bundled languages, a "translation pending" marker — the agent translates, not the installer.
function applyLanguage(root, lang) {
  const f = projectFile(root, 'PROJECT.md')
  let t = fs.readFileSync(f, 'utf8')
  t = t.replace(/(\*\*.*<!--\s*k:language\s*-->[^\n]*?\)\*?:\s*)[^\n.]+/, `$1${langDisplay(lang)}`)
  fs.writeFileSync(f, t)
  if (lang === 'en' || fs.existsSync(path.join(SCAFFOLD, lang))) return null
  const files = []
  for (const rel of walk(path.join(root, 'project'), { symlinks: true })) {
    if (/\.md$/.test(rel) && !rel.startsWith('brief' + path.sep + 'answers')) files.push('project/' + rel.split(path.sep).join('/'))
  }
  const marker = path.join(root, '.forma', 'translation-pending.json')
  fs.mkdirSync(path.dirname(marker), { recursive: true })
  fs.writeFileSync(marker, JSON.stringify({ from: 'en', to: lang, files: files.sort() }, null, 2) + '\n')
  return files.length
}

// Paths the project template already wrote per project/config/PROJECT.md: the core does not overwrite them.
function protectedTemplatePaths(root, existingTemplate) {
  const protectedPaths = new Set()
  if (existingTemplate && fs.existsSync(path.join(TEMPLATES, existingTemplate))) {
    for (const [, rel] of templateFiles(existingTemplate)) protectedPaths.add(path.resolve(root, rel))
  }
  return protectedPaths
}

// Codex (beta): .codex/ and the .agents/skills mirror from the adapter; the project config.toml is not overwritten (it holds the project MCP);
// then sync-codex --apply rebuilds roles and the mirror from .claude/ (Claude Code must be installed).
function installCodex(root, protectedPaths) {
  const A = path.join(ADAPTERS, 'codex')
  const skip = (d) => protectedPaths.has(path.resolve(d))
  const cfg = path.join(root, '.codex', 'config.toml')
  const hadCfg = fs.existsSync(cfg)
  copyTree(path.join(A, '.codex'), path.join(root, '.codex'), { skip: (d) => skip(d) || (hadCfg && path.resolve(d) === path.resolve(cfg)) })
  copyTree(path.join(A, '.agents', 'skills'), path.join(root, '.agents', 'skills'), { skip })
  const out = ['Codex (beta): .codex/ (roles, agents, hooks, tests, §8) and .agents/skills — installed' + (hadCfg ? '; project config.toml kept' : '')]
  const sync = path.join(root, '.codex', 'scripts', 'sync-codex.cjs')
  if (!fs.existsSync(path.join(root, '.claude', 'agents'))) {
    out.push('  ! .claude/agents not found — install Claude Code (--engines claude,codex), then: node .codex/scripts/sync-codex.cjs --apply --plugin <skills/forma>')
  } else {
    const r = require('child_process').spawnSync(process.execPath, [sync, '--apply', '--root', root, '--plugin', SKILL], { encoding: 'utf8' })
    out.push(r.status === 0 ? '  sync-codex --apply: roles and skills mirror built' : '  ! sync-codex --apply exited with code ' + r.status + ': ' + ((r.stdout || '') + (r.stderr || '')).trim().split(/\r?\n/).slice(-3).join(' | '))
  }
  return out
}

// Gemini (beta, Antigravity): §8 wrapper, plugin, node roles; mcp_config.json is an empty stub, an existing one is not touched.
function installGemini(root) {
  const A = path.join(ADAPTERS, 'gemini')
  const P = path.join(root, '.agents', 'plugins', 'forma')
  copyTree(path.join(A, 'rules'), path.join(root, '.agents', 'rules'))
  copyFile(path.join(A, 'forma-adapter.cjs'), path.join(root, '.agents', 'forma-adapter.cjs'))
  copyTree(path.join(A, 'tests'), path.join(root, '.agents', 'tests')) // test-gemini-adapter.cjs: adapter-conformance.cjs looks for it here
  if (fs.existsSync(path.join(A, 'scripts'))) {
    copyTree(path.join(A, 'scripts'), path.join(root, '.agents', 'scripts'))
  }
  if (fs.existsSync(path.join(A, 'hooks'))) {
    copyTree(path.join(A, 'hooks'), path.join(root, '.agents', 'hooks'))
  }
  if (fs.existsSync(path.join(A, 'hooks.json'))) {
    copyFile(path.join(A, 'hooks.json'), path.join(root, '.agents', 'hooks.json'), { overwrite: false })
  }
  copyFile(path.join(A, 'plugin.json'), path.join(P, 'plugin.json'))
  copyTree(path.join(A, 'agents'), path.join(P, 'agents'))
  copyFile(path.join(A, 'mcp_config.json'), path.join(P, 'mcp_config.json'), { overwrite: false })
  if (fs.existsSync(path.join(A, 'mcp_config.json'))) {
    copyFile(path.join(A, 'mcp_config.json'), path.join(root, '.agents', 'mcp_config.json'), { overwrite: false })
  }
  fs.mkdirSync(path.join(root, '.agents', '.ledger'), { recursive: true })
  const ledgerCalls = path.join(root, '.agents', '.ledger', 'calls.jsonl')
  if (!fs.existsSync(ledgerCalls)) fs.writeFileSync(ledgerCalls, '', 'utf8')
  return ['Gemini (Antigravity): .agents/rules, .agents/tests, .agents/plugins/forma (roles, plugin.json) — installed']
}

// ZCode: .zcode/ adapter, rules, agents, tests, scripts. The shared skills mirror comes with it: the adapter
// declares .agents/skills as its skillsDir and the roles read skills there natively, while on a fresh machine
// nobody else installs the mirror (codex, its first consumer, is dormant). Roles are regenerated from
// .claude/agents so the mirror matches the reference actually installed, not the shipped snapshot.
// Machine state (.state/) is never shipped — it belongs to the host, not to the protocol.
// The role mirror (.zcode/agents) is generated from .claude/agents by the shipped gen-roles script.
function rebuildZcodeRoles(root, why) {
  const r = spawnSync(process.execPath, [path.join(root, '.zcode', 'scripts', 'gen-roles.cjs')], { encoding: 'utf8' })
  return r.status === 0
    ? '  gen-roles: role mirror rebuilt from .claude/agents' + (why ? ` — ${why}` : '')
    : '  ! gen-roles exited with code ' + r.status + ': ' + ((r.stdout || '') + (r.stderr || '')).trim().split(/\r?\n/).slice(-3).join(' | ')
}
function installZCode(root) {
  const A = path.join(ADAPTERS, 'zcode')
  const Z = path.join(root, '.zcode')
  copyFile(path.join(A, 'forma-adapter.cjs'), path.join(Z, 'forma-adapter.cjs'))
  copyTree(path.join(A, 'rules'), path.join(Z, 'rules'))
  copyTree(path.join(A, 'tests'), path.join(Z, 'tests'))
  copyTree(path.join(A, 'scripts'), path.join(Z, 'scripts'))
  copyTree(path.join(A, 'agents'), path.join(Z, 'agents'))
  copyTree(path.join(ADAPTERS, 'codex', '.agents', 'skills'), path.join(root, '.agents', 'skills'))
  const out = ['ZCode: .zcode/rules, .zcode/tests, .zcode/scripts, .zcode/agents, .agents/skills (shared mirror) — installed']
  if (fs.existsSync(path.join(root, '.claude', 'agents'))) out.push(rebuildZcodeRoles(root))
  else out.push('  ! .claude/agents not found — roles ship as installed; install Claude Code, then run: node .zcode/scripts/gen-roles.cjs')
  return out
}

// Claude Code runs every hook as `bash .claude/hooks/<name>.sh`: without a working bash the delete guard, the card check
// and the session start all stay silent - the protocol looks installed and enforces nothing.
const NO_BASH = process.platform === 'win32'
  ? 'no working bash found: Claude Code hooks (delete guard, card check, session start) will not run. Install Git for Windows (https://git-scm.com/download/win) and rerun'
  : 'no working bash found: Claude Code hooks (delete guard, card check, session start) will not run. Install bash and rerun'
// project/extensions/ -> engine folders; the project wins on a name clash, a hand-edited copy is kept
function syncExtensions(root, report) {
  extensions.forgetOwned(root, new Set([...owned].map((p) => path.resolve(p))))
  const r = extensions.sync(root)
  if (!r.written.length && !r.drift.length && !r.removed.length) return
  report.push(`extensions: ${r.written.length} copied from project/extensions/` + (r.drift.length ? `; ! ${r.drift.length} edited by hand, kept: ${r.drift.join(', ')}` : ''))
  for (const k of r.overrides) report.push(`  override: ${k} (project replaces the engine default)`)
}
function installEngines(root, choice, protectedPaths, report) {
  for (const e of choice.engines) {
    if (e === 'claude') {
      const { warn, compactLine } = installClaude(root, protectedPaths, choice.compact)
      report.push('Claude Code: .claude/rules, agents, hooks, scripts, skills, settings.json (hooks) — synced')
      report.push('  ' + compactLine)
      if (warn) report.push('  ! ' + warn)
      if (!findBash()) report.push('  ! ' + NO_BASH)
      syncExtensions(root, report) // before Codex: sync-codex builds its roles from .claude/
    } else if (e === 'codex') {
      report.push(...installCodex(root, protectedPaths))
    } else if (e === 'gemini') {
      report.push(...installGemini(root))
    } else if (e === 'zcode') {
      report.push(...installZCode(root))
    }
  }
  syncExtensions(root, report)
}

// Returns the template result (or null when nothing was installed) so install() can react to what was written.
function installTemplateStep({ root, template, existingTemplate }, core, report) {
  if (template === 'none') {
    report.push(`template: ${existingTemplate ? `kept the recorded «${existingTemplate}» (the core does not overwrite its files)` : 'none (project/config/PROJECT.md, "Project template" — can be changed any time)'}`)
    return null
  }
  if (existingTemplate && existingTemplate !== template) {
    report.push(`template: project/config/PROJECT.md already records «${existingTemplate}» — not installing «${template}», project/ untouched`)
    return null
  }
  const t = installTemplate(root, template, core.projectCreated)
  let line = `template ${template}: written ${t.written}, left as is ${t.kept}${core.projectCreated ? '' : ' (project/ already existed — its template files are untouched)'}`
  if (t.runRoles.written.length) line += `; run roles written: ${t.runRoles.written.length}`
  if (t.runRoles.kept.length) line += `; run roles kept (an existing profile is not overwritten): ${t.runRoles.kept.join(', ')}`
  report.push(line)
  return t
}

// Install manifest: what the installer wrote and what must be wired for each ready engine.
function claudeExpect() {
  const hooks = []
  for (const [event, groups] of Object.entries(CLAUDE_HOOKS)) {
    for (const g of groups) for (const h of g.hooks) {
      const [name, timeout] = Array.isArray(h) ? h : [h]
      hooks.push({ event, matcher: g.matcher || '', name, ...(timeout ? { timeout } : {}) })
    }
  }
  return { hooks }
}
function writeManifest(root, { engines, lang, template, projectCreated }) {
  let previous = null
  try { previous = verifyInstall.readManifest(root) } catch { /* a broken earlier manifest is recreated */ }
  const rows = engines.map((id) => (id === 'claude'
    ? { id, profile: '.claude/verify-profile.cjs', expect: claudeExpect() }
    : { id, note: 'not verified: no profile yet' }))
  const manifest = verifyInstall.buildManifest(root, { owned, projectCreated, previous, engines: rows, lang, version: VERSION, line: LINE, template })
  const f = path.join(root, verifyInstall.MANIFEST)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, JSON.stringify(manifest, null, 2) + '\n')
}

// Downgrade guard: an installer older than what the project already has must not roll the protocol back.
// Compared: protocol line first, then semver (a prerelease tag sorts before the release).
function parseRelease(version, line) {
  const m = /^(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(String(version || '').trim())
  return { line: Number(line) || 1, nums: m ? [m[1], m[2], m[3]].map(Number) : [0, 0, 0], pre: m && m[4] ? 1 : 0, text: String(version || '?') }
}
function compareRelease(a, b) {
  if (a.line !== b.line) return a.line < b.line ? -1 : 1
  for (let i = 0; i < 3; i++) if (a.nums[i] !== b.nums[i]) return a.nums[i] < b.nums[i] ? -1 : 1
  return a.pre === b.pre ? 0 : (a.pre ? -1 : 1)
}
function downgradeReason(root) {
  const self = parseRelease(VERSION, LINE)
  const label = (r) => `${r.text} (line ${r.line})`
  let manifest = null
  try { manifest = verifyInstall.readManifest(root) } catch { /* a broken manifest does not block */ }
  if (manifest && manifest.version) {
    const have = parseRelease(manifest.version, manifest.line)
    if (compareRelease(self, have) < 0) return `the project has Forma ${label(have)} installed, this installer is ${label(self)} — older`
  }
  const cloneDir = path.join(root, '.forma', 'protocol')
  let clone = null
  try { clone = JSON.parse(fs.readFileSync(path.join(cloneDir, 'package.json'), 'utf8')) } catch { /* no clone */ }
  if (clone && path.resolve(cloneDir) !== PKG) {
    const have = parseRelease(clone.version, clone.line)
    if (compareRelease(self, have) < 0) return `the protocol clone .forma/protocol is ${label(have)}, this installer is ${label(self)} — older. Run the installer from the clone: node .forma/protocol/bin/forma.cjs init …`
  }
  return null
}

// The version line at the end of an install: first install, update (from -> to) or a refresh of the same version.
function versionLine(before, now) {
  if (!before) return `${verifyInstall.colorMark(true)} Forma ${now} installed.`
  if (before === now) return `${verifyInstall.colorMark(true)} Forma ${now} — already this version, files refreshed.`
  return `${verifyInstall.colorMark(true)} Forma updated: ${before} → ${now}.`
}
function installedVersion(root) {
  try { return verifyInstall.readManifest(root).version || null } catch { return null }
}

// Dashboard: `ensure-running.js` starts it in the background and is safe to repeat; the real address (the port is dynamic)
// is the one the server writes to `.forma/dashboard/.cache/server.json`. Returns the address, or null if it did not come up.
const DASHBOARD_START = 'node .forma/dashboard/ensure-running.js'
function dashboardUrl(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, '.forma', 'dashboard', '.cache', 'server.json'), 'utf8')).url || null } catch { return null }
}
function startDashboard(root) {
  const script = path.join(root, '.forma', 'dashboard', 'ensure-running.js')
  if (!fs.existsSync(script)) return null
  spawnSync(process.execPath, [script], { cwd: root, stdio: 'ignore', timeout: 15000 })
  for (let i = 0; i < 150; i++) { // up to ~15 s for the server to write its address
    const url = dashboardUrl(root)
    if (url) return url
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
  }
  return null
}
function printDashboard(root, o) {
  const start = o.dashboard || (!o['no-dashboard'] && process.stdout.isTTY === true)
  if (start) {
    const url = startDashboard(root)
    if (url) { console.log(`Dashboard: ${url}  (running in the background; it also starts with every Claude Code session)`); return }
    console.log(`Dashboard did not start in time — start it by hand: ${DASHBOARD_START}`)
    return
  }
  const known = dashboardUrl(root)
  console.log(`Dashboard: ${DASHBOARD_START}  (starts it in the background${known ? `; last address: ${known}` : '; the link is then in .forma/dashboard/.cache/server.json, usually http://localhost:5050/'})`)
}

// Install integrity check: red on the main engine stops; secondary engines only warn.
function printVerify(root) {
  const res = verifyInstall.verify(root)
  console.log('Install integrity (node .forma/verify/verify-install.cjs): ' + verifyInstall.format(res))
  return res.ok
}

// install: core, engines, template, board; returns the report lines and the board result
function install(root, choice) {
  const existingTemplate = readProjectTemplate(root)
  const protectedPaths = protectedTemplatePaths(root, existingTemplate)
  const core = installCore(root, protectedPaths, choice.lang)
  const report = []
  report.push(adoptStep(root, choice.adopt))
  report.push(`core: AGENTS.md, .forma/manual/, .forma/board/, .forma/skills/, .forma/dashboard/ synced; .forma/living/ — missing files added; board .devtool/features/ — ${core.boardState}; project/ — ${core.projectState}`)
  installEngines(root, choice, protectedPaths, report)
  const templateResult = installTemplateStep({ root, template: choice.template, existingTemplate }, core, report)
  // Engines (and the zcode mirror rebuild) run before the template, so the run roles the template just
  // wrote into .claude/agents/run/ are not in the mirror yet — rebuild again, the mirror must match.
  if (templateResult && templateResult.runRoles.written.length && fs.existsSync(path.join(root, '.zcode', 'scripts', 'gen-roles.cjs')))
    report.push(rebuildZcodeRoles(root, `the template wrote ${templateResult.runRoles.written.length} run roles after the first rebuild`))
  if (core.projectCreated) {
    const n = applyLanguage(root, choice.lang)
    const isBundled = choice.lang === 'en' || fs.existsSync(path.join(SCAFFOLD, choice.lang))
    report.push(isBundled
      ? (choice.lang === 'en' ? 'document language: English' : `document language: ${langName(choice.lang)} (bundled scaffold)`)
      : `document language: ${langName(choice.lang)} — translation awaits the agent: ${n} files (.forma/translation-pending.json; step in SKILL.md "Scaffold translation")${catalogLangs().includes(choice.lang) ? '' : `; no message catalog for "${choice.lang}": hook messages stay English (add core/i18n/messages/${choice.lang}.json)`}`)
  } else if (choice.lang !== 'en') report.push('language: project/ already existed — not translated (language is chosen on first install only)')
  writeManifest(root, { engines: choice.engines, lang: choice.lang, template: choice.template === 'none' ? (existingTemplate || 'none') : choice.template, projectCreated: core.projectCreated })
  return { report, boardLines: board(choice.boardMode) }
}

// step 5: auto-compact window — only for Claude Code and only when the human has no value of their own
async function chooseCompact(o, ask, root, engines) {
  if (!engines.includes('claude')) return 'off'
  const flag = o.compact ? String(o.compact).trim().toLowerCase() : null
  if (flag && flag !== 'off' && !/^[1-9]\d{4,6}$/.test(flag)) {
    console.error(`--compact: a number of tokens (for example ${COMPACT_DEFAULT}) or off, got: ${o.compact}`); process.exit(2)
  }
  // the flag governs the project's settings.json only; env, ~/.claude and settings.local.json stay the human's
  const own = ownCompact(root)
  if (own && !(flag && own.where === '.claude/settings.json')) return { own }
  if (flag) return flag
  if (!ask) return COMPACT_DEFAULT
  console.log(`\n[5/5] Auto-compact window for Claude Code in this project: ${COMPACT_DEFAULT} tokens`)
  console.log('      (the conversation is compacted when it grows past it; your own setting is never changed)')
  const a = (await ask('Set it? [Y/n]: ')).trim().toLowerCase()
  return a === 'n' || a === '\u043d' || a === 'no' ? 'off' : COMPACT_DEFAULT
}

function printReport({ report, boardLines }) {
  console.log('\nSummary:')
  for (const l of report) console.log('  ' + l)
  console.log(`  files written ${stats.written}, kept ${stats.kept}`)
  console.log('Kanban Markdown:')
  for (const l of boardLines) console.log('  ' + l)
}

// ---------- main ----------
async function main() {
  const o = parseArgs(process.argv.slice(2))
  if (o.help || o.cmd === 'help') { process.stdout.write(HELP); return }
  if (o.version || o.cmd === 'version') { console.log(VERSION); return }
  if (o.cmd === 'extensions') { process.exitCode = extensions.main([o.check ? 'check' : 'sync', '--dir', o.dir]); return }
  if (o.cmd === 'uninstall') { process.exitCode = require('../scripts/uninstall.cjs').run({ dir: o.dir, yes: !!o.yes }); return }
  if (o.cmd !== 'init') { console.error(`Unknown command: ${o.cmd}\n\n${HELP}`); process.exit(2) }
  const root = o.dir
  const older = downgradeReason(root)
  if (older && !o['allow-downgrade']) {
    console.error(`Refusing to install: ${older}.
A plugin cache or an old checkout is not a source of the version. Use the newer installer, or pass --allow-downgrade to roll back on purpose.`)
    process.exit(3)
  }
  if (older) console.log(`! --allow-downgrade: ${older}`)
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true })
  const templates = listTemplates()
  const interactive = !o.yes && process.stdin.isTTY !== false && !(o.engines && o.template && o.board && o.lang)
  const menu = interactive && (!o.engines || !o.template || !o.board || !o.lang)
  const ask = menu ? makeAsk() : null
  const installedBefore = fs.existsSync(path.join(root, 'AGENTS.md'))
  const versionBefore = installedVersion(root)

  console.log(`Forma ${VERSION} → ${root}${installedBefore ? ' (update)' : ''}`)
  console.log(`Git: ${gitBoundary(root)}`)

  const engines = await chooseEngines(o, ask)
  const template = await chooseTemplate(o, ask, templates)
  const boardMode = await chooseBoard(o, ask)
  const lang = await chooseLang(o, ask)
  const compact = await chooseCompact(o, ask, root, engines)
  const adopt = await chooseAdopt(o, root, ask)
  if (ask) ask.close()

  console.log('Installing…')
  const result = install(root, { engines, template, boardMode, lang, compact, adopt })
  progressDone()
  printReport(result)
  const ok = printVerify(root)
  if (engines.includes('claude') && !findBash()) console.error('\n! ' + NO_BASH)
  if (!ok) { console.error('\nInstall is broken — fix the items above and rerun (rerunning is safe).'); process.exit(1) }
  console.log('\n' + versionLine(versionBefore, VERSION))
  printDashboard(root, o)
  if (!installedBefore) console.log('\nNext: open the folder in Claude Code — Intent will lead the setup per project/config/SETUP.md, starting with the interview.')
}

main().catch((e) => { console.error(e.message || e); process.exit(1) })
