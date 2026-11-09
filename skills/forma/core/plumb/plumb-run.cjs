#!/usr/bin/env node
'use strict';
// The external executor's Plumb driver (plumb: jev, OpenRouter Decisions API, typesafe/jev-1.14).
// A scrubbed card + a roles catalog -> the bridge (external-model-bridge.cjs, Decisions API) ->
// strict JSON {choice, score, noul}. It does not call haiku itself (the script has no Agent tool) -
// with a missing key, a bridge error or a scrub refusal it prints {fallback:"haiku", reason:...}
// and exits with code 0: the caller (the main session) then calls plumb-haiku itself.
//
// Usage:
//   node .forma/plumb/plumb-run.cjs <card.md> [--root DIR] [--engine ID | --roles-dir PATH]
//                                   [--site host[,host]] [--out FILE] [--write]
//
// --write: on a jev answer it appends one Plumb line to the end of the card's "## History / ## History" zone
// (role, confidence, gap, clarity, noul, executor, the verdict against the PROJECT.md thresholds, the spend in
// its own unit: tokens, ms, USD) and prints the same JSON. With {fallback:haiku} no line is written.
//
// Roles catalog: --roles-dir (the path as is) or the engine adapter's runRolesDir --engine
// (.forma/dashboard/lib/engines.cjs, sourcesOf; the ID is id, engine, spendTag or the adapter folder's name).
// Without arguments - the Claude catalog (.claude/agents/run).
//
// The output contract is the same as plumb-haiku.md's: {choice, score, noul}, plus meta (not part of the
// contract, only for the spend line): usage, cost_usd, duration_ms, id, model_served, roles_dir, roles.

const fs = require('fs');
const path = require('path');
const i18n = require('../i18n/index.cjs');

// The scrubber and the bridge sit next to the driver or in the Claude scripts.
function requireSibling(name) {
  for (const dir of [__dirname, path.join(__dirname, '..', '..', '.claude', 'scripts')]) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) return require(file);
  }
  throw new Error(`module not found: ${name}`);
}
const { extractTask, loadSecrets, scrub, residue } = requireSibling('plumb-scrub.cjs');
const { loadEnvKeyOptional, callDecisions, estimateCostUsd } = requireSibling('external-model-bridge.cjs');

// The fallback model name: matches PROJECT.md (the routes.plumb_model key); the source is PROJECT.md.
const FALLBACK_MODEL = 'typesafe/jev-1.14';

// The jev model from PROJECT.md: the first `provider/model` in the line with the routes.plumb_model key.
function readModel(root) {
  try {
    const md = fs.readFileSync(path.join(root, 'project', 'config', 'PROJECT.md'), 'utf8');
    const row = md.split(/\r?\n/).find((l) => l.includes('routes.plumb_model'));
    const m = row && /`([\w.-]+\/[\w.:-]+)`/.exec(row.split('-->').slice(1).join('-->'));
    if (m) return m[1];
  } catch (e) { /* no PROJECT.md or unreadable - the fallback name */ }
  return FALLBACK_MODEL;
}
const DEFAULT_ROLES_REL = '.claude/agents/run';

function parseArgs(argv) {
  const a = { card: null, root: process.cwd(), site: [], out: null, engine: null, rolesDir: null, write: false, dry: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--root') a.root = path.resolve(argv[++i]);
    else if (v === '--engine') a.engine = argv[++i];
    else if (v === '--roles-dir') a.rolesDir = argv[++i];
    else if (v === '--site') a.site.push(...argv[++i].split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
    else if (v === '--out') a.out = argv[++i];
    else if (v === '--write') a.write = true;
    else if (v === '--dry') a.dry = true;
    else if (!a.card) a.card = v;
  }
  return a;
}

// Roles catalog: --roles-dir > the --engine adapter's runRolesDir > the Claude catalog.
function resolveRolesDir(a) {
  if (a.rolesDir) return path.resolve(a.root, a.rolesDir);
  if (a.engine) {
    const engines = require(path.join(a.root, '.forma', 'dashboard', 'lib', 'engines.cjs'));
    const adapter = engines.loadAdapters(a.root).find((x) =>
      [engines.idOf(x), x.engine, x.spendTag, x.dir && String(x.dir).replace(/^\./, '')].includes(a.engine));
    if (!adapter) throw new Error(`unknown engine: ${a.engine}`);
    return engines.resolveRel(a.root, engines.sourcesOf(adapter).runRolesDir);
  }
  return path.join(a.root, ...DEFAULT_ROLES_REL.split('/'));
}

function buildCatalog(roleDir) {
  const roles = [];
  for (const f of fs.readdirSync(roleDir).filter((n) => n.endsWith('.md')).sort()) {
    const md = fs.readFileSync(path.join(roleDir, f), 'utf8');
    const name = f.replace(/\.md$/, '');
    const desc = (/^description:\s*(.+)$/m.exec(md) || [])[1] || '';
    const take = (/## When to take\s+([\s\S]*?)\n## /.exec(md) || [])[1] || '';
    const tdn = (/## Takes \/ does not take\s+([\s\S]*?)\n## /.exec(md) || [])[1] || '';
    roles.push({ name, text: `${desc}\n${take.trim()}\n${tdn.trim()}`.trim() });
  }
  return roles;
}

// The thresholds from PROJECT.md (the "Plumb" table row), the executor's set: jev - the text after "jev:",
// haiku - before "jev:". The keys are English (leader, gap, noul, clarity); local words are aliases.
// All values are numbers 0..100 (percents). For haiku, noul and clarity may be null.
function readThresholds(root, executor) {
  try {
    const md = fs.readFileSync(path.join(root, 'project', 'config', 'PROJECT.md'), 'utf8');
    // The thresholds as separate table rows by the plumb.<executor>.<threshold> keys.
    const who = executor === 'haiku' ? 'haiku' : 'jev';
    const byRow = { leader: null, gap: null, noul: null, clarity: null };
    for (const f of Object.keys(byRow)) byRow[f] = i18n.rowNumber(md, `plumb.${who}.${f}`);
    const needed = who === 'jev' ? Object.values(byRow) : [byRow.leader, byRow.gap];
    if (needed.every((v) => v !== null)) return who === 'jev' ? byRow : { ...byRow, noul: null, clarity: null };
    // The older shape: the thresholds inside the "Plumb" row as the text "leader >= 60 %".
    let row = md.split(/\r?\n/).find((l) => /plumb/i.test(l) && /≥/.test(l));
    if (!row) return null;
    const cut = row.search(/jev\s*:/i);
    const isJev = (executor || 'jev') === 'jev';
    if (cut >= 0) row = isJev ? row.slice(cut) : row.slice(0, cut);
    const num = (re) => { const m = re.exec(row); return m ? Number(m[1].replace(',', '.')) : null; };
    const re = (key, between) => new RegExp(`(?:${i18n.alt(key)})${between}≥\\s*([\\d.,]+)`, 'i');
    const t = {
      leader: num(re('plumb.leader', '\\s*')),
      gap: num(re('plumb.gap', '[^≥]*')),
      noul: num(re('plumb.noul', '[^≥]*')),
      clarity: num(re('plumb.clarity', '[^≥]*')),
    };
    const required = isJev ? Object.values(t) : [t.leader, t.gap];
    return required.some((v) => v === null) ? null : t;
  } catch (e) {
    return null;
  }
}

// noul arrives as a fraction 0..1; the threshold is in percents. A value <= 1 is a fraction.
function toPercent(v) { return v <= 1 ? v * 100 : v; }

// The Plumb line for the card's history.
function plumbLine(result, root) {
  const { choice, score, noul, meta } = result;
  const probs = Object.entries(choice.probabilities).sort((x, y) => y[1] - x[1]);
  const lead = probs[0] ? probs[0][1] : 0;
  const second = probs[1] ? probs[1][1] : 0;
  const gap = lead - second;
  const leadNoul = noul[choice.role];
  const t = readThresholds(root, meta.executor);
  let outcome;
  if (!t) outcome = i18n.message('plumb.thresholds_unread', null, 'ru');
  else {
    const miss = [];
    if (lead < t.leader) miss.push(i18n.message('plumb.miss_leader', { v: lead, t: t.leader }, 'ru'));
    if (gap < t.gap) miss.push(i18n.message('plumb.miss_gap', { v: gap, t: t.gap }, 'ru'));
    if (t.noul !== null) {
      if (typeof leadNoul !== 'number') miss.push(i18n.message('plumb.miss_noul_missing', { t: t.noul }, 'ru'));
      else if (toPercent(leadNoul) < t.noul) miss.push(`noul ${Math.round(toPercent(leadNoul))} < ${t.noul}`);
    }
    if (t.clarity !== null && score.clarity < t.clarity) miss.push(i18n.message('plumb.miss_clarity', { v: score.clarity, t: t.clarity }, 'ru'));
    outcome = miss.length ? i18n.message('plumb.below_threshold', { miss: miss.join('; ') }, 'ru') : i18n.message('plumb.thresholds_passed', null, 'ru');
  }
  const u = meta.usage || {};
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const spend = i18n.message('plumb.spend_line', {
    model: meta.model_requested, id: meta.id || 'id unknown',
    tok_in: u.prompt_tokens ?? 'unknown', tok_out: u.completion_tokens ?? 'unknown',
    ms: meta.duration_ms, cost: meta.cost_usd === null ? 'cost unknown' : '$' + meta.cost_usd,
  }, 'ru');
  return i18n.message('plumb.history_line', {
    date, executor: meta.executor, spend, role: choice.role, lead, gap, clarity: score.clarity,
    noul: leadNoul ?? i18n.message('plumb.no_value', null, 'ru'),
    outcome,
  }, 'ru');
}

// Appends the line to the end of the "## History / ## History" zone; no zone - an error.
function appendHistory(cardFile, line) {
  const md = fs.readFileSync(cardFile, 'utf8');
  const nl = md.includes('\r\n') ? '\r\n' : '\n';
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => i18n.headingRe('zone.history', '').test(l));
  if (start < 0) throw new Error(i18n.message('plumb.no_history_zone', null, 'ru'));
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (end < 0) end = lines.length;
  let at = end;
  while (at > start + 1 && lines[at - 1].trim() === '') at--;
  lines.splice(at, 0, line);
  fs.writeFileSync(cardFile, lines.join(nl));
}

function emit(obj, outFile) {
  const json = JSON.stringify(obj, null, 2);
  if (outFile) fs.writeFileSync(outFile, json);
  else console.log(json);
}

function fallback(reason, extra, outFile) {
  emit({ fallback: 'haiku', reason, ...(extra || {}) }, outFile);
  process.exit(0);
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.card) {
    console.error('usage: plumb-run.cjs <card.md> [--root DIR] [--engine ID | --roles-dir PATH] [--site host] [--out FILE] [--write] [--dry]');
    process.exit(1);
  }

  const model = readModel(a.root);
  if (a.dry) {
    emit({ dry: true, model }, a.out);
    return;
  }

  const apiKey = loadEnvKeyOptional('OPENROUTER_API_KEY', a.root);
  if (!apiKey) return fallback('no-key', null, a.out);

  let md;
  try {
    md = fs.readFileSync(a.card, 'utf8');
  } catch (e) {
    console.error(`cannot read card: ${e.message}`);
    process.exit(1);
  }
  const task = extractTask(md);
  if (!task) {
    console.error(i18n.message('plumb.no_task_zone', null, 'ru'));
    process.exit(1);
  }

  let rolesDir;
  try {
    rolesDir = resolveRolesDir(a);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  const siteHosts = new Set(a.site);
  const secrets = loadSecrets(a.root, siteHosts);

  const { text: scrubbedTask, counts: taskCounts } = scrub(task, secrets, siteHosts);
  const taskResidue = residue(scrubbedTask, secrets);
  if (taskResidue.length) return fallback('scrub-refused', { report: { refused: taskResidue } }, a.out);

  let roles;
  try {
    roles = buildCatalog(rolesDir);
  } catch (e) {
    console.error(`cannot read roles dir ${rolesDir}: ${e.message}`);
    process.exit(1);
  }
  const catalogText = roles.map((r) => `### ${r.name}\n${r.text}`).join('\n\n');
  const { text: scrubbedCatalog, counts: catalogCounts } = scrub(catalogText, secrets, siteHosts);
  const catalogResidue = residue(scrubbedCatalog, secrets);
  if (catalogResidue.length) return fallback('scrub-refused', { report: { refused: catalogResidue } }, a.out);

  // We split the scrubbed catalog back by roles (the order and boundaries are the same as when gluing) -
  // this way each role's noul criteria see its own text, already scrubbed, not the original one.
  const scrubbedSections = scrubbedCatalog.split(/\n(?=### )/);
  const byRole = {};
  for (const sec of scrubbedSections) {
    const m = /^### (\S+)\n([\s\S]*)$/.exec(sec);
    if (m) byRole[m[1]] = m[2].trim();
  }

  const roleCriteria = {};
  for (const r of roles) roleCriteria[r.name] = (byRole[r.name] || r.text).slice(0, 600);

  const questions = {
    role: {
      type: 'choice',
      instructions: 'Which catalog role fits this task best, judged only by its own criteria text?',
      criteria: roleCriteria,
    },
    clarity: {
      type: 'score',
      instructions: 'How clearly is the task stated — result, form and criterion unambiguous?',
      criteria: [
        'Cannot tell what is wanted',
        'Vague: goal guessable, form or criterion missing',
        'Goal clear, form or criterion still ambiguous',
        'Goal and form clear, criterion has one small gap',
        'Result, form and criterion unambiguous',
      ],
    },
  };
  for (const r of roles) {
    questions[`fit_${r.name}`] = {
      type: 'noul',
      instructions: `Does the role "${r.name}" (its criteria are in state.catalog) take this task as written?`,
      criteria: {
        true: 'The task matches this role\'s "takes" examples and stays inside its boundary.',
        false: 'The task matches this role\'s "does not take" examples or falls outside its boundary.',
      },
    };
  }

  const state = { task: scrubbedTask, catalog: scrubbedCatalog };

  const t0 = Date.now();
  let res;
  try {
    res = await callDecisions({ apiKey, model, questions, state });
  } catch (e) {
    return fallback('bridge-error', { report: { message: e.message } }, a.out);
  }
  const durationMs = Date.now() - t0;

  const answers = res.answers || {};
  if (!answers.role || typeof answers.role.choice !== 'string' || !answers.clarity) {
    return fallback('bad-response', { report: { message: 'missing role/clarity in answers' } }, a.out);
  }

  const choice = {
    role: answers.role.choice,
    probabilities: Object.fromEntries(
      Object.entries(answers.role.probabilities || {}).map(([k, v]) => [k, Math.round(v * 100)])
    ),
    confidence: Math.round((answers.role.confidence || 0) * 100),
  };
  const score = {
    clarity: Math.max(0, Math.min(4, Math.round(answers.clarity.score ?? 0))),
    confidence: Math.round((answers.clarity.confidence || 0) * 100),
  };
  const topTwo = Object.entries(choice.probabilities)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 2)
    .map(([k]) => k);
  const noul = {};
  for (const name of topTwo) {
    const ans = answers[`fit_${name}`];
    if (ans && typeof ans.noul === 'number') noul[name] = ans.noul;
  }

  const usage = res.usage || {};
  const costUsd =
    typeof usage.cost === 'number'
      ? usage.cost
      : estimateCostUsd('openrouter', model, { prompt_tokens: usage.input_tokens, completion_tokens: usage.output_tokens });

  const result = {
    choice,
    score,
    noul,
    meta: {
      executor: 'jev',
      model_requested: model,
      model_served: res.model || null,
      id: res.id || null,
      usage: { prompt_tokens: usage.input_tokens ?? null, completion_tokens: usage.output_tokens ?? null },
      cost_usd: costUsd === null ? null : Number(costUsd.toFixed(6)),
      duration_ms: durationMs,
      scrub_report: { task: taskCounts, catalog: catalogCounts },
      roles_dir: path.relative(a.root, rolesDir).split(path.sep).join('/'),
      roles: roles.map((r) => r.name),
    },
  };
  if (a.write) {
    try {
      appendHistory(a.card, plumbLine(result, a.root));
    } catch (e) {
      console.error(`--write failed: ${e.message}`);
      emit(result, a.out);
      process.exit(1);
    }
  }
  emit(result, a.out);
}

module.exports = { readThresholds, plumbLine, readModel };

if (require.main === module) {
  main().catch((e) => {
    console.error('plumb-run error:', e.message);
    fallback('error', { report: { message: e.message } });
  });
}
