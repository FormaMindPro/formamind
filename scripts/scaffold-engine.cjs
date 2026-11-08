#!/usr/bin/env node
'use strict';

/**
 * scaffold-engine.cjs - generates the minimal scaffold of a new engine's zone.
 * Creates the .<engine>/ directory with every mandatory component per ENGINE-CONTRACT.md:
 *  - forma-adapter.cjs
 *  - rules/<engine>-8.md (from the ENGINE-8-TEMPLATE.md template)
 *  - tests/test-<engine>-adapter.cjs
 *  - verify-profile.cjs
 *  - hooks/
 *
 * Usage:
 *   node .forma/extensions/scaffold-engine.cjs --name <name> [--dir <directory>]
 *
 * Printed labels come from the core dictionary: English key in code, ru value as data.
 */

const fs = require('fs');
const path = require('path');
const i18n = require('../skills/forma/core/i18n/index.cjs');
const msg = (code, params) => i18n.message(code, params, 'ru');

const args = process.argv.slice(2);
let name = null;
let dir = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--name') name = args[++i];
  else if (args[i] === '--dir') dir = args[++i];
}

if (!name) {
  console.error(msg('scaffold.usage'));
  process.exit(1);
}

const cleanName = name.toLowerCase().replace(/[^a-z0-9_-]/g, '');
const dirName = dir || `.${cleanName}`;
const root = process.cwd();
const targetDir = path.join(root, dirName);

if (fs.existsSync(targetDir)) {
  console.error(msg('scaffold.dir_exists', { dir: dirName }));
  process.exit(1);
}

console.log(msg('scaffold.creating', { name, dir: dirName }));

fs.mkdirSync(path.join(targetDir, 'rules'), { recursive: true });
fs.mkdirSync(path.join(targetDir, 'tests'), { recursive: true });
fs.mkdirSync(path.join(targetDir, 'hooks'), { recursive: true });
fs.mkdirSync(path.join(targetDir, 'roles'), { recursive: true });
fs.mkdirSync(path.join(targetDir, 'skills'), { recursive: true });
fs.mkdirSync(path.join(targetDir, '.ledger'), { recursive: true });
fs.writeFileSync(path.join(targetDir, '.ledger', 'calls.jsonl'), '', 'utf8');

// 1. forma-adapter.cjs
const adapterCode = `'use strict';

/**
 * Engine adapter of ${name} for the Forma core.
 * Discovered automatically by the presence of forma-adapter.cjs in the root dot folder.
 */

const path = require('path');

module.exports = {
  engine: '${cleanName}',
  engineRulesFile: '${dirName}/rules/${cleanName}-8.md',
  conformanceTest: '${dirName}/tests/test-${cleanName}-adapter.cjs',
  verifyProfile: '${dirName}/verify-profile.cjs',
};
`;
fs.writeFileSync(path.join(targetDir, 'forma-adapter.cjs'), adapterCode, 'utf8');

// 2. rules/<engine>-8.md
const tplPath = path.join(root, '.forma', 'templates', 'ENGINE-8-TEMPLATE.md');
let tplText = fs.existsSync(tplPath) ? fs.readFileSync(tplPath, 'utf8') : '@AGENTS.md\n\n# 8. Engine architecture\n';
tplText = tplText
  .replace(/\{\{ENGINE_NAME\}\}/g, name)
  .replace(/\{\{DIR\}\}/g, dirName)
  .replace(/\{\{MODEL_INTENT\}\}/g, 'standard')
  .replace(/\{\{MODEL_SPEC\}\}/g, 'standard')
  .replace(/\{\{MODEL_KIT\}\}/g, 'standard')
  .replace(/\{\{MODEL_RUN\}\}/g, 'standard')
  .replace(/\{\{MODEL_CORE\}\}/g, 'standard');

fs.writeFileSync(path.join(targetDir, 'rules', `${cleanName}-8.md`), tplText, 'utf8');

// 3. verify-profile.cjs
const verifyProfileCode = `'use strict';

/**
 * Installation verification profile for ${name}.
 */

const fs = require('fs');
const path = require('path');

function check(ctx) {
  const out = [];
  const { root, finding } = ctx;
  const eightFile = path.join(root, '${dirName}', 'rules', '${cleanName}-8.md');
  if (!fs.existsSync(eightFile)) {
    out.push(finding('${dirName}/rules/${cleanName}-8.md', 'section-8 file', 'file missing'));
  }
  return out;
}

module.exports = { id: '${cleanName}', check };
`;
fs.writeFileSync(path.join(targetDir, 'verify-profile.cjs'), verifyProfileCode, 'utf8');

// 4. tests/test-<engine>-adapter.cjs
const testCode = `#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const eightPath = path.join(root, '${dirName}', 'rules', '${cleanName}-8.md');

assert.ok(fs.existsSync(eightPath), '${cleanName}-8.md must exist');
const txt = fs.readFileSync(eightPath, 'utf8');
assert.match(txt, /^@AGENTS\\.md/m, 'must contain the @AGENTS.md import');

console.log('Adapter test of ${name} passed.');
`;
fs.writeFileSync(path.join(targetDir, 'tests', `test-${cleanName}-adapter.cjs`), testCode, 'utf8');

console.log(msg('scaffold.done', { name, dir: dirName }));
