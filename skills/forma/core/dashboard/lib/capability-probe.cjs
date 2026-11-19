#!/usr/bin/env node
// The capability probes of the engine zones: `<zone>/.state/capabilities.json`, one per adapter.
// A probe says what the zone's adapter declares and what that means for the isolation of the channels
// (production) circle: a zone promising channels is a zone declaring subagents and sendMessage.
//
//   const { writeProbes, readProbe, PROBE_REL } = require('.forma/dashboard/lib/capability-probe.cjs');
//   writeProbes(root)  -> [{ zone, file, isolation }]   (writes every loaded adapter's probe)
//   readProbe(root, '.agents') -> the parsed probe or null (missing and unreadable give null alike)
//   node .forma/dashboard/lib/capability-probe.cjs [--root <dir>]   (writes and prints the probes)
//
// The probe is written at install and at every engine switch (forma.cjs, engine-switch.cjs); the board's
// channels gate reads it fail-closed: a missing probe of a zone that promised channels closes the gate
// no less than a probe saying the isolation is unavailable.

const fs = require('fs');
const path = require('path');
const { loadAdapters } = require('./engines.cjs');

const PROBE_REL = path.join('.state', 'capabilities.json');

function promisedChannels(adapter) {
  const c = adapter && adapter.capabilities;
  return Boolean(c && typeof c === 'object' && c.subagents === true && c.sendMessage === true);
}

function probeOf(adapter, existing) {
  const c = adapter.capabilities && typeof adapter.capabilities === 'object' ? adapter.capabilities : {};
  const promised = promisedChannels(adapter);
  const prior = existing && existing.isolation && typeof existing.isolation === 'object' ? existing.isolation : {};
  return {
    ...existing,
    engine: adapter.id || adapter.engine || String(adapter.dir || '').replace(/^\./, ''),
    source: 'adapter',
    zone: adapter.dir || null,
    capabilities: {
      subagents: c.subagents === true,
      sendMessage: c.sendMessage === true,
      hooks: c.hooks === true,
      mcp: c.mcp === true,
    },
    isolation: {
      ...prior,
      promised,
      available: promised,
      mode: prior.mode || (promised ? 'full' : 'degraded'),
    },
    written: new Date().toISOString(),
  };
}

/** The probe of one zone directory (`.agents`, `.qoder`, ...) - or null when it is absent or unreadable. */
function readProbe(root, dir) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(root, dir, PROBE_REL), 'utf8'));
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

/** Writes the probe of every adapter zone of the project; returns the readings. */
function writeProbes(root = process.cwd()) {
  const out = [];
  for (const adapter of loadAdapters(root)) {
    if (!adapter.dir) continue;
    const file = path.join(root, adapter.dir, PROBE_REL);
    let existing = null;
    try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    const probe = probeOf(adapter, existing && typeof existing === 'object' ? existing : null);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(probe, null, 2) + '\n');
    out.push({ zone: adapter.dir, file, isolation: probe.isolation });
  }
  return out;
}

module.exports = { writeProbes, readProbe, promisedChannels, PROBE_REL };

if (require.main === module) {
  const at = process.argv.indexOf('--root');
  const root = at >= 0 ? path.resolve(process.argv[at + 1]) : process.cwd();
  const probes = writeProbes(root);
  if (!probes.length) {
    console.log('no adapter zones found under ' + root);
  } else {
    for (const p of probes) console.log(`${p.zone}: isolation ${p.isolation.available ? 'available' : 'not available'}${p.isolation.promised ? '' : ' (channels not promised)'}`);
  }
}
