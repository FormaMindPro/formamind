#!/usr/bin/env node
'use strict';

/**
 * external-exits — гейт «внешние выходы под скрабом» (запрет 17 конструктивно): реестр сетевых
 * выходов из семейства моделей и проверка, что каждый выход прикрыт. Обнаружение динамическое:
 * git grep по отслеживаемым скриптам (*.cjs *.js *.mjs *.sh) на сетевые паттерны
 * (https.request, https.get, fetch(, axios, curl ) — в теле прибора нет ни одного пути,
 * домена или кода конкретного проекта (запрет 16). Шаблон протокола (.forma/protocol) и
 * тестовые файлы не сканируются; веб-ассеты дашборда сканируются и классифицируются.
 *
 * Классификация каждого найденного файла — чтением его текста, по убыванию силы claims:
 *   через-скраб   — использует модуль скраба (plumb-scrub.cjs), есть проверка residue и
 *                   явный отказ (process.exit(2) / «scrub-refused») — отказ до сети здесь
 *                   подтверждает человек при приёмке, прибор ловит только маркеры;
 *   внутренний    — сетевые вызовы без единого внешнего хоста: только относительные пути
 *                   и localhost/127.0.0.1 (внутренний контур, скраб не нужен);
 *   без данных    — узкий доброкачественный паттерн: GET без тела запроса (нет -d/--data/
 *                   -F/-T/-X POST/stdin-подстановки), наружу не уходит материал проекта;
 *   КРАСНАЯ       — всё прочее: сетевой вызов не прикрыт.
 *
 *   node .forma/board/checks/external-exits.cjs               (полный прогон по дереву)
 *   node .forma/board/checks/external-exits.cjs --selftest    (приборы во временный каталог ОС)
 *
 * Обнаружение — git grep, то есть только отслеживаемые файлы: незакоммиченный скрипт в
 * реестр не попадёт. Такие файлы (вне исключений) печатаются отдельной info-строкой.
 *
 * Коды возврата: 0 — все выходы прикрыты (через-скраб / внутренний / без данных);
 * 1 — есть КРАСНАЯ или самотест не сошёлся; 2 — ошибка исполнения.
 * Модуль: require('./external-exits.cjs').runExternalExits({ root }) → { ready, lines }.
 * Часть ядра: следов проекта не несёт (запрет 16).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');

// Сетевые паттерны (ERE) — один источник истины для git grep и для повторной сверки текста.
const NET_RE_SOURCE = 'https\\.request|https\\.get|fetch\\(|axios|curl ';
const NET_RE = new RegExp(NET_RE_SOURCE);
// Внешний хост: абсолютный URL не на localhost/127.0.0.1.
const EXTERNAL_URL_RE = /https?:\/\/(?!localhost|127\.0\.0\.1|::1)/;
// Флаги тела/загрузки curl (POST-объём наружу = материал проекта).
const CURL_BODY_RE = /(^|\s)(-d\b|--data\b|--data-raw\b|--data-binary\b|--data-urlencode\b|-F\b|--form\b|--form-string\b|--form-file\b|-T\b|--upload-file\b)/;
// Явный не-GET метод curl.
const CURL_METHOD_RE = /(^|\s)(-X|--request)\s*(POST|PUT|PATCH|DELETE)\b/i;
// Тело из stdin/файла в строке curl.
const CURL_STDIN_RE = /\s<\s?\S/;

/** Список отслеживаемых скриптов с сетевыми паттернами, вне исключений. */
function discover(root) {
  let out = '';
  try {
    out = execFileSync('git', ['grep', '-l', '-E', NET_RE_SOURCE, '--', '*.cjs', '*.js', '*.mjs', '*.sh'], { cwd: root, encoding: 'utf8' });
  } catch (e) {
    if (e.status === 1) return []; // нет совпадений — реестр пуст
    throw e;
  }
  return out.split(/\r?\n/).filter(Boolean).filter((p) => !isExcluded(p));
}

function isExcluded(p) {
  const parts = p.split('/');
  if (parts[0] === '.forma' && parts[1] === 'protocol') return true; // шаблон протокола
  const base = parts[parts.length - 1];
  if (/\.(test|spec)\./.test(base)) return true; // тестовые файлы
  if (parts.slice(0, -1).some((s) => s === 'test' || s === 'tests')) return true;
  return false;
}

/** Незаконченные (не отслеживаемые) скрипты с сетевыми паттернами — вне реестра, но видны. */
function untrackedScripts(root) {
  let out = '';
  try {
    out = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  } catch {
    return [];
  }
  return out.split(/\r?\n/).filter(Boolean)
    .filter((l) => l.startsWith('?? '))
    .map((l) => l.slice(3).trim())
    .filter((p) => /\.(cjs|mjs|js|sh)$/.test(p) && !isExcluded(p) && fs.existsSync(path.join(root, p)));
}

/** Код без строк-комментариев (JS // /* * и shell #) — для проверки внешних хостов. */
function codeText(text) {
  return text.split(/\r?\n/)
    .filter((l) => { const t = l.trim(); return t && !t.startsWith('//') && !t.startsWith('#') && !t.startsWith('/*') && !t.startsWith('*'); })
    .join('\n');
}

function classify(text) {
  if (!NET_RE.test(text)) return { status: 'none' };
  // 1. через-скраб: модуль скраба + проверка остатка + явный отказ (exit(2)/«scrub-refused»).
  if (/plumb-scrub\.cjs/.test(text) && /residue\s*\(/.test(text) && (/scrub-refused/.test(text) || /process\.exit\(2\)/.test(text))) {
    const where = text.split(/\r?\n/).map((l, i) => (/\bresidue\s*\(/.test(l) ? i + 1 : null)).filter(Boolean);
    return { status: 'scrub', where };
  }
  // 2. внутренний: ни одного абсолютного внешнего хоста в коде (только localhost/относительные).
  if (!EXTERNAL_URL_RE.test(codeText(text))) return { status: 'internal' };
  // 3. без данных проекта: каждый curl — GET без тела/загрузки/незаголовочного stdin.
  const curlLines = text.split(/\r?\n/).filter((l) => /\bcurl\s/.test(l));
  if (curlLines.length && curlLines.every((l) => !CURL_BODY_RE.test(l) && !CURL_METHOD_RE.test(l) && !CURL_STDIN_RE.test(l))) {
    return { status: 'benign' };
  }
  return { status: 'red' };
}

const STATUS_WORD = { scrub: 'через-скраб', internal: 'внутренний', benign: 'без данных проекта', red: 'НЕ ПРИКРЫТ' };

function scan(root, files) {
  return files.map((rel) => {
    let text = '';
    try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return { rel, status: 'red', fact: `${rel}: файл не читается` }; }
    const c = classify(text);
    if (c.status === 'none') return null;
    let fact;
    if (c.status === 'scrub') fact = `${rel} — ${STATUS_WORD.scrub} — скраб plumb-scrub.cjs, проверка остатка на строках ${c.where.join(', ')}`;
    else if (c.status === 'internal') fact = `${rel} — ${STATUS_WORD.internal} — сетевые вызовы только на localhost/относительные пути`;
    else if (c.status === 'benign') fact = `${rel} — ${STATUS_WORD.benign} — GET без тела запроса, наружу материал не уходит`;
    else fact = `${rel} — ${STATUS_WORD.red} — сетевой вызов без скраба: добавь скраб fail-closed до сети, ограничь внутренним контуром или объяви дисциплину в §8`;
    return { rel, status: c.status, fact };
  }).filter(Boolean);
}

function runExternalExits({ root } = {}) {
  root = root || ROOT;
  const found = discover(root);
  const rows = scan(root, found);
  const red = rows.filter((r) => r.status === 'red');
  const lines = rows.map((r) => ({ status: r.status === 'red' ? 'red' : 'green', fact: r.fact }));
  const stray = untrackedScripts(root);
  if (stray.length) lines.push({ status: 'info', fact: `вне реестра (не отслеживаются git): ${stray.join(', ')}` });
  if (!rows.length) lines.push({ status: 'info', fact: 'сетевых выходов не найдено — реестр пуст' });
  const counts = rows.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
  const summary = `ВНЕШНИЕ ВЫХОДЫ: найдено ${rows.length} · через-скраб ${counts.scrub || 0} · внутренний ${counts.internal || 0} · без данных ${counts.benign || 0} · КРАСНЫХ ${red.length}`;
  return { ready: red.length === 0, lines, summary };
}

function selftest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'external-exits-'));
  try {
    const fixtures = [
      { name: 'good-scrub.cjs', expect: 'scrub', code: "const { loadSecrets, scrub, residue } = require('./plumb-scrub.cjs');\nconst t = scrub(prompt, secrets, hosts);\nif (residue(t, secrets).length) process.exit(2);\nawait fetch('https://api.example.test/v1', { method: 'POST', body: t });\n" },
      { name: 'bare-fetch.cjs', expect: 'red', code: "const r = await fetch('https://api.example.test/v1', { method: 'POST', body: draft });\n" },
      { name: 'local-only.js', expect: 'internal', code: "const r = await fetch('http://127.0.0.1:3000/data.json');\nconst s = await fetch('./next.json');\n" },
      { name: 'benign-get.sh', expect: 'benign', code: "#!/bin/sh\nVER=$(curl -fsSL --max-time 5 \"https://example.test/pub/plugin.json\" 2>/dev/null | version_of)\n" },
      { name: 'body-curl.sh', expect: 'red', code: "#!/bin/sh\ncurl -fsSL -d @draft.txt \"https://example.test/publish\"\n" },
    ];
    for (const f of fixtures) fs.writeFileSync(path.join(dir, f.name), f.code);
    const rows = scan(dir, fixtures.map((f) => f.name));
    const mismatches = fixtures.filter((f) => {
      const r = rows.find((x) => x.rel === f.name);
      return !r || r.status !== f.expect;
    });
    const got = (n) => { const r = rows.find((x) => x.rel === n); return r ? r.status : 'нет'; };
    if (mismatches.length) {
      return { ok: false, note: `приборы не сошлись: ${mismatches.map((f) => `${f.name} ожидался ${f.expect}, получен ${got(f.name)}`).join('; ')}` };
    }
    return { ok: true, note: `самотест: все ${fixtures.length} приборов классифицированы верно (${fixtures.map((f) => f.expect).join(', ')})` };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

if (require.main === module) {
  try {
    const argv = process.argv.slice(2);
    if (argv.includes('--selftest')) {
      const st = selftest();
      console.log((st.ok ? '✓ ' : '✗ ') + st.note);
      process.exit(st.ok ? 0 : 1);
    }
    const r = runExternalExits();
    for (const l of r.lines) console.log((l.status === 'green' ? '✓ ' : l.status === 'red' ? '✗ ' : '· ') + l.fact);
    console.log(r.summary);
    console.log(r.ready ? 'ГОТОВ: все сетевые выходы прикрыты (скраб fail-closed / внутренний контур / GET без данных)' : 'ГОТОВОСТИ НЕТ: есть неприкрытый внешний выход — доведи до скраба или исключи');
    process.exit(r.ready ? 0 : 1);
  } catch (e) {
    console.error('СТОП: ' + e.message);
    process.exit(2);
  }
}

module.exports = { discover, classify, scan, runExternalExits, selftest };
