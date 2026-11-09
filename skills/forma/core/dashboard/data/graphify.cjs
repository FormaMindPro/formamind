'use strict';

/**
 * Graphify - four graph corpora (project, manual, site, engine), each with its own last run,
 * cost and the number of nodes/edges/clusters/warnings (not an aggregate over all at once). All graphs are mechanical (no model).
 * project and manual get "stale" by the corpus content's hash (`checkCorpusStale`);
 * site and engine are built by separate scripts (`build-site-graph.cjs`, `build-engine-graph.cjs`) with their own
 * snapshot each - no file staleness here.
 *
 * The `.forma/dashboard/graphify.log` journal - not a card, not a cycle: one line per run.
 * The basic format (all old lines): YYYY-MM-DD HH:MM | mode=... | agents=N | tokens=N | $X.XXXX | <what was done>
 * The extended one - between the $ segment and the free summary sit optional key=value fields, in this order:
 * corpus=<project|manual|site|engine> | trigger=<manual|auto-accum|human> | nodes=N | edges=N | communities=N | warnings=N.
 * Each field is recognized independently: an old line without them parses just as before.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { walk, readJson } = require('../lib/fs.cjs');
const { cachePath } = require('./cache.cjs');

const GRAPHIFY_HEAD_RE =
  /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s*\|\s*mode=(\S+)\s*\|\s*agents=(\d+)\s*\|\s*tokens=(\d+)\s*\|\s*\$([\d.]+)\s*\|\s*(.*)$/;
const GRAPHIFY_EXTRA_KEY_RE = /^(corpus|trigger|nodes|edges|communities|warnings)=(.+)$/;

/** The graph corpora - the same names as the tabs. */
const GRAPHIFY_CORPORA = ['project', 'manual', 'site', 'engine'];

function parseGraphifyLine(trimmed) {
  const m = GRAPHIFY_HEAD_RE.exec(trimmed);
  if (!m) return null;
  const [, at, mode, agents, tokens, costUsd, rest] = m;
  const run = {
    at, mode,
    agents: parseInt(agents, 10),
    tokens: parseInt(tokens, 10),
    costUsd: parseFloat(costUsd),
    corpus: null, trigger: null, nodes: null, edges: null, communities: null, warnings: null,
    summary: rest,
  };
  const parts = rest.split(/\s*\|\s*/);
  let i = 0;
  while (i < parts.length) {
    const km = GRAPHIFY_EXTRA_KEY_RE.exec(parts[i]);
    if (!km) break;
    const [, key, val] = km;
    run[key] = /^\d+$/.test(val) ? parseInt(val, 10) : val;
    i += 1;
  }
  run.summary = parts.slice(i).join(' | ');
  return run;
}

function readRuns(file) {
  const runs = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const run = parseGraphifyLine(trimmed);
    if (run) runs.push(run);
  }
  return runs;
}

/**
 * The breakdown by corpora. Lines without an explicit `corpus=` - old records, they belong to the `legacy` corpus.
 */
function byCorpusOf(runs) {
  const byCorpus = {};
  for (const r of runs) {
    const corpus = r.corpus || 'legacy';
    if (!byCorpus[corpus]) byCorpus[corpus] = { corpus, runCount: 0, tokensTotal: 0, costUsdTotal: 0, lastRun: null };
    const c = byCorpus[corpus];
    c.runCount += 1;
    c.tokensTotal += r.tokens;
    c.costUsdTotal += r.costUsd;
    c.lastRun = r; // the lines go in file order - the last overwrite is the last run
  }
  for (const c of Object.values(byCorpus)) c.costUsdTotal = Number(c.costUsdTotal.toFixed(6));
  return byCorpus;
}

function readGraphifyLog(projectRoot) {
  const file = path.join(projectRoot, '.forma/dashboard', 'graphify.log');
  const emptyAggregate = { runCount: 0, lastRunAt: null, agentsTotal: 0, tokensTotal: 0, costUsdTotal: 0, recent: [], byCorpus: {} };
  if (!fs.existsSync(file)) return emptyAggregate;
  const runs = readRuns(file);
  if (!runs.length) return emptyAggregate;
  return {
    runCount: runs.length,
    lastRunAt: runs[runs.length - 1].at,
    agentsTotal: runs.reduce((s, r) => s + r.agents, 0),
    tokensTotal: runs.reduce((s, r) => s + r.tokens, 0),
    costUsdTotal: Number(runs.reduce((s, r) => s + r.costUsd, 0).toFixed(6)),
    recent: runs.slice(-5).reverse(),
    byCorpus: byCorpusOf(runs),
  };
}

// The marker from graphify-trigger.cjs - the accumulation of events passed the threshold from graphify.config.json, the graph
// asks for a rebuild.
const readGraphifyPending = (projectRoot) => readJson(cachePath(projectRoot, 'graphify-pending.json'), null);

// The corpus directory on disk for each tab name.
const CORPUS_SOURCE_DIR = { project: 'project', manual: '.forma/manual' };
// Service subdirectories are not counted as corpus content: they change with cache and versions, not with content edits.
const FINGERPRINT_SKIP_DIRS = new Set(['.cache', 'node_modules', '.git']);

function hashCorpus(dirAbs) {
  const skip = (e) => e.name.startsWith('.') || FINGERPRINT_SKIP_DIRS.has(e.name);
  const parts = walk(dirAbs, { symlinks: true, skip }).map((rel) => {
    const stat = fs.statSync(path.join(dirAbs, rel));
    return `${rel}:${stat.size}:${Math.round(stat.mtimeMs)}`;
  });
  parts.sort();
  return crypto.createHash('sha1').update(parts.join('\n')).digest('hex');
}

/**
 * The corpus content's hash (project/ or .forma/manual/) at the moment of the last graph build, compared with the current one -
 * "stale" without a continuous event count. The reference point is the mtime of .forma/living/graphs/<corpus>/graph.json:
 * when it changes (a new /graphify build), the corpus content and the hash match by definition, and then
 * the hash snapshot is overwritten anew. While graph.json has not changed - the current hash is checked against the stored snapshot.
 * The state - .forma/dashboard/.cache/corpus-fingerprint-<corpus>.json; only this function reads and writes it.
 */
function checkCorpusStale(projectRoot, corpus) {
  const dirName = CORPUS_SOURCE_DIR[corpus];
  if (!dirName) return null;
  const graphFile = path.join(projectRoot, '.forma/living', 'graphs', corpus, 'graph.json');
  if (!fs.existsSync(graphFile)) return null; // the graph has never been built yet

  const stateFile = cachePath(projectRoot, `corpus-fingerprint-${corpus}.json`);
  const graphMtime = fs.statSync(graphFile).mtimeMs;
  const state = readJson(stateFile, null);
  const currentHash = hashCorpus(path.join(projectRoot, dirName));

  if (!state || state.graphMtimeAtBuild !== graphMtime) {
    // graph.json is newer than the last snapshot (or there was no snapshot yet) - a new reference point.
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ graphMtimeAtBuild: graphMtime, hashAtBuild: currentHash }, null, 2), 'utf8');
    return false;
  }
  return state.hashAtBuild !== currentHash;
}

function corpusView(projectRoot, corpus, marks) {
  const fromLog = marks.log.byCorpus[corpus] || null;
  return {
    corpus,
    runCount: fromLog ? fromLog.runCount : 0,
    tokensTotal: fromLog ? fromLog.tokensTotal : 0,
    costUsdTotal: fromLog ? fromLog.costUsdTotal : 0,
    lastRun: fromLog ? fromLog.lastRun : null,
    stale: checkCorpusStale(projectRoot, corpus),
    pending: null,
  };
}

/** `{ graphify, graphifyPending, graphifyByCorpus }` - the run journal, the accumulation marker and the corpora. */
function buildGraphify(projectRoot) {
  const log = readGraphifyLog(projectRoot);
  const pending = readGraphifyPending(projectRoot);
  const graphifyByCorpus = {};
  for (const corpus of GRAPHIFY_CORPORA) {
    graphifyByCorpus[corpus] = corpusView(projectRoot, corpus, { log, pending });
  }
  return { graphify: log, graphifyPending: pending, graphifyByCorpus };
}

/** Whether each corpus's `graph.html` is built: `{ manual, project, site, engine, goals, arsenal, structure, resources, board, central }`. */
function graphsBuilt(projectRoot) {
  return Object.fromEntries(['manual', 'project', 'site', 'engine', 'goals', 'arsenal', 'structure', 'resources', 'board', 'central'].map((c) => [c, fs.existsSync(path.join(projectRoot, '.forma/living', 'graphs', c, 'graph.html'))]));
}

module.exports = { buildGraphify, graphsBuilt };
