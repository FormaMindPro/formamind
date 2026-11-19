#!/usr/bin/env node
'use strict'
// The engine folders' hygiene after an install: a foreign framework may have put its own agents, hooks and
// scripts into them before Forma (its own installer ran first), and an update leaves forma files the current
// release no longer ships. This pass settles every file in the managed engine subfolders - only those the
// installer itself wrote in this pass (the scan zones are derived from the owned set, the top two levels under
// the root: .claude/agents, .claude/hooks, ...; an engine folder's own root files and run-time folders such as
// .claude/memory are never touched). A file there that is
//   - owned by this pass, a project extension copy, a file the project's recorded template puts in place
//     (the template step may not run this pass - "kept the recorded" - but its files are still forma's),
//     protected, or expected by a mirror regeneration: kept;
//   - listed in the previous install manifest but not written now: a stale forma file - removed;
//   - everything else: foreign - moved whole, relative path kept, into project/source/engine-archive-<stamp>/.
// Hook registrations in every engine's wiring file (.claude/settings.json, .qoder/settings.json,
// .agents/hooks.json, .zcode/config.json) whose command points at an archived file are removed (the JSON
// that cannot be read is warned about and left alone). Every action is journaled to
// .forma/living/migrations/engine-clean-<stamp>.json; --rollback reads the journal back: archives move home,
// hook entries are re-inserted, a removed stale forma file is not (its source is the old package - reinstalling
// that version brings the file back).
//   node clean-engine-files.cjs --rollback <journal.json> [--root <dir>]
// Exit codes: 0 done · 2 bad arguments or an unreadable journal.

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const SOURCE = path.join('project', 'source')
const JOURNAL_DIR = path.join('.forma', 'living', 'migrations')
const MANIFEST = path.join('.forma', 'install-manifest.json')
const SETTINGS = path.join('.claude', 'settings.json')
// Every engine's hook wiring file; the shapes differ: claude and qoder keep hooks.<event>, gemini a map of
// named groups holding <event>, zcode hooks.events.<event>.
const HOOK_FILES = ['.claude/settings.json', '.qoder/settings.json', '.agents/hooks.json', '.zcode/config.json']
// the engine folders the installer writes into; nothing outside them is ever scanned
const ENGINE_ROOTS = ['.claude', '.zcode', '.qoder', '.agents', '.codex']
// never moved, wherever they sit: the engines' merged settings, the project layer and the environment file
const PROTECTED_NAMES = new Set(['settings.json', 'config.toml', 'project-layer.txt', '.env'])
// run-time state, not anyone's work: never scanned even inside a managed subfolder
const SKIP_DIRS = new Set(['node_modules', '.sessions', '.cache'])

const posix = (p) => p.split(path.sep).join('/')
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-')

// scan zones: the top two levels under the root of every owned path (.claude/agents, .zcode/rules, ...).
// An engine folder's root files (.claude/forma-adapter.cjs) and everything outside the engine roots is not a zone.
function zonesFrom(owned, root) {
  const zones = new Set()
  for (const abs of owned) {
    const rel = path.relative(root, abs)
    if (!rel || rel.split(path.sep)[0] === '..') continue
    const parts = rel.split(path.sep)
    if (parts.length < 2 || !ENGINE_ROOTS.includes(parts[0])) continue
    zones.add(parts[0] + '/' + parts[1])
  }
  return zones
}

// every file of a zone, relative to the root, posix form
function zoneFiles(root, zone) {
  const out = []
  const walk = (dir) => {
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(full) }
      else if (e.isFile()) out.push(posix(path.relative(root, full)))
    }
  }
  walk(path.join(root, ...zone.split('/')))
  return out
}

// the mirror's expected set: the file paths a mirror regeneration names now. What the regeneration names is
// forma's no matter what wrote the copy earlier; a mirror file it no longer names follows its (gone or
// foreign) source out. No generator - no verdict: the mirror zone is left alone.
function expectedMirror(root, spec) {
  const gen = path.join(root, spec.genScript)
  if (!fs.existsSync(gen)) return null
  const r = spawnSync(process.execPath, [gen, '--print-paths'], { cwd: root, encoding: 'utf8' })
  if (r.error || r.status !== 0) return null
  return new Set((r.stdout || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => posix(path.join(spec.target, l))))
}

// the previous install manifest: the files that release shipped
function readManifestFiles(root) {
  try { return new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(root, MANIFEST), 'utf8')).files || {})) }
  catch { return new Set() }
}

// first free path inside base for rel: the relative path kept, a taken name gets -2, -3 on the stem
function freePath(base, rel, taken) {
  const dir = path.dirname(rel)
  const ext = path.extname(rel)
  const stem = ext ? path.basename(rel, ext) : rel
  let candidate = rel
  for (let n = 2; fs.existsSync(path.join(base, candidate)) || taken.has(posix(candidate).toLowerCase()); n++) {
    candidate = posix(path.join(dir, `${stem}-${n}${ext}`))
  }
  return path.join(base, candidate)
}

const LOCKED = new Set(['EPERM', 'EBUSY', 'EACCES', 'EXDEV', 'ENOTEMPTY'])
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

// one file move. Windows refuses to rename a file some process holds open: retry a few times, then copy and delete.
function moveOne(from, to) {
  let last
  for (let i = 0; i < 4; i++) {
    try { fs.renameSync(from, to); return } catch (e) { last = e; if (!LOCKED.has(e.code)) throw e; pause(250) }
  }
  fs.cpSync(from, to, { errorOnExist: true, force: false })
  fs.rmSync(from, { force: true, maxRetries: 3, retryDelay: 250 })
}

/** The hook event groups a wiring file holds: [{ event, groups, group }]; `group` - a gemini named group. */
function hookGroups(s, rel) {
  const out = []
  if (!s || typeof s !== 'object') return out
  const take = (map, name) => {
    if (!map || typeof map !== 'object' || Array.isArray(map)) return
    for (const [event, groups] of Object.entries(map)) if (Array.isArray(groups)) out.push({ event, groups, group: name })
  }
  if (rel.endsWith('config.json')) take(s.hooks && s.hooks.events, null)
  else if (rel.endsWith('hooks.json')) { for (const [name, map] of Object.entries(s)) take(map, name) }
  else take(s.hooks, null)
  return out
}

/** A hook entry's command line: command plus the args (zcode keeps the script in args). */
const hookText = (h) => {
  if (!h || typeof h !== 'object') return ''
  const cmd = typeof h.command === 'string' ? h.command : ''
  const args = Array.isArray(h.args) ? h.args.join(' ') : ''
  return (cmd + ' ' + args).trim()
}

/** Runs the pass. `owned`: absolute paths written this pass (or deliberately kept - a live edit the installer
 *  found and left is not a stale forma file); `extensionPaths`: absolute paths of the project extension copies;
 *  `templatePaths`: absolute paths the project's recorded template puts in place - known to the pass without
 *  creating scan zones, the same way as the extension copies (the template step may not run this pass, but
 *  the files are still the template's; a file the template no longer ships is not in the set and stays stale);
 *  `manifestFiles`: posix rel paths of the previous manifest (default: read from the root);
 *  `mirrors`: [{ target, genScript }] - zones classified by their regeneration, not by ownership. Returns
 *  { report, journal, archived, deleted, unhooked, failed, archiveDir, rollbackCmd }. */
function cleanEngineFiles(root, opts = {}) {
  root = path.resolve(root)
  const owned = new Set([...(opts.owned || [])].map((p) => path.resolve(p)))
  const extSet = new Set([...(opts.extensionPaths || [])].map((p) => path.resolve(p)))
  const templateSet = new Set([...(opts.templatePaths || [])].map((p) => path.resolve(p)))
  const manifest = opts.manifestFiles ? new Set(opts.manifestFiles) : readManifestFiles(root)
  const protectedNames = opts.protectedNames || PROTECTED_NAMES
  const zones = zonesFrom(owned, root)
  const mirrorZones = new Map((opts.mirrors || []).map((m) => [m.target, m]))

  const stampNow = stamp()
  const archiveDir = path.join(root, SOURCE, `engine-archive-${stampNow}`)
  const archiveRel = posix(path.join(SOURCE, `engine-archive-${stampNow}`))
  const actions = []
  const failed = []
  const taken = new Set()
  const archivedBasenames = new Set()

  // one file's verdict and execution: owned, extension, template or protected - keep; in the previous manifest
  // but not written now - stale, remove; otherwise foreign - archive
  const settle = (rel) => {
    const abs = path.resolve(root, rel)
    if (owned.has(abs) || extSet.has(abs) || templateSet.has(abs)) return
    if (path.basename(rel).startsWith('.')) return // run-time state (a hook's cache), nobody's work
    if (protectedNames.has(path.basename(rel).toLowerCase())) return
    if (manifest.has(rel)) {
      try { fs.rmSync(abs, { force: true }) } catch (e) { failed.push({ from: rel, error: e.message }); return }
      actions.push({ action: 'delete', from: rel, note: 'superseded forma file, restore by reinstalling the old package' })
      return
    }
    const to = freePath(archiveDir, rel, taken)
    try {
      fs.mkdirSync(path.dirname(to), { recursive: true })
      moveOne(abs, to)
    } catch (e) { failed.push({ from: rel, error: e.message }); return }
    taken.add(posix(path.relative(archiveDir, to)).toLowerCase())
    archivedBasenames.add(path.basename(rel))
    actions.push({ action: 'archive', from: rel, to: posix(path.relative(root, to)) })
  }

  // wave 1: the plain zones
  for (const zone of [...zones].sort()) {
    const mirror = mirrorZones.get(zone)
    if (mirror) continue // wave 2 decides by the mirror regeneration
    for (const rel of zoneFiles(root, zone)) settle(rel)
  }
  // wave 2: the mirror zones, against the regeneration run after wave 1 (the sources are clean by now)
  for (const zone of [...mirrorZones.keys()].sort()) {
    if (!zones.has(zone)) continue
    const expected = expectedMirror(root, mirrorZones.get(zone))
    if (!expected) continue
    for (const rel of zoneFiles(root, zone)) {
      if (expected.has(rel)) continue
      settle(rel)
    }
  }

  // hook registrations pointing at archived files are cut out of every engine's wiring file; the JSON that
  // cannot be read is warned about and left alone
  let unhooked = 0
  const settingsWarnings = []
  if (archivedBasenames.size) {
    for (const rel of HOOK_FILES) {
      const sf = path.join(root, rel)
      if (!fs.existsSync(sf)) continue
      let s = null
      try { s = JSON.parse(fs.readFileSync(sf, 'utf8')) } catch (e) { settingsWarnings.push(`${rel} is not valid JSON (${e.message}) - hook registrations not cleaned`); continue }
      let changed = false
      for (const { event, groups, group: groupName } of hookGroups(s, rel)) {
        // a group holds its commands in `hooks` (claude, qoder, zcode) or is the command itself (gemini)
        for (let gi = groups.length - 1; gi >= 0; gi--) {
          const group = groups[gi]
          if (!group || typeof group !== 'object') continue
          const hit = (h) => {
            const text = hookText(h)
            return !!text && [...archivedBasenames].some((b) => text.includes(b))
          }
          if (Array.isArray(group.hooks)) {
            const before = group.hooks.length
            group.hooks = group.hooks.filter((h, hi) => {
              if (!hit(h)) return true
              actions.push({ action: 'unhook', from: `${rel}:${event}/${gi}/${hi}`, file: rel, group: groupName || null, event, gi, hi, text: JSON.stringify(h), matcher: group.matcher || '' })
              return false
            })
            unhooked += before - group.hooks.length
            if (group.hooks.length !== before) changed = true
          } else if (hit(group)) {
            actions.push({ action: 'unhook', from: `${rel}:${event}/${gi}`, file: rel, group: groupName || null, event, gi, hi: null, text: JSON.stringify(group), matcher: group.matcher || '' })
            groups.splice(gi, 1)
            unhooked++
            changed = true
          }
        }
      }
      if (changed) fs.writeFileSync(sf, JSON.stringify(s, null, 2) + '\n')
    }
  }

  const archived = actions.filter((a) => a.action === 'archive').length
  const deleted = actions.filter((a) => a.action === 'delete').length
  const count = archived + deleted + unhooked
  let journal = null
  let rollbackCmd = null
  if (count) {
    journal = posix(path.join(JOURNAL_DIR, `engine-clean-${stampNow}.json`))
    rollbackCmd = `node ${posix(path.join(__dirname, 'clean-engine-files.cjs'))} --rollback ${journal} --root .`
    fs.mkdirSync(path.join(root, JOURNAL_DIR), { recursive: true })
    fs.writeFileSync(path.join(root, journal), JSON.stringify({ actions, rollback: rollbackCmd }, null, 2) + '\n')
  }
  let report
  if (!count) report = 'foreign files: none'
  else {
    report = `foreign files: ${archived} archived → ${archiveRel}, ${deleted} stale forma files removed, ${unhooked} hook entries cleaned (journal ${journal})`
    for (const w of settingsWarnings) report += `\n  ! ${w}`
    if (failed.length) report += `\n  ! not settled: ${failed.map((f) => `${f.from} (${f.error})`).join('; ')}`
  }
  return { report, journal, archived, deleted, unhooked, failed, archiveDir: count ? archiveRel : null, rollbackCmd }
}

/** Undoes a journal: archives move home, hook entries go back where they were cut out, a stale forma file is
 *  skipped (named, not restored). Returns { restored, rehooked, skipped }. */
function rollback(root, journalFile) {
  root = path.resolve(root)
  const { actions } = JSON.parse(fs.readFileSync(path.resolve(root, journalFile), 'utf8'))
  let restored = 0, rehooked = 0, skipped = 0
  for (const a of [...actions].reverse()) {
    if (a.action === 'archive') {
      const from = path.join(root, a.from)
      const to = path.join(root, a.to)
      if (fs.existsSync(to) && !fs.existsSync(from)) {
        fs.mkdirSync(path.dirname(from), { recursive: true })
        fs.renameSync(to, from)
        restored++
      }
    } else if (a.action === 'delete') {
      skipped++ // the old package is the only source of the content: reinstalling it restores the file
    } else if (a.action === 'unhook') {
      const rel = a.file || SETTINGS // a journal of the claude-only pass names no file
      const sf = path.join(root, rel)
      let s
      try { s = JSON.parse(fs.readFileSync(sf, 'utf8')) } catch { skipped++; continue }
      let map
      if (a.group) { s[a.group] = s[a.group] || {}; map = s[a.group] }
      else if (rel.endsWith('config.json')) { s.hooks = s.hooks || {}; s.hooks.events = s.hooks.events || {}; map = s.hooks.events }
      else { s.hooks = s.hooks || {}; map = s.hooks }
      const arr = map[a.event] = map[a.event] || []
      if (a.hi == null) { // a bare entry (gemini's direct command), not a group holding hooks
        arr.splice(Math.min(Number(a.gi), arr.length), 0, JSON.parse(a.text))
        fs.writeFileSync(sf, JSON.stringify(s, null, 2) + '\n')
        rehooked++
        continue
      }
      let group = arr[Number(a.gi)]
      if (!group || !Array.isArray(group.hooks)) {
        group = { hooks: [] }
        if (a.matcher) group.matcher = a.matcher
        arr.splice(Math.min(Number(a.gi), arr.length), 0, group)
      }
      group.hooks.splice(Math.min(Number(a.hi), group.hooks.length), 0, JSON.parse(a.text))
      fs.writeFileSync(sf, JSON.stringify(s, null, 2) + '\n')
      rehooked++
    }
  }
  return { restored, rehooked, skipped }
}

module.exports = { cleanEngineFiles, rollback, zonesFrom, PROTECTED_NAMES, ENGINE_ROOTS }

if (require.main === module) {
  const argv = process.argv.slice(2)
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith('--') ? argv[i + 1] : null }
  const stop = (msg) => { console.error('STOP: ' + msg); process.exit(2) }
  const root = path.resolve(opt('--root') || process.cwd())
  if (!opt('--rollback')) stop('--rollback <journal.json> is required')
  if (!fs.existsSync(root)) stop(`no such folder: ${root}`)
  try {
    const r = rollback(root, opt('--rollback'))
    const skipNote = r.skipped ? `; ${r.skipped} stale forma file(s) not restored — reinstalling the old package brings them back` : ''
    console.log(`rolled back: ${r.restored} archived file(s) restored, ${r.rehooked} hook entr${r.rehooked === 1 ? 'y' : 'ies'} re-inserted${skipNote}`)
  } catch (e) { stop(e.message) }
}
