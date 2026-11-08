#!/usr/bin/env node
// The resources graph: the resource/draft sort, the registry, the file preparation, the batches for the describer.
// Without a model: the asset-describer-haiku agent describes the files, and this script writes into the registry (apply).
// The spec - project/ops/GRAPHS-STRUCTURE-SITE.md §3. The rules - project/config/resources.rules.json.
//
//   node .claude/scripts/resources.cjs sort                      -> project/resources/_sort.json, the unclear ones by folders
//   node .claude/scripts/resources.cjs inventory                 -> project/resources/_assets.json (the sha256 key)
//   node .claude/scripts/resources.cjs report                    -> the registry's integrity
//   node .claude/scripts/resources.cjs prepare [--n N]           -> downscaled copies/frames into project/work/prep
//   node .claude/scripts/resources.cjs batch --n N [--size 512] [--from answers.json] [--out f]     -> the batch manifest for the describer
//   node .claude/scripts/resources.cjs apply <answers.json> [--card N]  -> the describer's answers into the registry
//   node .claude/scripts/resources.cjs register <path> --kind K [--card N] [--prompt P] [--model M] [--description D] [--type T] [--tags a,b]
//   node .claude/scripts/resources.cjs describe [--redo <path regex>]  -> (--redo re-describes the entries without model)
//       the description and tags of texts/tables/diagrams from the headings, sheets, headers (no model; images and already-described are skipped)
//   node .claude/scripts/resources.cjs tag-batch --n N [--out f]  -> the {domain_tags, items} manifest for the entries without semantic_tags (the tags are set by the main session)
//   node .claude/scripts/resources.cjs apply-tags <answers.json>  -> [{sha256, tags}]: only the tags from domain_tags reach semantic_tags and tags (up to 5)
//   node .claude/scripts/resources.cjs decide <folder> resource|draft  -> the folder's rule into the rules
//
// Printed labels come from the core dictionary: English key in code, ru value as data.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const i18n = require('../../.forma/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');

const ROOT = path.resolve(__dirname, '..', '..');
const RULES = path.join(ROOT, 'project/config/resources.rules.json');
const REG_DIR = path.join(ROOT, 'project/resources');
const REG = path.join(REG_DIR, '_assets.json');
const SORT = path.join(REG_DIR, '_sort.json');
let SIZE = 1024;                                       // the long side of the prepared copy, px (--size)
const prepDir = () => path.join(ROOT, 'project/work', SIZE === 1024 ? 'prep' : 'prep-' + SIZE);
const BOARD = path.join(ROOT, '.devtool/features');

const rel = f => path.relative(ROOT, f).split(path.sep).join('/');
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 1)); };
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);

function args() {
  const pos = [], opt = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) { const k = a[i].slice(2); opt[k] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true; }
    else pos.push(a[i]);
  }
  return { pos, opt };
}

// word normalization: NFKC, lower case, re-assemble, strip of residual combining marks
function normWord(s) { return String(s).normalize('NFKC').toLowerCase().normalize('NFC').replace(/\p{M}/gu, ''); }

function loadRules() {
  const r = readJson(RULES, null);
  if (!r) { console.error(msg('resources.no_rules', { path: rel(RULES) })); process.exit(2); }
  const re = l => (l || []).map(s => new RegExp(s, 'i'));
  return { ...r, draftRe: re(r.draft_paths), draftNameRe: re(r.draft_names), refRe: re(r.reference_paths), kindRe: (r.kind_by_path || []).map(([p, k]) => [new RegExp(p), k]), mediaRe: new RegExp('\\.(' + [...r.media_ext, ...(r.source_ext || []), ...(r.text_ext || [])].join('|') + ')$', 'i'), skipRe: re(r.skip_names), exclRe: re(r.exclude_paths), classRe: Object.entries(r.classes || {}).map(([k, l]) => [k, re(l)]), goalRe: (r.goal_by_path || []).map(([p, g]) => [new RegExp(p), g]), stopSet: new Set((r.stop_words || []).map(normWord)) };
}

function walk(dir, rules, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name), r = rel(f);
    if (e.isDirectory()) { if (!rules.skip_dirs.some(s => e.name === s || r === s)) walk(f, rules, out); }
    else if (f === REG || f === SORT) continue;            // the registry and the sort themselves - not resources
    else if (rules.mediaRe.test(e.name) &&!rules.skipRe.some(x => x.test(e.name)) && !rules.exclRe.some(x => x.test(r))) out.push(f);
  }
  return out;
}

// --- references from the product's files ------------------------------------------------
function referenceMap(rules) {
  const map = new Map();                               // basename (lower) -> Set(the file that references)
  const ext = new Set(rules.use_text_ext);
  const re = new RegExp('[A-Za-z0-9_\\-.%@+~()]+\\.(?:' + rules.media_ext.join('|') + ')', 'gi');
  const visit = f => {
    if (fs.statSync(f).size > 3e6) return;
    const text = fs.readFileSync(f, 'utf8'), me = rel(f);
    for (let m of text.match(re) || []) {
      try { m = decodeURIComponent(m); } catch { /* keep as is */ }
      const k = m.split('/').pop().toLowerCase();
      if (!map.has(k)) map.set(k, new Set());
      map.get(k).add(me);
    }
  };
  const go = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.git') go(f); }
      else if (ext.has(e.name.split('.').pop().toLowerCase())) visit(f);
    }
  };
  for (const u of rules.use_roots) {
    const p = path.join(ROOT, u);
    if (!fs.existsSync(p)) continue;
    fs.statSync(p).isDirectory() ? go(p) : visit(p);
  }
  return map;
}

// --- dimensions without external libraries ----------------------------------------------
function dims(buf, ext) {
  try {
    if (ext === 'png') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (ext === 'gif') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (ext === 'jpg' || ext === 'jpeg') {
      let i = 2;
      while (i < buf.length) {
        if (buf[i] !== 0xFF) { i++; continue; }
        const m = buf[i + 1];
        if (m >= 0xC0 && m <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(m)) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
    if (ext === 'webp' && buf.toString('ascii', 0, 4) === 'RIFF') {
      const t = buf.toString('ascii', 12, 16);
      if (t === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3FFF, height: buf.readUInt16LE(28) & 0x3FFF };
      if (t === 'VP8L') { const b = buf.readUInt32LE(21); return { width: (b & 0x3FFF) + 1, height: ((b >> 14) & 0x3FFF) + 1 }; }
      if (t === 'VP8X') return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
    }
  } catch { /* the dimensions are optional */ }
  return {};
}

// --- sorting ----------------------------------------------------------------------------
function classify(rules, files, refs) {
  const rows = files.map(f => {
    const r = rel(f), buf = fs.readFileSync(f), name = path.basename(f).toLowerCase();
    const decided = Object.entries(rules.folders || {}).filter(([d]) => r.startsWith(d.replace(/\/?$/, '/'))).sort((a, b) => b[0].length - a[0].length)[0];
    const used = [...(refs.get(name) || [])].filter(x => x !== r);
    let cls, reason;
    if (decided) { cls = decided[1]; reason = msg('resources.reason_folder_rule', { folder: decided[0] }); }
    else if (rules.draftRe.some(x => x.test(r)) || rules.draftNameRe.some(x => x.test(path.basename(f)))) { cls = 'draft'; reason = msg('resources.reason_draft_path'); }
    else if (used.length) { cls = 'resource'; reason = msg('resources.reason_used_in'); }
    else if (rules.refRe.some(x => x.test(r))) { cls = 'resource'; reason = msg('resources.reason_reference_dir'); }
    else { cls = 'unclear'; reason = msg('resources.reason_no_rule'); }
    const klass = (rules.classRe.find(([, l]) => l.some(x => x.test(r))) || [, 'other'])[0];
    return { klass, path: r, sha256: sha(buf), bytes: buf.length, cls, reason, used_in: used, ext: name.split('.').pop(), buf };
  });
  // duplicates by hash: the resources merge into one entry; of the unclear/draft ones one unclear stays, the rest become a draft
  const groups = new Map();
  for (const x of rows) (groups.get(x.sha256) || groups.set(x.sha256, []).get(x.sha256)).push(x);
  for (const g of groups.values()) {
    if (g.length < 2 || g.some(x => x.cls === 'resource')) continue;
    const keep = g.filter(x => x.cls === 'unclear').sort((a, b) => a.path.length - b.path.length)[0];
    for (const x of g) if (x !== keep && x.cls !== 'draft') { x.cls = 'draft'; x.reason = msg('resources.reason_dup_hash'); }
  }
  return rows;
}

function cmdSort() {
  const rules = loadRules(), files = walk(path.join(ROOT, rules.scan_root), rules), refs = referenceMap(rules);
  const rows = classify(rules, files, refs);
  const count = { resource: 0, draft: 0, unclear: 0 };
  const folders = {}, draftBytes = { n: 0, bytes: 0 };
  const out = {};
  for (const x of rows) {
    count[x.cls]++;
    out[x.path] = { class: x.cls, reason: x.reason };
    if (x.cls === 'unclear') folders[path.dirname(x.path)] = (folders[path.dirname(x.path)] || 0) + 1;
    if (x.cls === 'draft') { draftBytes.n++; draftBytes.bytes += x.bytes; }
  }
  writeJson(SORT, { generated: today(), count, files: out, unclear_folders: folders });
  console.log(msg('resources.sort_summary', {
    total: rows.length, resources: count.resource, drafts: count.draft,
    mb: (draftBytes.bytes / 1048576).toFixed(1), unclear: count.unclear,
  }));
  const f = Object.entries(folders).sort((a, b) => b[1] - a[1]);
  if (f.length) console.log(msg('resources.unclear_by_folders') + f.map(([d, n]) => `  ${n}\t${d}`).join('\n'));
  return rows;
}

// --- registry ----------------------------------------------------------------------------
function cardMeta(card) {
  if (!card) return {};
  const dir = [BOARD, path.join(BOARD, 'done')].filter(fs.existsSync);
  for (const d of dir) {
    const f = fs.readdirSync(d).find(n => n.startsWith(card + '-') || n === card + '.md');
    if (f) {
      const m = (fs.readFileSync(path.join(d, f), 'utf8').match(/^labels:\s*\[(.*)\]/m) || [])[1] || '';
      const g = (m.match(/"(goal-[^"]+)"/) || [])[1];
      return { card, goal: g || null };
    }
  }
  return { card, goal: null };
}

const kindOf = (rules, p) => (rules.kindRe.find(([re]) => re.test(p)) || [, 'source'])[1];
const cardOf = (p, text = '') => (p.match(/cards\/(card-\d+)\//) || p.match(/(card-\d+)/) || [])[1] || null;

function stateOf(e) { return e.used_in.length ? msg('resources.state_in_work') : (e.card || e.goal) ? msg('resources.state_in_stock') : msg('resources.state_orphan'); }

function cmdInventory() {
  const rules = loadRules(), rows = cmdSortQuiet(rules);
  const reg = readJson(REG, { version: 1, entries: {} });
  let added = 0, updated = 0;
  const bySha = new Map();
  for (const x of rows.filter(x => x.cls === 'resource')) (bySha.get(x.sha256) || bySha.set(x.sha256, []).get(x.sha256)).push(x);
  for (const [h, g] of bySha) {
    g.sort((a, b) => a.path.length - b.path.length);
    const first = g[0], old = reg.entries[h];
    const card = old?.card || g.map(x => cardOf(x.path)).find(Boolean) || null;
    const meta = card ? cardMeta(card) : {};
    const used = [...new Set(g.flatMap(x => x.used_in))].sort();
    const e = {
      path: first.path, also: g.slice(1).map(x => x.path), format: first.ext, ...dims(first.buf, first.ext), bytes: first.bytes,
      class: first.klass, kind: old?.kind || kindOf(rules, first.path), card: card || null, card_note: card ? null : msg('resources.no_card', { klass: first.klass }), goal: card ? (old?.goal || meta.goal || null) : ((rules.goalRe.find(([re]) => re.test(first.path)) || [])[1] || old?.goal || null), used_in: used,
      type: old?.type || null, tags: old?.tags || [], description: old?.description || null, prompt: old?.prompt || null, model: old?.model || null,
      described: old?.described || null, ...(old?.semantic_tags ? { semantic_tags: old.semantic_tags } : {}), added: old?.added || today(),
    };
    e.state = stateOf(e);
    if (old) updated++; else added++;
    reg.entries[h] = e;
  }
  const live = new Set(rows.filter(x => x.cls === 'resource').map(x => x.sha256));
  const livePaths = new Set(rows.filter(x => x.cls === 'resource').flatMap(x => [x.path]));
  let moved = 0;
  for (const h of Object.keys(reg.entries)) {
    if (live.has(h)) continue;
    if (livePaths.has(reg.entries[h].path)) { delete reg.entries[h]; moved++; }        // the file in place, the hash changed: an entry already exists under the new key (the description reset), the old one goes
    else if (!reg.entries[h].description || !fs.existsSync(path.join(ROOT, reg.entries[h].path))) delete reg.entries[h];   // gone from the resources and undescribed, or without a file on disk
  }
  reg.generated = today();
  writeJson(REG, reg);
  console.log(msg('resources.inventory_summary', {
    total: Object.keys(reg.entries).length, added, updated, moved,
  }));
  return reg;
}

function cmdSortQuiet(rules) {
  const files = walk(path.join(ROOT, rules.scan_root), rules), refs = referenceMap(rules);
  return classify(rules, files, refs);
}

function cmdReport() {
  const rules = loadRules(), rows = cmdSortQuiet(rules), reg = readJson(REG, { entries: {} });
  const resSha = new Set(rows.filter(x => x.cls === 'resource').map(x => x.sha256));
  const noEntry = rows.filter(x => x.cls === 'resource' && !reg.entries[x.sha256]).map(x => x.path);
  const noFile = Object.entries(reg.entries).filter(([h, e]) => !fs.existsSync(path.join(ROOT, e.path)) || !resSha.has(h)).map(([, e]) => e.path);
  const needDesc = Object.values(reg.entries).filter(e => e.format !== 'svg' && !e.description);
  const states = {};
  for (const e of Object.values(reg.entries)) states[e.state] = (states[e.state] || 0) + 1;
  const unclear = rows.filter(x => x.cls === 'unclear').length;
  console.log(msg('resources.report_summary', {
    no_entry: noEntry.length, no_file: noFile.length, no_desc: needDesc.length, unclear,
  }));
  console.log(msg('resources.states_line') + Object.entries(states).map(([k, v]) => `${k} ${v}`).join(', '));
  noEntry.slice(0, 5).forEach(p => console.log(msg('resources.no_entry_line') + p));
  noFile.slice(0, 5).forEach(p => console.log(msg('resources.no_file_line') + p));
  return { noEntry, noFile, needDesc: needDesc.length, unclear, states };
}

// --- preparation and batches --------------------------------------------------------------
function ff(argv) { return spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...argv], { encoding: 'utf8' }); }

function prepareEntry(h, e) {
  const PREP = prepDir();
  fs.mkdirSync(PREP, { recursive: true });
  const src = path.join(ROOT, e.path), id = h.slice(0, 12), outs = [];
  if (['mp4', 'webm', 'mov'].includes(e.format)) {
    const pr = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src], { encoding: 'utf8' });
    const dur = parseFloat(pr.stdout) || 1;
    [0.1, 0.5, 0.9].forEach((p, i) => {
      const o = path.join(PREP, `${id}-${i + 1}.jpg`);
      if (!fs.existsSync(o)) ff(['-ss', String(dur * p), '-i', src, '-frames:v', '1', '-vf', `scale='min(${SIZE},iw)':-2`, o]);
      if (fs.existsSync(o)) outs.push(rel(o));
    });
  } else {
    const o = path.join(PREP, id + '.jpg');
    if (!fs.existsSync(o)) ff(['-i', src, '-frames:v', '1', '-vf', `scale='min(${SIZE},iw)':-2`, o]);
    if (fs.existsSync(o)) outs.push(rel(o));
  }
  return outs;
}

function pending(reg, n, skip = 0) {
  return Object.entries(reg.entries).filter(([, e]) => e.format !== 'svg' && !e.description && fs.existsSync(path.join(ROOT, e.path))).slice(skip, n ? skip + n : Infinity);
}

function cmdPrepare(opt) {
  const reg = readJson(REG, { entries: {} });
  let ok = 0, fail = 0;
  for (const [h, e] of pending(reg, opt.n ? +opt.n : 0)) (prepareEntry(h, e).length ? ok++ : fail++);
  console.log(msg('resources.prepare_summary', { ok, fail }));
}

function cmdBatch(opt) {
  const reg = readJson(REG, { entries: {} }), n = opt.n ? +opt.n : 10, out = [];
  // --from <json>: take the concrete sha256 (a re-measure of the already described), otherwise - the not yet described
  const from = opt.from ? (readJson(path.resolve(opt.from), []).map(a => a.sha256)) : null;
  const list = from ? from.filter(h => reg.entries[h]).map(h => [h, reg.entries[h]]) : pending(reg, n, opt.skip ? +opt.skip : 0);
  for (const [h, e] of list) {
    const files = prepareEntry(h, e);
    if (files.length) out.push({ sha256: h, source: e.path, files });
  }
  const f = path.resolve(ROOT, opt.out || 'project/work/batch.json');
  writeJson(f, { types: loadRules().types, tags: loadRules().tags, items: out });
  console.log(msg('resources.batch_summary', { count: out.length, file: rel(f) }));
}

function cmdApply(file, opt) {
  const rules = loadRules(), reg = readJson(REG, { entries: {} }), ans = readJson(path.resolve(file), null);
  if (!ans) { console.error(msg('resources.not_read', { file })); process.exit(2); }
  const list = Array.isArray(ans) ? ans : ans.items || ans.answers || [];
  let ok = 0; const bad = [];
  for (const a of list) {
    const e = reg.entries[a.sha256] || Object.entries(reg.entries).find(([h]) => h.startsWith(a.sha256 || '#'))?.[1];
    if (!e) { bad.push(msg('resources.no_entry_for', { sha: a.sha256 })); continue; }
    // \u0442\u0435\u0433\u0438 = "tags" in ru: a legacy key of the answers file, a parse pattern held as escapes
    const tags = (a.tags || a['\u0442\u0435\u0433\u0438'] || []).filter(t => rules.tags.includes(t));
    const dropped = (a.tags || []).filter(t => !rules.tags.includes(t));
    const type = rules.types.includes(a.type) ? a.type : null;
    if (!type) bad.push(msg('resources.bad_type', { path: e.path, type: a.type }));
    Object.assign(e, { type: type || e.type, tags, description: String(a.description || '').trim() || null, model: a.model || 'claude-haiku-5-5', described: today() });
    if (dropped.length) bad.push(msg('resources.tags_dropped', { path: e.path, tags: dropped.join(', ') }));
    ok++;
  }
  writeJson(REG, reg);
  console.log(msg('resources.apply_summary', { ok }) + (bad.length ? msg('resources.apply_notes', { count: bad.length }) + '\n  ' + bad.join('\n  ') : ''));
}

function cmdRegister(p, opt) {
  const rules = loadRules(), f = path.resolve(ROOT, p);
  if (!p || !fs.existsSync(f)) { console.error(msg('resources.file_not_found', { file: p })); process.exit(2); }
  const buf = fs.readFileSync(f), h = sha(buf), r = rel(f), ext = path.extname(f).slice(1).toLowerCase();
  const reg = readJson(REG, { version: 1, entries: {} }), old = reg.entries[h];
  const card = opt.card ? (String(opt.card).startsWith('card-') ? opt.card : 'card-' + String(opt.card).padStart(3, '0')) : (old?.card || cardOf(r));
  const meta = card ? cardMeta(card) : {};
  const e = {
    path: old?.path || r, also: [...new Set([...(old?.also || []), ...(old && old.path !== r ? [r] : [])])], format: ext, ...dims(buf, ext), bytes: buf.length,
    kind: opt.kind || old?.kind || kindOf(rules, r), card: card || null, goal: meta.goal || old?.goal || null, used_in: old?.used_in || [],
    type: opt.type || old?.type || null, tags: opt.tags ? String(opt.tags).split(',').map(s => s.trim()).filter(t => rules.tags.includes(t)) : (old?.tags || []),
    description: opt.description || old?.description || null, prompt: opt.prompt || old?.prompt || null, model: opt.model || old?.model || null,
    described: opt.description ? today() : old?.described || null, added: old?.added || today(),
  };
  e.state = stateOf(e);
  reg.entries[h] = e; reg.generated = today();
  writeJson(REG, reg);
  console.log(msg('resources.registered', { updated: old ? msg('resources.entry_updated') : msg('resources.entry_added'), sha: h.slice(0, 12), path: e.path, state: e.state }));
}

// --- the describer without a model: the description and tags from the headings, sheets, headers, first lines ----
const zlib = require('zlib');
// The stop words include the ru ones (descriptions hold ru text): a filtering pattern, held as \u escapes.
const STOP = new Set(('\u044d\u0442\u043e \u043a\u0430\u043a \u0434\u043b\u044f \u0447\u0442\u043e \u043f\u0440\u0438 \u0438\u043b\u0438 \u0442\u0430\u043a\u0436\u0435 \u0435\u0441\u043b\u0438 \u0431\u044b\u0442\u044c \u0447\u0442\u043e\u0431\u044b \u043a\u043e\u0442\u043e\u0440\u044b\u0439 \u043a\u043e\u0442\u043e\u0440\u044b\u0435 \u0442\u043e\u043b\u044c\u043a\u043e \u043c\u043e\u0436\u043d\u043e \u043d\u0443\u0436\u043d\u043e the and for with from that this are not you your').split(' '));

function zipEntries(buf) {                                // a minimal zip reader: name -> () => Buffer
  const out = {};
  let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65600); i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) return out;
  let p = buf.readUInt32LE(e + 16);
  const n = buf.readUInt16LE(e + 10);
  for (let k = 0; k < n && buf.readUInt32LE(p) === 0x02014b50; k++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    out[name] = () => {
      const s = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28), raw = buf.subarray(s, s + csize);
      return method === 0 ? raw : zlib.inflateRawSync(raw);
    };
    p += 46 + nl + xl + cl;
  }
  return out;
}
const unxml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, '&');
const xmlTexts = (xml, tag) => [...xml.matchAll(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'g'))].map(m => unxml(m[1].replace(/<[^>]+>/g, '')).trim());
const clean = s => s.replace(/[#*`|>_]+/g, ' ').replace(/\s+/g, ' ').trim();

function describeParts(f, ext) {                          // -> { heads, body, sheets, cols }
  const buf = fs.readFileSync(f), r = { heads: [], body: '', sheets: [], cols: [] };
  const txt = () => buf.toString('utf8').replace(/^﻿/, '');
  if (['md', 'txt', 'csv', 'json', 'cjs', 'js'].includes(ext)) {
    const t = txt(), lines = t.split(/\r?\n/);
    if (ext === 'md') {
      r.heads = lines.filter(l => /^#{1,3}\s/.test(l)).map(l => clean(l)).slice(0, 6);
      r.body = lines.filter(l => l.trim() && !/^(#|---|```|\||\w+:\s)/.test(l.trim()))[0] || '';
    } else if (ext === 'csv') { r.cols = (lines[0] || '').split(/[;,\t]/).map(s => s.replace(/^"|"$/g, '').trim()).filter(Boolean).slice(0, 12); }
    else if (ext === 'json') { try { const o = JSON.parse(t); r.cols = Object.keys(Array.isArray(o) ? (o[0] || {}) : o).slice(0, 12); } catch { r.body = lines[0] || ''; } }
    else if (ext === 'cjs' || ext === 'js') r.body = lines.filter(l => /^\s*\/\/\s*\S/.test(l)).slice(0, 2).map(l => l.replace(/^\s*\/\/\s*/, '')).join(' ');
    else r.body = lines.filter(l => l.trim()).slice(0, 2).join(' ');
  } else if (ext === 'html') {
    const t = txt();
    r.heads = [...xmlTexts(t, 'title'), ...xmlTexts(t, 'h1'), ...xmlTexts(t, 'h2')].filter(Boolean).slice(0, 6);
    r.body = xmlTexts(t, 'p')[0] || '';
  } else if (ext === 'drawio') {
    const t = txt();
    let x = t;
    const d = t.match(/<diagram[^>]*>([^<]+)<\/diagram>/);                     // the compressed variant
    if (d) { try { x = decodeURIComponent(zlib.inflateRawSync(Buffer.from(d[1], 'base64')).toString('utf8')); } catch { /* keep */ } }
    r.heads = [...t.matchAll(/<diagram[^>]*\sname="([^"]*)"/g)].map(m => unxml(m[1]));
    r.cols = [...x.matchAll(/\svalue="([^"]*)"/g)].map(m => clean(unxml(unxml(m[1]).replace(/<[^>]+>/g, ' ')))).filter(Boolean).slice(0, 14);
  } else if (ext === 'docx') {
    const z = zipEntries(buf), doc = z['word/document.xml'] && z['word/document.xml']().toString('utf8');
    if (doc) {
      // \u0417\u0430\u0433\u043e\u043b\u043e\u0432\u043e\u043a = the ru Word "Heading" style, a parse pattern held as escapes
      const paras = [...doc.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(m => ({ h: /<w:pStyle w:val="(?:Heading|Title|\u0417\u0430\u0433\u043e\u043b\u043e\u0432\u043e\u043a)/i.test(m[0]), t: xmlTexts(m[0], 'w:t').join('') })).filter(p => p.t);
      r.heads = paras.filter(p => p.h).map(p => p.t).slice(0, 5);
      r.body = (paras.find(p => !p.h) || {}).t || '';
    }
  } else if (ext === 'pptx') {
    const z = zipEntries(buf), nn = s => parseInt(s.replace(/\D/g, ''));
    const names = Object.keys(z).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => nn(a) - nn(b));
    for (const n of names.slice(0, 6)) { const t = xmlTexts(z[n]().toString('utf8'), 'a:t').filter(Boolean); if (t[0]) r.heads.push(t[0]); if (!r.body && t[1]) r.body = t[1]; }
  } else if (ext === 'xlsx') {
    const z = zipEntries(buf), wb = z['xl/workbook.xml'] && z['xl/workbook.xml']().toString('utf8');
    const ss = z['xl/sharedStrings.xml'] ? [...z['xl/sharedStrings.xml']().toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => unxml(m[1].replace(/<[^>]+>/g, ''))) : [];
    if (wb) r.sheets = [...wb.matchAll(/<sheet\s[^>]*name="([^"]*)"/g)].map(m => unxml(m[1]));
    const s1 = z['xl/worksheets/sheet1.xml'] && z['xl/worksheets/sheet1.xml']().toString('utf8');
    if (s1) {
      const row = (s1.match(/<row[ >][\s\S]*?<\/row>/) || [''])[0];
      r.cols = [...row.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map(m => {
        const v = (m[2] || '').match(/<v>([\s\S]*?)<\/v>/), is = (m[2] || '').match(/<is>([\s\S]*?)<\/is>/);
        return /t="s"/.test(m[1]) && v ? ss[+v[1]] : is ? unxml(is[1].replace(/<[^>]+>/g, '')) : v ? v[1] : '';
      }).map(s => (s || '').trim()).filter(Boolean).slice(0, 12);
    }
  }
  return r;
}

function describeEntry(e) {
  const ext = (e.format || '').toLowerCase(), name = path.basename(e.path, path.extname(e.path)).replace(/[-_]+/g, ' ');
  let p = { heads: [], body: '', sheets: [], cols: [] };
  try { p = describeParts(path.join(ROOT, e.path), ext); } catch { /* the description from the name and the class */ }
  const parts = [];
  if (p.sheets.length) parts.push(msg('resources.part_sheets') + p.sheets.join(', '));
  if (p.cols.length) parts.push((ext === 'drawio' ? msg('resources.part_node_labels') : ext === 'json' ? msg('resources.part_keys') : msg('resources.part_columns')) + p.cols.join(', '));
  if (p.heads.length) parts.push((ext === 'pptx' ? msg('resources.part_slides') : ext === 'drawio' ? msg('resources.part_diagram') : msg('resources.part_headings')) + p.heads.join(' / '));
  if (p.body) parts.push(clean(p.body));
  let d = `${name} (${ext}). ` + (parts.length ? parts.join('. ') : msg('resources.description_fallback', { klass: e.class || msg('resources.generic_file') }));
  d = d.replace(/\s+/g, ' ');
  if (d.length > 300) d = d.slice(0, 299).replace(/[\s,;:.\/]+\S*$/, '') + '…';
  if (d.length > 300) d = d.slice(0, 300);
  const stop = loadRules().stopSet;
  const words = (normWord(p.sheets.concat(p.cols, p.heads, [name, p.body]).join(' ')).match(/\p{L}[\p{L}\p{N}]{3,}/gu) || []).filter(w => !STOP.has(w) && !stop.has(w));
  const freq = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1] || a[0].length - b[0].length).slice(0, 5).map(x => x[0]);
  return { description: d, tags: [...new Set([e.class, ext, ...top].filter(Boolean))] };
}

function cmdDescribe(opt = {}) {
  const reg = readJson(REG, { entries: {} });
  const redo = typeof opt.redo === 'string' ? new RegExp(opt.redo) : null;   // --redo <path regex>: re-describe the entries described by the script (without a model)
  let done = 0, kept = 0, skipped = 0;
  for (const e of Object.values(reg.entries)) {
    const again = redo && redo.test(e.path) && !e.model;
    if (e.description && !again) { kept++; continue; }                     // already described (including by the model describer)
    if (e.class === 'generated' || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'mp4', 'webm', 'mov'].includes(e.format)) { skipped++; continue; }
    const r = describeEntry(e);
    Object.assign(e, { description: r.description, tags: r.tags, described: today() });
    done++;
  }
  writeJson(REG, reg);
  console.log(msg('resources.describe_summary', { done, kept, skipped }));
}

// --- semantic tags: the second pass, the model is called by the main session ----------------------------
const SEM_CLASSES = ['source', 'reference', 'doc', 'data', 'config', 'script'];

function cmdTagBatch(opt) {
  const rules = loadRules(), reg = readJson(REG, { entries: {} }), n = opt.n ? +opt.n : 20;
  const items = Object.entries(reg.entries).filter(([, e]) => SEM_CLASSES.includes(e.class) && !e.semantic_tags && fs.existsSync(path.join(ROOT, e.path))).slice(0, n)
    .map(([h, e]) => ({ sha256: h, path: e.path, class: e.class, description: e.description || null, tags: e.tags || [] }));
  const f = path.resolve(ROOT, opt.out || 'project/work/tag-batch.json');
  writeJson(f, { domain_tags: rules.domain_tags || [], items });
  console.log(msg('resources.tag_batch_summary', { count: items.length, file: rel(f) }));
}

function cmdApplyTags(file) {
  const rules = loadRules(), reg = readJson(REG, { entries: {} }), ans = file ? readJson(path.resolve(file), null) : null;
  if (!ans) { console.error(msg('resources.not_read', { file })); process.exit(2); }
  const dict = new Map((rules.domain_tags || []).map(t => [normWord(t), t]));
  const list = Array.isArray(ans) ? ans : ans.items || ans.answers || [];
  let ok = 0, dropped = 0, missing = 0;
  for (const a of list) {
    const e = reg.entries[a.sha256] || Object.entries(reg.entries).find(([h]) => h.startsWith(a.sha256 || '#'))?.[1];
    if (!e) { missing++; continue; }
    const good = [];
    for (const t of a.tags || []) { const c = dict.get(normWord(t)); if (c) { if (!good.includes(c)) good.push(c); } else dropped++; }
    e.semantic_tags = good.slice(0, 5);
    e.tags = [...new Set([...(e.tags || []), ...e.semantic_tags])];
    ok++;
  }
  writeJson(REG, reg);
  console.log(msg('resources.apply_tags_summary', { ok, dropped, missing }));
}

function cmdDecide(folder, cls) {
  if (!folder || !['resource', 'draft'].includes(cls)) { console.error(msg('resources.decide_usage')); process.exit(2); }
  const r = readJson(RULES, {});
  r.folders = { ...(r.folders || {}), [folder.replace(/\\/g, '/').replace(/\/$/, '')]: cls };
  writeJson(RULES, r);
  console.log(msg('resources.decide_recorded', { folder, cls }));
}

function main() {
  const { pos, opt } = args(), cmd = pos[0];
  if (opt.size) SIZE = +opt.size;
  if (cmd === 'sort') cmdSort();
  else if (cmd === 'inventory') cmdInventory();
  else if (cmd === 'report') cmdReport();
  else if (cmd === 'prepare') cmdPrepare(opt);
  else if (cmd === 'batch') cmdBatch(opt);
  else if (cmd === 'apply') cmdApply(pos[1], opt);
  else if (cmd === 'describe') cmdDescribe(opt);
  else if (cmd === 'tag-batch') cmdTagBatch(opt);
  else if (cmd === 'apply-tags') cmdApplyTags(pos[1]);
  else if (cmd === 'register') cmdRegister(pos[1], opt);
  else if (cmd === 'decide') cmdDecide(pos[1], pos[2]);
  else { console.error(msg('resources.commands')); process.exit(2); }
}

if (require.main === module) main();
module.exports = { loadRules, walk, classify, referenceMap, dims, stateOf, REG, SORT };
