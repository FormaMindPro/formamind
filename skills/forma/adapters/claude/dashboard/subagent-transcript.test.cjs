#!/usr/bin/env node
'use strict';
// The transcript directory is taken by engine tag, not from the first adapter.
const assert = require('assert');
const st = require('./subagent-transcript.cjs');
const root = require('path').resolve(__dirname, '..', '..');
const id = 'aa10026eb068cb82f';
(async () => {
  const dirs = st.transcriptDirs(root);
  assert.ok(Array.isArray(dirs));
  // A tag with no directory - null (the caller's unknown marker), not zero.
  assert.strictEqual(st.findTranscript(id, root, 'no-such-engine'), null);
  assert.strictEqual(await st.readSubagentTranscript(id, root, 'no-such-engine'), null);
  // A tag with a directory and a transcript - finds it; otherwise skip (a machine without that transcript).
  if (dirs.some((d) => d.tag === 'claude-code') && st.findTranscript(id, root, 'claude-code')) {
    const r = await st.readSubagentTranscript(id, root, 'claude-code');
    assert.ok(r && r.output > 0 && r.cacheRead > 0);
  }
  console.log('subagent-transcript.test: ok');
})().catch((e) => { console.error(e); process.exit(1); });
