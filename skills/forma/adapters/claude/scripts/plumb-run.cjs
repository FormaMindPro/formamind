#!/usr/bin/env node
'use strict';
// A wrapper without logic: the Plumb driver lives in .forma/plumb/plumb-run.cjs.
const path = require('path');
const { spawnSync } = require('child_process');
const driver = path.join(__dirname, '..', '..', '.forma', 'plumb', 'plumb-run.cjs');
const res = spawnSync(process.execPath, [driver, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(res.status ?? 0);
