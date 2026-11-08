'use strict';

// Метка маршрута связывает исполнителя (AGENTS.md §2, §6). Маршруты, где работу делает `Run` (route-2, 5, 6, 7):
// карточка, дошедшая до проверки или принятая (`review`, `done`), несёт в истории хотя бы один заход `Run`.
// Иначе метка лжёт: работу вёл и принимал `Intent` (запрет 1). Исполнять самому — сменить метку с причиной в истории.
//
// Путь exception (соглашение §6 card-and-board, fail-closed): красный снимает только полная строка
// `exception: <что> — <почему> — <кто одобрил>` в зоне History этой же карточки — называющая этот гейт
// (id чека `route-executor`) и одобрившего (язык одобрения: одобр*/утверд*/согласов*, approved/approval/accepted).
// Имени гейта нет, имени одобрившего нет, строка вне History или строки вовсе нет — красный остаётся.
// Самопроба: node .forma/board/checks/route-executor.cjs --selftest (приборы во временном каталоге ОС);
// через сверки — sync-engines.cjs --selftest и check-board.cjs.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { cardFiles, createdDay, zone } = require('../../dashboard/lib/card.cjs');

const RUN_ROUTES = ['route-2', 'route-5', 'route-6', 'route-7'];
const i18n = require('../../i18n/index.cjs');
const RUN_ATTEMPT = new RegExp('^-\\s*`Run`,\\s*\\d{4}-\\d{2}-\\d{2}:\\s*(' + i18n.alt('hist.attempt') + ')', 'm');

const GATE_ID = 'route-executor';
const APPROVER_RE = /одобр|утверд|согласов|approved|approval|accepted/i;

/** Полная exception-строка в History этой карточки: называет этот гейт и одобрившего. Неполная — не считается. */
function hasFullException(text) {
  const history = zone(text, 'history');
  if (!history) return false;
  for (const line of history.split(/\r?\n/)) {
    const i = line.toLowerCase().indexOf('exception:');
    if (i < 0) continue;
    const body = line.slice(i);
    if (new RegExp('\\b' + GATE_ID + '\\b', 'i').test(body) && APPROVER_RE.test(body)) return true;
  }
  return false;
}

function cardProblem(f, text) {
  const status = (text.match(/^status:\s*"?([\w-]+)/m) || [])[1];
  if (status !== 'review' && status !== 'done') return null;
  const labels = (text.match(/^labels:\s*\[(.*)\]/m) || [])[1] || '';
  const route = RUN_ROUTES.find((r) => new RegExp('"' + r + '"').test(labels));
  if (!route || RUN_ATTEMPT.test(text)) return null;
  if (hasFullException(text)) return null;
  return `${f}: маршрут ${route} ведёт через \`Run\`, а в истории нет ни одного его захода — работу вёл другой узел; исполнять самому — сменить метку маршрута с причиной в истории`;
}

function run({ root, since }) {
  const problems = [];
  for (const file of cardFiles(root, /^card-\d+.*\.md$/)) {
    const text = fs.readFileSync(file, 'utf8');
    if (createdDay(text) < since) continue;
    const p = cardProblem(path.basename(file), text);
    if (p) problems.push(p);
  }
  return problems;
}

// ---- --selftest: приборы во временном каталоге ОС ------------------------------------------------

function writeTree(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
}

/** Фиктивная карточка: route-7, статус done, без захода `Run`; строки в History или (при передаче) в Result. */
function fixtureCard(num, historyLines, resultLines, today) {
  return [
    '---',
    'id: "card-' + num + '-sample-route-executor"',
    'status: "done"',
    'priority: "medium"',
    'assignee: "Intent"',
    'epic: "3. Протокол проекта"',
    'labels: ["goal-sample", "route-7"]',
    'created: "' + today + 'T00:00:00.000Z"',
    '---',
    '# проба маршрута ' + num,
    '',
    '## Task',
    'проба · самопроба правила исполнителя маршрута',
    '',
    '## Kit',
    '',
    '## History',
    ...historyLines,
    '',
    '## Result',
    ...resultLines,
    '',
  ].join('\n');
}

function selftest() {
  const base = process.env.FORMA_TEST_TMP && fs.existsSync(process.env.FORMA_TEST_TMP) ? process.env.FORMA_TEST_TMP : os.tmpdir();
  const today = new Date().toISOString().slice(0, 10);
  const results = [];
  const check = (name, cond) => results.push({ ok: !!cond, name });
  // Имена фикстур — динамически (запрет 16): литерал card-NNN в исходнике чистой зоны ловит проверка следа.
  const num = (k) => 900 + k;
  const name = (k, slug) => 'card-' + num(k) + '-' + slug + '.md';
  /** Проба: свежая фиктивная доска во временном каталоге, прогон на ней, очистка. */
  const probe = (files) => {
    const dir = fs.mkdtempSync(path.join(base, 'route-executor-'));
    try {
      writeTree(dir, files);
      return run({ root: dir, since: '' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  const card = (k, slug, historyLines, resultLines = []) => ({ [`.devtool/features/${name(k, slug)}`]: fixtureCard(num(k), historyLines, resultLines, today) });
  const exc = (body) => '- `Intent`, ' + today + ': exception: ' + body;
  try {
    // г) без exception вовсе — КРАСНАЯ: базовое правило живо
    const r1 = probe(card(1, 'no-exception', ['- `Intent`, ' + today + ': stage close — закрыто без захода `Run`.']));
    check('route-7 без захода Run и без exception = КРАСНАЯ', r1.length === 1 && r1[0].includes(name(1, 'no-exception')));
    // а) полная exception-строка — ЗЕЛЁНАЯ (в done/, чтобы покрыть и закрытые)
    const r2 = probe({ ['.devtool/features/done/' + name(2, 'full-exception')]: fixtureCard(num(2), [exc('route-executor — маршрут закрыт без захода `Run` по решению человека — одобрил человек в сеансе')], [], today) });
    check('полная exception-строка (гейт + одобривший) в done/ = ЗЕЛЁНАЯ', r2.length === 0);
    // б) exception без имени гейта — КРАСНАЯ (fail-closed)
    const r3 = probe(card(3, 'no-gate', [exc('маршрут закрыт без захода `Run` по решению человека — одобрил человек в сеансе')]));
    check('exception без имени гейта = КРАСНАЯ', r3.length === 1 && r3[0].includes(name(3, 'no-gate')));
    // в) exception без одобрившего — КРАСНАЯ (fail-closed)
    const r4 = probe(card(4, 'no-approver', [exc('route-executor — маршрут закрыт без захода `Run`, причина в истории')]));
    check('exception без одобрившего = КРАСНАЯ', r4.length === 1 && r4[0].includes(name(4, 'no-approver')));
    // чужой гейт назван — КРАСНАЯ: имя другого чека этот гейт не снимает
    const r5 = probe(card(5, 'other-gate', [exc('route-labels — маршрут закрыт без захода `Run` — одобрил человек в сеансе')]));
    check('exception с именем чужого гейта = КРАСНАЯ', r5.length === 1 && r5[0].includes(name(5, 'other-gate')));
    // exception вне History (в Result) — КРАСНАЯ: зона обязательна
    const r6 = probe(card(6, 'wrong-zone', ['- `Intent`, ' + today + ': stage close — закрыто.'], [exc('route-executor — маршрут закрыт без захода `Run` — одобрил человек в сеансе')]));
    check('exception вне зоны History = КРАСНАЯ', r6.length === 1 && r6[0].includes(name(6, 'wrong-zone')));
    // заход `Run` есть — ЗЕЛЁНАЯ без всякого exception: базовое правило не тронуто
    const r7 = probe(card(7, 'with-run', ['- `Run`, ' + today + ': attempt — исполнено по маршруту.']));
    check('заход `Run` в истории = ЗЕЛЁНАЯ без exception', r7.length === 0);
    const failed = results.filter((r) => !r.ok);
    return {
      ok: failed.length === 0,
      note: failed.length
        ? 'не сошлось: ' + failed.map((r) => r.name).join('; ')
        : 'все пробы зелёные: без exception КРАСНАЯ, полная exception-строка (гейт + одобривший, в том числе в done/) ЗЕЛЁНАЯ, без гейта / без одобрившего / чужой гейт / вне History — КРАСНАЯ, заход `Run` — ЗЕЛЁНАЯ',
    };
  } catch (e) {
    results.push({ ok: false, name: 'самопроба упала: ' + String((e && e.message) || e) });
    return { ok: false, note: results.filter((r) => !r.ok).map((r) => r.name).join('; ') };
  }
}

module.exports = { id: 'route-executor', since: 'route-executor', run, selftest };

if (require.main === module) {
  if (process.argv.slice(2).includes('--selftest')) {
    const st = selftest();
    console.log((st.ok ? '\u2713 ' : '\u2717 ') + 'route-executor: ' + st.note);
    process.exit(st.ok ? 0 : 1);
  }
  console.log('route-executor — проверка реестра доски: гонится check-board.cjs и sync-engines.cjs --check; самопроба: node .forma/board/checks/route-executor.cjs --selftest');
  process.exit(0);
}
