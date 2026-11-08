'use strict';
// node .claude/scripts/plumb-scrub.test.cjs — fixtures are made up; no real secret is used.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const script = path.join(__dirname, 'plumb-scrub.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plumb-'));
const SECRET_ENV = 'zq9Xw3LpT7vRm2KdB8nYc5HfJ';
const SECRET_PASS = 'Hunter-Test-Pass-77';
const SITE = 'testsite.example';
const EMAIL = ['someone.fake', 'mailbox.example'].join('@');
const DATE = ['2031', '10', '11'].join('-');
const CARD = ['card', '102'].join('-');

fs.writeFileSync(path.join(root, '.env'), `API_TOKEN=${SECRET_ENV}\nSITE_URL=https://${SITE}/wp\nFLAG=true\n`);
fs.mkdirSync(path.join(root, 'VARS'));
fs.writeFileSync(path.join(root, 'VARS', 'credentials.md'), `# creds\n- test_password: ${SECRET_PASS}\n| name | value |\n|---|---|\n| test_login | fakelogin_42 |\n`);

const card = path.join(root, 'card.md');
const write = task => fs.writeFileSync(card, `# t\n\n## \u0417\u0430\u0434\u0430\u0447\u0430\n${task}\n\n## \u0418\u0441\u0442\u043e\u0440\u0438\u044f\n- secret history line ${SECRET_ENV}\n\n## \u0420\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442\n`); // the ru zone headings are the card format (data)
const run = () => spawnSync('node', [script, card, '--root', root], { encoding: 'utf8' });

// 1. secrets, e-mail, domain, phone, ip, path are gone; history is not sent
write(`\u0412\u043e\u0439\u0442\u0438 \u043a\u0430\u043a fakelogin_42 \u0441 \u043f\u0430\u0440\u043e\u043b\u0435\u043c ${SECRET_PASS}, \u0442\u043e\u043a\u0435\u043d ${SECRET_ENV}, \u043d\u0430\u043f\u0438\u0441\u0430\u0442\u044c ${EMAIL}, ` +
  `\u0441\u0430\u0439\u0442 https://${SITE}/page \u0438 ${SITE}, \u0442\u0435\u043b +7 912 345-67-89, ip 10.0.0.12, \u0444\u0430\u0439\u043b C:\\Users\\Someone\\a.png, \u0434\u0430\u0442\u0430 ${DATE}.`);
let r = run();
assert.strictEqual(r.status, 0, r.stdout + r.stderr);
for (const bad of [SECRET_ENV, SECRET_PASS, 'fakelogin_42', EMAIL, SITE, '912 345', '10.0.0.12', 'Someone', 'secret history line']) {
  assert.ok(!r.stdout.includes(bad), `leaked: ${bad}`);
}
const out = JSON.parse(r.stdout);
assert.ok(out.task.includes('[[credentials.test_password]]') && out.task.includes('[[API_TOKEN]]') && out.task.includes('[site]'));
assert.ok(out.task.includes(DATE), 'dates must survive');
assert.ok(!r.stdout.includes('history'), 'only the Task zone is sent');

// 2. residue refuses (secret-like string that nothing replaced)
write('\u0418\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u044c \u043a\u043b\u044e\u0447 aB3dE5fG7hJ9kL2mN4pQ6rS8tU0 \u0434\u043b\u044f \u0432\u044b\u0437\u043e\u0432\u0430.');
r = run();
assert.strictEqual(r.status, 2, 'residue must refuse');
assert.strictEqual(JSON.parse(r.stdout).task, null);

// 3. card without a Task zone refuses
fs.writeFileSync(card, '# t\n\n## \u0418\u0441\u0442\u043e\u0440\u0438\u044f\n- x\n');
assert.strictEqual(run().status, 2);

// 4. clean task passes untouched
write(`\u041f\u0435\u0440\u0435\u0432\u0435\u0441\u0442\u0438 \u043f\u043e\u0434\u043f\u0438\u0441\u044c \u043d\u0430 \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0438 v2/page-4 \u0438 \u0437\u0430\u043f\u0438\u0441\u0430\u0442\u044c \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442 \u0432 project/cards/${CARD}/out.`);
r = run();
assert.strictEqual(r.status, 0);
assert.ok(JSON.parse(r.stdout).task.includes(CARD));

fs.rmSync(root, { recursive: true, force: true });
console.log('plumb-scrub: all tests passed');
