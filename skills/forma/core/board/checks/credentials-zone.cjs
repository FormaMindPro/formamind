#!/usr/bin/env node
'use strict';

/**
 * credentials-zone — гейт «зона реквизитов» (запрет 15, fail-closed): ЗНАЧЕНИЯ реквизитов
 * (API-ключи, токены, пароли, PEM-ключи) живут только в двух разрешённых местах — `.env`
 * в корне проекта и `project/VARS/credentials.md`; значение реквизита в любом другом файле —
 * находка. Ссылки по имени (`VARIABLE_NAME` для .env, `[[name]]` для VARS/) значениями не
 * считаются и не ловятся. Без модельных вызовов: статус по коду возврата, досье — в stdout;
 * потребители — гейты карточек (check-ready), хук движка на запись файла (Claude: PostToolUse
 * Write|Edit) и вызовы из хуков других движков по мере появления у них событий записи.
 *
 *   node .forma/board/checks/credentials-zone.cjs --selftest
 *   node .forma/board/checks/credentials-zone.cjs --repo [--root <каталог>]
 *   node .forma/board/checks/credentials-zone.cjs --file <путь> [--root <каталог>]
 *   node .forma/board/checks/credentials-zone.cjs --wired [--root <каталог>]
 *
 * Режимы:
 *   --selftest  приборы во временном каталоге ОС: приманки-реквизиты вне разрешённых мест
 *               ловятся, сами разрешённые места и файл ссылок по имени — чисты.
 *   --repo      скан отслеживаемых файлов (git ls-files). Исключения: node_modules,
 *               .forma/protocol (его пробники несут приманки намеренно) и разрешённые места.
 *   --file      один файл — для вызова из хуков; разрешённые места пропускаются целиком.
 *   --wired     по каждому движку проекта (.forma/dashboard/lib/engines.cjs: loadAdapters)
 *               доказывает одно из двух («конструктивно либо дисциплина», ENGINE-CONTRACT.md):
 *               зарегистрированный вызов сканера из хука движка (по реестру hooks адаптера,
 *               включая вызовы через скрипт-обёртку) либо строка дисциплины с именем сканера
 *               в его файле правил §8.
 *
 * Коды возврата: 0 — зелёный; 1 — находки, неприкрытый движок или несошедшаяся проба
 * selftest; 2 — ошибка исполнения (нет файла, нет git, неверный вызов).
 * Модуль: require('./credentials-zone.cjs').scanText(text) → находки; .scanFile(abs, root);
 * .runRepo(root); .runWired(root); .selftest().
 * Часть ядра: следов проекта не несёт (запрет 16); разрешённые места — конвенция запрета 15,
 * словарь — универсальные семейства реквизитов. Значения в досье маскируются: находка называет
 * файл, строку и семейство, но не печатает сам реквизит.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT_DEFAULT = process.cwd();
const MAX_BYTES = 16 * 1024 * 1024; // крупнее — пропуск с счётчиком, не скан
const SCAN_FLOOR = 14;              // короче для присвоений — не реквизит

// --- Разрешённые места (запрет 15): значения реквизитов живут только здесь ---------------------
// Оба написания пути конвенции разрешены: реестр закона называет VARS/credentials.md,
// раскладка проекта кладёт его в project/VARS/. Прочие .env (.env.local и подкаталоги) — НЕ разрешены.

function isAllowedPlace(rel) {
  if (rel === '.env') return true;
  if (rel === 'VARS/credentials.md' || rel === 'project/VARS/credentials.md') return true;
  return false;
}

// --- Словарь признаков: ЗНАЧЕНИЯ, не имена-ссылки ----------------------------------------------
// Семейства ключей с известными префиксами. Корпус после префикса обязан выглядеть случайно:
// смешанные регистр и цифры — транслит-слова («poisk-…»), словарные цепочки из строчных букв
// и плейсхолдеры вида sk-your-key-here не ловятся.
const KEY_FAMILIES = [
  { name: 'ключ вида sk-…', re: /\bsk-[A-Za-z0-9_-]{28,}/g, body: 'sk-' },
  { name: 'ключ вида ghp_…', re: /\bghp_[A-Za-z0-9]{36,}\b/g },
  { name: 'ключ вида gh[pousr]_…', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { name: 'ключ вида github_pat_…', re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g },
  { name: 'ключ вида AKIA…', re: /\bAKIA[0-9A-Z]{16}\b/g, check: null }, // форма задана самим выражением
  { name: 'ключ вида xox…-', re: /\bxox[baprs]-[A-Za-z0-9-]{15,}\b/g },
  { name: 'ключ вида glpat-…', re: /\bglpat-[A-Za-z0-9_-]{16,}\b/g },
  { name: 'ключ вида AIza…', re: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { name: 'ключ вида gsk_…', re: /\bgsk_[A-Za-z0-9]{30,}\b/g },
  { name: 'ключ вида hf_…', re: /\bhf_[A-Za-z0-9]{30,}\b/g },
  { name: 'ключ вида npm_…', re: /\bnpm_[A-Za-z0-9]{30,}\b/g },
  { name: 'ключ вида pypi-…', re: /\bpypi-[A-Za-z0-9_-]{60,}\b/g },
  { name: 'токен вида eyJ…', re: /\beyJ[A-Za-z0-9_-]{40,}\b/g },
];

const PEM_RE = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/g;

// Присвоения секретов с высокоэнтропийным значением в кавычках (пароли, токены, ключи без префикса).
const SECRET_ASSIGN_RE =
  /([A-Za-z0-9_.$/-]*(?:password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?key|auth[_-]?token|token|private[_-]?key|client[_-]?secret|credential)[A-Za-z0-9_.$/-]*)\s*[:=]\s*(["'`])([^"'\n]{14,})\2/gi;

// Bearer-заголовки и реквизит внутри URL (https://user:pass@host).
const BEARER_RE = /\bBearer\s+([A-Za-z0-9._+/=-]{20,})/g;
const URL_CREDS_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@"]+:[^\s@/"]{6,}@[^\s"']+/g;

// Ключ присвоения, по сути не секрет: ссылка-на-место, подпись, метаданные.
const ASSIGN_KEY_NOT_SECRET = /(?:url|uri|hint|label|policy|question|prompt|placeholder|example|mask|format|length|count|budget|per[_-]?minute|per[_-]?hour|type|kind|name)$/i;

// Значение-заглушка или ссылка по имени: VARIABLE_NAME, [[name]], ${VAR}, <ваш-ключ>, changeme.
const VALUE_IS_REFERENCE =
  /^\$\{[^}]*\}$|^\[\[.*\]\]$|^<[^>]*>$|^[A-Z][A-Z0-9_]*$|^(?:x|\*|\.|#|-|_)+$|process\.env|os\.environ|getenv|changeme|placeholder|your[-_]|insert[-_ ]|example[-_]|dummy|todo|fixme|n\/a|none|null|undefined|teste?[-_]|sk-your/i;

// --- Помощники ----------------------------------------------------------------------------------

/** Энтропия Шеннона, бит на знак: случайный реквизит — заметно выше словарного текста. */
function bitsPerChar(s) {
  const freq = new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) || 0) + 1);
  let bits = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

function charClasses(s) {
  return [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(s)).length;
}

/** Корпус после префикса выглядит случайно: есть и цифры, и оба регистра. */
function bodyLooksRandom(body) {
  return /[0-9]/.test(body) && /[A-Z]/.test(body) && /[a-z]/.test(body);
}

/** Значение присвоения не реквизит: ссылка по имени, заглушка, слишком словарное, URL без userinfo. */
function valueIsNotSecret(value) {
  if (VALUE_IS_REFERENCE.test(value)) return true;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !URL_CREDS_RE.test(value)) return true;
  if (bitsPerChar(value) < 3.2) return true;
  if (charClasses(value) < 3) return true;
  return false;
}

/** Реквизит в досье не печатается: маска с длиной. */
function maskValue(s) {
  return s.length <= 8 ? '***' : s.slice(0, 6) + '…(' + s.length + ' зн.)';
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/**
 * Скан текста: список находок [{ line, family, value (маска) }]. Ловит только значения;
 * ссылки по имени ([[name]], VARIABLE_NAME, ${VAR}, process.env.X) не ловит.
 */
function scanText(text) {
  const out = [];
  const seen = new Set();
  const push = (index, family, value) => {
    const key = index + '|' + family;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ line: lineOf(text, index), family, value: maskValue(value) });
  };
  for (const fam of KEY_FAMILIES) {
    fam.re.lastIndex = 0;
    let m;
    while ((m = fam.re.exec(text)) !== null) {
      const matched = m[0];
      if (fam.check !== null) {
        const body = fam.body ? matched.slice(fam.body.length) : matched.replace(/^[^A-Za-z0-9]+/, '');
        if (!bodyLooksRandom(body)) continue; // словарное слово или транслит, не случайный корпус
      }
      push(m.index, fam.name, matched);
    }
  }
  PEM_RE.lastIndex = 0;
  let m;
  while ((m = PEM_RE.exec(text)) !== null) push(m.index, 'PEM-заголовок приватного ключа', m[0]);
  SECRET_ASSIGN_RE.lastIndex = 0;
  while ((m = SECRET_ASSIGN_RE.exec(text)) !== null) {
    const key = m[1];
    const value = m[3];
    if (ASSIGN_KEY_NOT_SECRET.test(key)) continue; // url/hint/label и метаданные — не секрет
    if (valueIsNotSecret(value)) continue;
    push(m.index, 'присвоение секрета («' + key.trim() + '»)', value);
  }
  BEARER_RE.lastIndex = 0;
  while ((m = BEARER_RE.exec(text)) !== null) {
    if (valueIsNotSecret(m[1])) continue;
    push(m.index, 'Bearer-токен', m[1]);
  }
  URL_CREDS_RE.lastIndex = 0;
  while ((m = URL_CREDS_RE.exec(text)) !== null) push(m.index, 'реквизит внутри URL', m[0]);
  return out.sort((a, b) => a.line - b.line || a.family.localeCompare(b.family));
}

/** Скан одного файла: разрешённые места пропускаются целиком; бинарное и крупное — пропуск с пометкой. */
function scanFile(abs, root) {
  const rel = path.relative(root || path.dirname(abs), abs).split(path.sep).join('/');
  if (isAllowedPlace(rel)) return { findings: [], note: 'разрешённое место (' + rel + ')' };
  let buf;
  try {
    const st = fs.statSync(abs);
    if (st.size > MAX_BYTES) return { findings: [], note: 'пропущен: крупнее ' + MAX_BYTES + ' байт' };
    buf = fs.readFileSync(abs);
  } catch (e) {
    const err = new Error('файл не прочитан: ' + rel + ' — ' + e.message);
    err.exitCode = 2;
    err.code = e.code || 'EREAD';
    throw err;
  }
  if (buf.slice(0, 8192).includes(0)) return { findings: [], note: 'пропущен: бинарный' };
  const text = buf.toString('utf8');
  return { findings: scanText(text).map((f) => ({ ...f, file: rel })), note: null };
}

/** Режим --repo: скан отслеживаемых файлов; возвращает { findings, checked, notes }. */
function runRepo(root) {
  let out;
  try {
    out = require('child_process').execFileSync('git', ['-C', root, 'ls-files', '-z'], { maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    const err = new Error('git ls-files не выполнен: ' + e.message);
    err.exitCode = 2;
    throw err;
  }
  const files = out.toString('utf8').split('\0').filter(Boolean);
  const findings = [];
  const notes = [];
  let checked = 0;
  for (const rel of files) {
    if (rel.startsWith('node_modules/') || rel === 'node_modules') continue;
    if (rel.startsWith('.forma/protocol/') || rel === '.forma/protocol') continue;
    if (rel.startsWith('.git/')) continue;
    let r;
    try {
      r = scanFile(path.join(root, ...rel.split('/')), root);
    } catch (e) {
      // в индексе есть, на диске нет (удалён в рабочем дереве) или не читается — пометка, не падение
      notes.push(rel + ': не прочитан (' + (e.code || e.message.split('\n')[0]) + ')');
      continue;
    }
    if (r.note) notes.push(rel + ': ' + r.note);
    else checked++;
    findings.push(...r.findings);
  }
  return { findings, checked, notes };
}

// --- Режим --wired: конструктивно либо дисциплина, по движкам -----------------------------------

const SCANNER_MARK = 'credentials-zone';
const SCANNER_FILE = 'credentials-zone.cjs';

/** Рекурсивно собирает строки из JSON-конфига хуков. */
function collectStrings(v, acc) {
  if (typeof v === 'string') acc.push(v);
  else if (Array.isArray(v)) v.forEach((x) => collectStrings(x, acc));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => collectStrings(x, acc));
  return acc;
}

/**
 * Хук-доказательство по реестру hooks адаптера (engineSettings): зарегистрированная команда
 * называет сканер напрямую либо вызывает скрипт-обёртку, который его вызывает.
 */
function hookWired(adapter, root) {
  let hooks = [];
  if (typeof adapter.engineSettings === 'function') {
    try {
      const s = adapter.engineSettings(root) || {};
      hooks = Array.isArray(s.hooks) ? s.hooks : [];
    } catch { hooks = []; }
  }
  const checkedWrappers = [];
  for (const h of hooks) {
    const commands = Array.isArray(h && h.commands) ? h.commands : [];
    for (const cmd of commands) {
      if (String(cmd).includes(SCANNER_MARK)) return { wired: true, via: String(cmd) };
      const tokens = String(cmd).match(/[\w./\\-]+\.(?:sh|cjs|js|mjs)/g) || [];
      for (const t of tokens) {
        const cands = [path.join(root, ...t.split(/[\\/]/)), path.join(root, adapter.dir, ...t.split(/[\\/]/))];
        for (const c of cands) {
          let text;
          try { text = fs.readFileSync(c, 'utf8'); } catch { continue; }
          checkedWrappers.push(path.relative(root, c));
          if (text.includes(SCANNER_MARK)) return { wired: true, via: path.relative(root, c) };
        }
      }
    }
  }
  return { wired: false, wrappers: checkedWrappers };
}

/** Дисциплина-доказательство: §8 движка называет сканер (строка дисциплины, ENGINE-CONTRACT.md). */
function disciplineWired(adapter, root) {
  if (!adapter.engineRulesFile) return false;
  const abs = path.join(root, ...adapter.engineRulesFile.split('/'));
  try { return fs.readFileSync(abs, 'utf8').includes(SCANNER_FILE); } catch { return false; }
}

/** Режим --wired: по каждому движку — хук либо строка дисциплины. Возвращает { rows, ready }. */
function runWired(root) {
  const { loadAdapters } = require('../../dashboard/lib/engines.cjs');
  const adapters = loadAdapters(root);
  if (!adapters.length) {
    const err = new Error('движков не найдено: ни одного адаптера ' + 'forma-adapter.cjs в каталогах корня');
    err.exitCode = 2;
    throw err;
  }
  const rows = adapters.map((a) => {
    const id = a.id || String(a.dir).replace(/^\./, '');
    const hook = hookWired(a, root);
    const rules = a.engineRulesFile || null;
    const disc = !hook.wired && disciplineWired(a, root);
    return {
      id,
      rules,
      mode: hook.wired ? 'конструктивно' : disc ? 'дисциплина' : null,
      via: hook.wired ? hook.via : disc ? rules : null,
    };
  });
  return { rows, ready: rows.every((r) => r.mode !== null) };
}

// --- Режим --selftest: приборы во временном каталоге ОС -----------------------------------------

function selftest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'credentials-zone-'));
  try {
    const sk = 'sk-proj-Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56Qr78';
    const ghp = 'ghp_Rk9mPq3Lx7Vb2Nw8Jf5Hd1Zs4Gt6Yc0AeUi';
    const pwd = 'Kj9!mQ2#vX7@Lp5$';
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N0UXtuxEBrKfyoBfjbVoww';
    const fixtures = [
      { rel: 'outside/openai-key.txt', text: 'OPENAI_API_KEY=' + sk + '\n', expect: 'caught' },
      { rel: 'outside/github-token.md', text: 'токен: ' + ghp + '\n', expect: 'caught' },
      { rel: 'outside/aws.txt', text: 'ключ AKIAIOSFODNN7EXAMPLE в тексте\n', expect: 'caught' },
      { rel: 'outside/server.pem', text: '-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----\n', expect: 'caught' },
      { rel: 'outside/config.yaml', text: 'password = "' + pwd + '"\n', expect: 'caught' },
      { rel: 'outside/jwt.txt', text: 'Authorization: Bearer ' + jwt + '\n', expect: 'caught' },
      { rel: 'outside/db-url.txt', text: 'доступ: postgres://admin:S3cr3tP4ss@db.example.internal:5432/base\n', expect: 'caught' },
      { rel: '.env', text: 'DEEPSEEK_API_KEY=' + sk + '\nAPP_PASSWORD=' + pwd + '\n', expect: 'allowed' },
      {
        rel: 'project/VARS/credentials.md',
        text: '# Тестовые аккаунты\n\npassword: ' + pwd + '\ntoken: ' + ghp + '\n',
        expect: 'allowed',
      },
      {
        rel: 'outside/refs.md',
        text: [
          '[[smtp-password]] — ссылка по имени, значение в project/VARS/credentials.md',
          'см. [[test-user-1]] (VARS/)',
          'OPENROUTER_API_KEY и DEEPSEEK_API_KEY — имена переменных (.env)',
          'const apiKey = process.env.OPENAI_API_KEY;',
          'const token = os.environ["MY_ACCESS_TOKEN"];',
          '${DB_PASSWORD} — подстановка по имени',
          'VARIABLE_NAME=NOT_A_SECRET',
          'password = "changeme"',
          'api_key = "YOUR_API_KEY_HERE"',
          'token = "sk-your-key-here"',
          'password: "test1234"',
          'access_token_url: "https://auth.example.internal/token"',
          'max_tokens = 4096',
          '-----BEGIN CERTIFICATE-----',
        ].join('\n') + '\n',
        expect: 'clean',
      },
    ];
    const probes = [];
    let ok = true;
    for (const fx of fixtures) {
      const abs = path.join(dir, ...fx.rel.split('/'));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, fx.text);
      let findings;
      try {
        findings = scanFile(abs, dir).findings;
      } catch (e) {
        ok = false;
        probes.push({ fx, ok: false, why: e.message });
        continue;
      }
      const caught = findings.length > 0;
      const good = fx.expect === 'caught' ? caught : !caught;
      if (!good) ok = false;
      probes.push({ fx, ok: good, findings });
    }
    return { ok, probes, dir };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --- CLI ----------------------------------------------------------------------------------------

function printFileFindings(findings) {
  for (const f of findings) {
    console.log('  ' + (f.file ? f.file + ':' : 'строка ') + f.line + ' — ' + f.family + ' — ' + f.value);
  }
}

function main() {
  const argv = process.argv.slice(2);
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 ? path.resolve(argv[rootIdx + 1]) : ROOT_DEFAULT;

  if (argv.includes('--selftest')) {
    const st = selftest();
    for (const p of st.probes) {
      const tag = p.fx.expect === 'caught' ? 'приманка' : p.fx.expect === 'allowed' ? 'разрешённое место' : 'ссылки по имени';
      if (p.ok) {
        const fam = p.findings && p.findings.length ? ' (' + p.findings[0].family + ')' : '';
        console.log('✓ ' + p.fx.rel + ' — ' + tag + ' — как ждали' + fam);
      } else {
        console.log('✗ ' + p.fx.rel + ' — ' + tag + ' — ПРОБА НЕ СОШЛАСЬ' + (p.why ? ': ' + p.why : ''));
      }
    }
    const caught = st.probes.filter((p) => p.fx.expect === 'caught').length;
    const passed = st.probes.filter((p) => p.ok).length;
    if (st.ok) {
      console.log('selftest: ГОТОВ — ловит ' + caught + ' приманок, пропускает разрешённые места и ссылки по имени (проб: ' + st.probes.length + ')');
      process.exit(0);
    }
    console.log('selftest: ПРОВАЛ — проб сошлось ' + passed + ' из ' + st.probes.length + '; словарь или разрешённые места расходятся с приборами');
    process.exit(1);
  }

  if (argv.includes('--repo')) {
    const r = runRepo(root);
    console.log('проверено файлов: ' + r.checked + (r.notes.length ? '; пропущено: ' + r.notes.length + ' (' + r.notes.slice(0, 5).join('; ') + ')' : ''));
    if (r.findings.length) {
      console.log('НАХОДКИ (' + r.findings.length + '):');
      printFileFindings(r.findings);
      console.log('НАЙДЕНО ПОДОЗРЕНИЙ НА РЕКВИЗИТЫ ВНЕ РАЗРЕШЁННЫХ МЕСТ: ' + r.findings.length + ' — словарь не ослаблять: гейт судится исключением (exception: в History) или человеком');
      process.exit(1);
    }
    console.log('РЕКВИЗИТОВ ВНЕ РАЗРЕШЁННЫХ МЕСТ НЕ НАЙДЕНО (исключения: node_modules, .forma/protocol, .env, project/VARS/credentials.md)');
    process.exit(0);
  }

  const fileIdx = argv.indexOf('--file');
  if (fileIdx >= 0) {
    const target = path.resolve(argv[fileIdx + 1] || '');
    if (!argv[fileIdx + 1]) {
      console.error('СТОП: --file требует путь');
      process.exit(2);
    }
    let r;
    try {
      r = scanFile(target, root);
    } catch (e) {
      console.error('СТОП: ' + e.message);
      process.exit(e.exitCode || 2);
    }
    if (r.note) {
      console.log('--file: чисто — ' + r.note);
      process.exit(0);
    }
    if (r.findings.length) {
      console.log('НАХОДКИ (' + r.findings.length + '):');
      printFileFindings(r.findings);
      console.log('СТОП: значение реквизита вне разрешённых мест (' + path.relative(root, target).split(path.sep).join('/') + ') — значения живут только в .env (корень) и project/VARS/credentials.md; ссылка по имени ([[name]] / VARIABLE_NAME) — вместо значения');
      process.exit(1);
    }
    console.log('--file: реквизитов не найдено (' + path.relative(root, target).split(path.sep).join('/') + ')');
    process.exit(0);
  }

  if (argv.includes('--wired')) {
    let r;
    try {
      r = runWired(root);
    } catch (e) {
      console.error('СТОП: ' + e.message);
      process.exit(e.exitCode || 2);
    }
    for (const row of r.rows) {
      if (row.mode) console.log('✓ ' + row.id + ' — ' + row.mode + ' (' + row.via + ')');
      else console.log('✗ ' + row.id + ' — не прикрыт: ни зарегистрированного вызова сканера из хука, ни строки дисциплины в ' + (row.rules || '§8 (файл правил не объявлен адаптером)'));
    }
    if (r.ready) {
      console.log('ЗАПРЕТ 15 ПРИКРЫТ У ВСЕХ ДВИЖКОВ (конструктивно либо дисциплина): ' + r.rows.map((x) => x.id).join(', '));
      process.exit(0);
    }
    console.log('ЕСТЬ НЕПРИКРЫТЫЕ ДВИЖКИ — подключи хук или добавь строку дисциплины в §8');
    process.exit(1);
  }

  console.error('usage: node .forma/board/checks/credentials-zone.cjs --selftest | --repo | --file <путь> | --wired [--root <каталог>]');
  process.exit(2);
}

module.exports = { scanText, scanFile, runRepo, runWired, selftest, isAllowedPlace, bitsPerChar, maskValue };

if (require.main === module) main();
