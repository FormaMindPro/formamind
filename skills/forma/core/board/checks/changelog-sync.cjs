'use strict';

/**
 * changelog-sync - verifies that .forma/living/CHANGELOG.md is not lagging behind the protocol submodule version
 */

const fs = require('fs');
const path = require('path');

function run({ root }) {
  const clPath = path.join(root, '.forma', 'living', 'CHANGELOG.md');
  if (!fs.existsSync(clPath)) return [];
  const clText = fs.readFileSync(clPath, 'utf8');
  const mLiving = clText.match(/- \*\*(\d+\.\d+\.\d+)\*\*/);
  if (!mLiving) return [];

  const protoGit = path.join(root, '.forma', 'protocol', '.git');
  if (!fs.existsSync(protoGit)) return [];

  const protoPkg = path.join(root, '.forma', 'protocol', 'package.json');
  if (!fs.existsSync(protoPkg)) return [];
  try {
    const protoVer = JSON.parse(fs.readFileSync(protoPkg, 'utf8')).version;
    if (protoVer && mLiving[1] !== protoVer) {
      return [`living changelog (.forma/living/CHANGELOG.md: ${mLiving[1]}) lags behind protocol submodule version (${protoVer})`];
    }
  } catch {}

  return [];
}

module.exports = { id: 'changelog-sync', since: '0.0.35', run };
