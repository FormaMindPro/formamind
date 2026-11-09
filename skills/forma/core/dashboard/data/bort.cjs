'use strict';

/**
 * THE ARSENAL - what is on board for each node and for the session.
 *
 * Three tiers, and they are NOT mixed, because there are really three arsenals and they are edited in three different places:
 * a node's arsenal - by the role file, MCP servers - by the session configuration for all nodes at once, the window's floor - by the engine,
 * and it does not obey us. One list for all this would suggest switching off what cannot be switched off.
 *
 * The frontmatter and journal parsing is NOT repeated here: it is taken from the engine's adapter (`toolUsage`). Two parses
 * of one journal will someday diverge, and diverge silently. The dependency is optional; no adapter -
 * the node tier honestly says there is no source.
 */

const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('../lib/card.cjs');
const engines = require('../lib/engines.cjs');
const { readStatement } = require('./cache.cjs');

// The price of one declared tool per one attempt step is an estimate, not a measurement (first measurement: ~720 tokens).
// The display calls it an estimate, too.
const TOOL_TOKEN_COST = 720;

/**
 * THREE VERDICT VALUES, AND THE THIRD IS THE MAIN ONE ON THIS SCREEN.
 *
 * The journal seals exactly one side airtight: not a single attempt - the tool is being fiddled with in vain. The converse is wrong
 * twice over. First, an attempt does not prove usefulness: the hook writes PreToolUse, that is "reached for", not "worked".
 * Second, THE ABSENCE OF A JOURNAL FOR A NODE DOES NOT MEAN ITS TOOLS ARE SUPERFLUOUS: a node the journal
 * does not mention at all, an empty line and an unopened line look alike, and a screen that declared the arsenal dead
 * would propose cutting away what is needed.
 *
 * The distinction is drawn BY NODE, not by tool:
 *   • no journal at all (no file / no entries)             → everything "unknown"
 *   • a journal exists, but not one line for THIS node     → everything "unknown"
 *   • lines exist for this node, the tool has 0 attempts   → "proved superfluous"
 *   • attempts exist                                        → "in service"
 */
function verdictFor(calls, nodeInLog) {
  if (!nodeInLog) return 'unknown';
  return calls > 0 ? 'live' : 'dead';
}

// ---- MCP servers --------------------------------------------------------------------------------

function mcpServerRow(name, cfg, meta) {
  return {
    name,
    source: meta.rel,
    level: meta.level,
    transport: cfg.type || (cfg.command ? 'stdio' : 'unknown'),
    target: cfg.url || [cfg.command, ...(cfg.args || [])].filter(Boolean).join(' ') || null,
    broken: false,
  };
}

/**
 * MCP SERVERS ARE READ FROM TWO LEVELS, AND THIS CODE NEVER SEES THE THIRD AT ALL.
 *
 * There are two configuration levels on disk: the project's and the user's (the top-level `mcpServers` key);
 * the files are named by the engine's adapter (`mcpConfigs`). The first travels with the repository, the second with the human; each
 * server says where it came from. Beyond these two the session carries account-level connectors and plugin
 * servers: they are in no local file, they cannot be read from here - and staying silent about that is even less allowed.
 * Hence `scanned` returns the levels covered, and the display must name the unreadable one in words.
 */
function readMcpConfigs(projectRoot) {
  const servers = [];
  const scanned = [];
  for (const { rel, file, level } of engines.collect(projectRoot, 'mcpConfigs')) {
    // The file may be absent - that is not an error, that is "not declared at this level".
    if (!fs.existsSync(file)) { scanned.push({ source: rel, level, exists: false, broken: false, count: 0 }); continue; }
    let d;
    try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {
      servers.push({ name: null, source: rel, level, broken: true });
      scanned.push({ source: rel, level, exists: true, broken: true, count: 0 });
      continue;
    }
    const entries = Object.entries(d.mcpServers || {});
    for (const [name, cfg] of entries) servers.push(mcpServerRow(name, cfg, { rel, level }));
    scanned.push({ source: rel, level, exists: true, broken: false, count: entries.length });
  }
  return { servers, scanned };
}

/**
 * The session tier, second half: which servers the roles reference. The server name comes from `mcp__<server>__<tool>`.
 * A server absent from the project's configuration is NOT "unauthorized": it may arrive from the global config
 * or a plugin. The third value here too, for the same reason as in the verdict.
 */
function referencedServers(nodes, servers) {
  const configured = new Set(servers.map((s) => s.name).filter(Boolean));
  const refMap = new Map();
  for (const n of nodes) {
    for (const t of n.tools || []) {
      const p = t.base.split('__');
      if (p.length < 3 || p[0] !== 'mcp') continue;
      const server = p[1];
      if (!refMap.has(server)) refMap.set(server, { server, nodes: [], toolCount: 0, inProjectConfig: configured.has(server) });
      const e = refMap.get(server);
      if (!e.nodes.includes(n.node)) e.nodes.push(n.node);
      e.toolCount += 1;
    }
  }
  return [...refMap.values()].sort((a, b) => a.server.localeCompare(b.server));
}

// ---- nodes ---------------------------------------------------------------------------------------

/** The window's floor is read from the cache, not computed here; `node .forma/dashboard/floor.cjs` computes it. */
const readFloor = (projectRoot) => readStatement(projectRoot, 'floor.json', ['cache', 'sessions']);

/** Attempts by node. The key is the node's name in lower case, as in the journal and the frontmatter. */
function callsByNode(rows) {
  const byNode = new Map();
  for (const r of rows) {
    const k = r.node.toLowerCase();
    if (!byNode.has(k)) byNode.set(k, new Map());
    const t = byNode.get(k);
    t.set(r.tool, (t.get(r.tool) || 0) + 1);
  }
  return byNode;
}

const sumCalls = (used) => [...used.values()].reduce((a, b) => a + b, 0);

function toolRows(role, used, ctx) {
  return role.decls.map((decl) => {
    const base = ctx.toolUsage.baseName(decl);
    const calls = used.get(base) || 0;
    // The journal stores the bare tool_name without arguments: two `Bash(...)` entries with different templates are
    // indistinguishable to it - their attempts are not split but duplicated. This is marked, not hushed up.
    const sameBase = role.decls.filter((d) => ctx.toolUsage.baseName(d) === base).length;
    return { decl, base, calls, ambiguous: sameBase > 1 && calls > 0, verdict: verdictFor(calls, ctx.nodeInLog) };
  });
}

/**
 * Were reached for, but not declared in the frontmatter (`SubagentHandback` and other implicit ones). Enters neither the weight,
 * nor the verdicts: there is nothing to trim, this is not our arsenal.
 */
function undeclaredOf(used, role, toolUsage) {
  const bases = new Set(role.decls.map(toolUsage.baseName));
  return [...used.entries()]
    .filter(([tool]) => !bases.has(tool))
    .map(([tool, calls]) => ({ tool, calls }))
    .sort((a, b) => b.calls - a.calls);
}

function declaredRow(head, role, ctx) {
  const used = ctx.byNodeTools.get(head.node) || new Map();
  const tools = toolRows(role, used, ctx);
  const undeclared = undeclaredOf(used, role, ctx.toolUsage);
  const counts = { live: 0, dead: 0, unknown: 0 };
  for (const t of tools) counts[t.verdict] += 1;
  return {
    ...head,
    inherits: false, nodeInLog: ctx.nodeInLog,
    calls: sumCalls(used),
    tools,
    toolCount: tools.length,
    weightTokens: tools.length * TOOL_TOKEN_COST,
    counts,
    deadWeight: counts.dead * TOOL_TOKEN_COST,
    undeclared,
  };
}

/**
 * A role without a `tools` field inherits the session's whole set. There is nothing to subtract, and passing this off as "zero tools"
 * is not allowed: there are, on the contrary, the most of them.
 */
function inheritingRow(head, ctx) {
  const used = ctx.byNodeTools.get(head.node) || new Map();
  return {
    ...head,
    inherits: true, nodeInLog: ctx.nodeInLog,
    calls: sumCalls(used),
    tools: [], toolCount: null, weightTokens: null,
    counts: { live: 0, dead: 0, unknown: 0 }, deadWeight: 0, undeclared: [],
  };
}

function nodeRow([name, role], ctx) {
  const fm = parseFrontmatter(fs.readFileSync(path.join(ctx.rolesDir, role.file), 'utf8'));
  const head = { node: name, file: role.file, model: fm.model || null, effort: fm.effort || null };
  // A node IS in the journal if the journal is alive at all AND at least one line for this node is opened in it.
  // Zero lines is not zero attempts.
  const nodeCtx = { ...ctx, nodeInLog: ctx.logUsable && ctx.byNodeTools.has(name) };
  return role.decls === null ? inheritingRow(head, nodeCtx) : declaredRow(head, role, nodeCtx);
}

function bortTotals(nodes) {
  const counted = nodes.filter((n) => !n.inherits);
  const total = (f) => counted.reduce((s, n) => s + f(n), 0);
  return {
    nodeCount: nodes.length,
    toolCount: total((n) => n.toolCount),
    weightTokens: total((n) => n.weightTokens),
    live: total((n) => n.counts.live),
    dead: total((n) => n.counts.dead),
    unknown: total((n) => n.counts.unknown),
    deadWeight: total((n) => n.deadWeight),
    nodesInLog: counted.filter((n) => n.nodeInLog).length,
  };
}

function logSummary(logData, logUsable, byNodeTools) {
  return {
    alive: logData.alive,
    usable: logUsable,
    rowCount: logData.rows.length,
    errorCount: logData.errors.length,
    // The nodes the journal knows anything about at all - including those without a role (`session`). They are needed
    // by the display to name the journal's coverage with a number, not a word.
    nodesSeen: [...byNodeTools.keys()].sort(),
  };
}

/** The adapter's engine name - the same as in `formaCatalog.engines[].engine`; no adapter - `null`. */
const tagOf = (a) => (a ? (a.engine || engines.UNKNOWN) : null);

function buildBort(projectRoot) {
  const floor = readFloor(projectRoot);
  const { servers, scanned: mcpScanned } = readMcpConfigs(projectRoot);
  // The tool journal and the role catalog are taken from ONE adapter - the first with `toolUsage`: one engine's parsing
  // does not read another's catalog (otherwise, with the first engine off, the role paths are foreign).
  const owner = engines.loadAdapters(projectRoot).find((a) => a.toolUsage && typeof a.rolesDir === 'string');
  const toolUsage = owner ? owner.toolUsage : null;
  const rolesDir = owner ? engines.resolveRel(projectRoot, owner.rolesDir) : null;

  if (!toolUsage || !rolesDir) {
    // There is nothing to build the node tier on - and this is said aloud (`source: null`), not silently empty.
    return { source: null, engine: null, log: null, nodes: [], totals: null, servers, mcpScanned, referenced: [], floor, toolTokenCost: TOOL_TOKEN_COST };
  }

  const declared = toolUsage.readDeclared(rolesDir);
  const logData = toolUsage.readLog(path.join(projectRoot, '.forma/dashboard', 'tool-usage.log'));
  const byNodeTools = callsByNode(logData.rows);
  const logUsable = logData.alive && logData.rows.length > 0;
  const ctx = { toolUsage, rolesDir, byNodeTools, logUsable };
  const nodes = [...declared.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'ru'))
    .map((entry) => nodeRow(entry, ctx));

  return {
    source: toolUsage.source,
    // The call journal's engine is the first adapter with `toolUsage`: by it the "Form" tab decides whose strip this is.
    engine: tagOf(engines.loadAdapters(projectRoot).find((a) => a.toolUsage)),
    log: logSummary(logData, logUsable, byNodeTools),
    nodes,
    totals: bortTotals(nodes),
    servers,
    mcpScanned,
    referenced: referencedServers(nodes, servers),
    floor,
    toolTokenCost: TOOL_TOKEN_COST,
  };
}

module.exports = { buildBort };
