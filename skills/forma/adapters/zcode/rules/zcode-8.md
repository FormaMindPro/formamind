# 8. Engine architecture in ZCode

Факты движка ZCode, которых не знает закон. Закон — `AGENTS.md`; здесь — только то, что знает этот движок. Проверка зоны — `node .zcode/tests/test-zcode-adapter.cjs`; проба возможностей — `.zcode/.state/capabilities.json` (пишет только доказуемое, недоказуемое — `null`/`false` с причиной).

## Root rules (Contract 1: constructive)

Корень читает `AGENTS.md` — единственный закон, обёртки в корне нет. Роли узлов — `.zcode/agents/` (зеркало `.claude/agents/`, собирается `node .zcode/scripts/gen-roles.cjs`). Скиллы проекта движок читает нативно из канона ядра `.forma/skills/` — собственной копии скиллов зона не держит (как Kimi). Общие скрипты ядра (`.claude/scripts/*`, `.forma/**`) — зависимость по имени, не владение.

## Isolation of nodes (Contract 2: constructive)

Инструмент `Agent` хоста вызывает подагентов в **отдельных контекстах**. Роли узлов Формы хост регистрирует типами агента **из зеркала `.zcode/agents/`**: `intent`, `spec`, `kit`, `run`, `core`, `plumb-glmflash`, `extractor`, `asset-describer-haiku` (проба регистрации застала исполнителя Plumb под унаследованным от зеркала Claude именем `plumb-haiku`; переименован в `plumb-glmflash` — модель зоны GLM Flash, а не Haiku; дата и основания переименования — в карточке микро-правок эпика, регистрация под именем зоны — наблюдение следующей сессии). Доказательство, что источник — именно эта зона, а не чужое зеркало: шапка зарегистрированного агента несёт переименования инструментов, существующие только в генераторе этой зоны (`mcp_browser` вместо `mcp__chrome-devtools__*`). Живая делегация к роли вернулась из дочерней сессии с метаданными вызова (токены, длительность, id) — изоляция запретов 1 и 7 держится конструкцией, не дисциплиной.

**Деградированный режим** (`degraded-mode.md`) — состояние движка на свежей среде, пока хост не зарегистрировал роли: стадии в одном контексте под явными метками `[STAGE: SPEC] → [STAGE: KIT] → [STAGE: RUN] → [STAGE: INTENT]`, проверки только по осмотрённым фактам, деградация объявляется человеку до старта работы. Реестр типов агента читается в начале сессии — факт регистрации проверяется, не предполагается.

**Шаблоны диспетч-промптов** (§4, §6) — единое аудируемое место: `node .claude/scripts/dispatch-prompt.cjs --node <Intent|Spec|Kit|Run|Core> --card <путь> [--marker <маркер>] [--note "текст"]`. Шаблон несёт маркер позиции первой строкой, адрес карточки (карточка — вся инструкция, диспетч-сообщение её не пересказывает) и формат возврата. Вольный текст `--note` проходит скраб скриптом, не моделью (тот же механизм, что у Отвеса; запрет 17, применён к входу собственных узлов): секретоподобный остаток — отказ fail-closed, промпт не печатается. Диспетчер зоны (главная сессия, вызывающая `Agent`) собирает промпты вызовов узлов через этот скрипт, а не пишет их от руки.

## Main session = `Intent` (§1) (Contract 3: constructive)

Главная сессия читает `agents/intent.md` первым действием. Ворота старта (§3) и дайджест беклога доставляют конфиг-хуки workspace-конфигурации `.zcode/config.json` (`hooks.enabled`, событие `SessionStart`, matcher `startup|resume|clear|compact`): `node .forma/i18n/cli.cjs gate --json` и `node .forma/i18n/cli.cjs backlog --json`, ответ строгим JSON хост вкладывает в контекст сессии; ворота конструктивны — ничего не блокируют, при ненастроенном проекте сами открывают карточку настройки и просят у человека решений, пустой беклог молчит. Доставка держится доверием человека проекту: недоверенный хук молча не исполняется (ниже, «Host facts»). Роль `Intent` хуком не доставляется — читается вручную; это не расхождение, а форма доставки роли.

## Host facts (observed on ZCode 0.18.0)

- **События хуков**, которые хост знает: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `Stop`, `SubagentStop`.
- **Объявление** — `.zcode/config.json`, `hooks.events.<Event>` = список групп `{ "matcher"?, "hooks": [{ "type": "process", "command", "args", "timeoutMs" }] }`. `matcher` сверяется с именем инструмента (`Bash`, `Write|Edit`) на событиях инструмента и с причиной старта (`startup|resume|clear|compact`) на `SessionStart`; группа без `matcher` срабатывает на всё событие.
- **Вход хука** — JSON на stdin: `hook_event_name`, `session_id`, `cwd`, `transcript_path`, `permission_mode`; на событиях инструмента ещё `tool_name`, `tool_input`, `tool_use_id`; на `UserPromptSubmit` — `prompt`. Подстановки в объявлении: `${ZCODE_PROJECT_DIR}`, `${ZCODE_PLUGIN_ROOT}`.
- **Выход:** код 0 — stdout разбирается как JSON (`hookSpecificOutput.additionalContext` дописывает контекст модели); код 2 на `PreToolUse` — отказ вызова (`permissionDecision: "deny"`, причина — stderr); код 2 на других событиях останавливает ход; прочий код — сбой хука.
- **Проверка скрипта перед запуском.** Перед запуском хост сверяет SHA-256 файла хука со снимком, записанным при выдаче доверия; путь скрипта берётся из объявления относительным и разрешается от `cwd` события. Наблюдено живьём: если рабочий каталог сессии — подкаталог проекта (`.forma/protocol`), проектные хуки молча блокируются (`workspace_hook.script_verification_blocked`, `reasonCode: workspace_hook_script_unavailable`, `currentState: missing`) — и охрана удаления, и слушатель фразы; при `cwd` = корень проекта те же хуки исполняются (`hook.run.allowed`, `sourceKind: project`). Доверие при этом остаётся `trusted_persistent` — `hooks-trust.cjs` такую блокировку не видит.
- **Журнал.** `hook.run.allowed` пишется для `PreToolUse` — поля `context.source`, `sourceKind` (`project`, `plugin`, `user`), `matcher`, `hookIndex`, `toolName`; проектный хук виден как `project.workspace-hook-0-PreToolUse-0-0`. `SessionStart` оставляет `hook.session_start_context.resolved` с `result` (`written` — контекст доставлен модели), отдельной записи `hook.run` нет; `UserPromptSubmit` записи `hook.run` не оставляет вовсе, исполнение слушателя проверяется по следствию (маркер фразы), не по журналу. Наблюдено живьём на этом проекте: ворота и беклог доставлены, охрана отклонила `rm` (код 2), слушатель поставил маркер — `hook.run` с `sourceKind: project` при этом есть только у `PreToolUse`.
- **Доверие.** Проектный хук (`.zcode/config.json`) исполняется только после того, как человек выдал ему постоянное доверие для этого workspace: до этого хук стоит в `workspace_hooks_pending_trust`, в журнале хоста — `config_project_hooks.pending_trust`, и молча не срабатывает. Наблюдённый факт: строка `config_project_hooks.pending_trust` пишется в журнал и при уже выданном доверии (4/4 `trusted_persistent`) — в том числе за секунды до исполнения проектного хука; состояние доверия судят по `hooks trust status` / `node .zcode/scripts/hooks-trust.cjs` и по исполнению (`hook.run.allowed` с `sourceKind: project`), а не по отсутствию этой строки. Выдача: `node "<каталог ZCode>/resources/glm/zcode.cjs" hooks trust grant --workspace "<корень>" --all-current --bundle-digest <дайджест>`; дайджест и состояние печатает `hooks trust status --workspace "<корень>" --json`, ответ доверия — `workspace_hooks_trusted_persistent`. Доверие привязано к дайджесту связки объявлений и к дайджесту каждого объявления, поэтому **после любой правки `.zcode/config.json` выдаётся заново**. Хранилище — `~/.zcode/security/workspace-hook-trust-v1.json` (`workspaceIdentity`, `hookDeclarationDigest`, `bundleDigestAtGrant`). Хук плагина (`plugins/forma-hooks/hooks/hooks.json`) доверия workspace-а не требует — этот путь остаётся для напоминаний (Contract 10).

## Continuation of the same `Run` (Contract 4: constructive in mechanism and in the record)

Продолжение того же вызова — `SendMessage` по `agent_<id>`: завершённый подагент возобновляется в фоне со своим контекстом. Механизм задокументирован контрактом инструмента хоста; живого наблюдения в этом проекте нет — в пробе стоит `observedLive: null`, не `true`.

## Spend fields (§3) (Contract 5: constructive)

Тег движка в строке расхода — `zcode:`. Стена тегов не зашита в ядре: `engineTagRe` строится из меток загруженных адаптеров, поэтому тег попадает в белый список самим фактом адаптера — правок ядра не требуется.

Журнал модель-IO пишет сам хост: `~/.zcode/cli/rollout/model-io-sess_<id>.jsonl` — по записи на вызов, поля расхода `inputTokens`, `outputTokens`, `totalTokens`, `cacheReadTokens`, `cacheWriteTokens` и провайдерские `input_tokens`, `output_tokens`, `cache_read_input_tokens`. `transcriptsDir` адаптера читает его. Своего писателя строки §3 (хука) у движка нет — строки пишет вызывающий узел одной командой после возврата (общий `card-subagent-spend`: канонические суммы из стенограммы вызова через адаптеры; фоновой вызов — команды можно и раньше, пока стенограмма жива); стенограммы нет — маркер `unknown` с причиной, никогда ноль. Живого писателя в пробе нет (`writer: null` с причиной — команда есть кит протокола, движком она не доказывается).

Денежный слой — отдельно от строки расхода: адаптер объявляет `cost: { script, label, currency, ttlMs }`, у ZCode это `.zcode/scripts/go-cost.cjs` — официальные лимиты Go (5 ч, неделя, месяц), цены и месячные потолки по моделям, оценка расхода по токенам; ядро вызывает скрипт как `node <script> --json --project` и строит блок во вкладке «Экономика» только при наличии отчёта. Оценка в долларах в строку §3 не попадает: строка — по факту вызова, не по прайсу; официальный `opencode.allowance` хост не сохраняет — `unknown`, не ноль.

## Deletion guard (§1, §2) (Contract 6: constructive)

Охрана конструктивна: `PreToolUse` с матчером `Bash` зовёт `.zcode/hooks/guard-destructive.cjs`, который решение не дублирует, а спрашивает общее ядро `.forma/rules/guard-delete.cjs` — реестр `protected-paths.json` (зона `.zcode` и `zcode-8.md` в нём), рекурсивные маски и разовый маркер. Отказ — код 2 и текст в stderr, хост превращает его в `permissionDecision: "deny"`. Кодовую фразу человека ловит слушатель `UserPromptSubmit` `.zcode/hooks/unlock-delete.cjs` и ставит разовый маркер `.zcode/.state/.delete-unlock` в своей зоне (не в `.claude/hooks/` — чужая зона); ядро гасит маркер на первом охраняемом действии, следующее снова отклоняется. Оба файла несут `--selftest`. Недоверенный хостом хук молча не срабатывает — состояние называется командой `node .zcode/scripts/hooks-trust.cjs` (красная строка и ненулевой код на недоверенном).

## The board and the card path (Contract 7: constructive)

Доска и карточки — общее ядро (`.forma/board/*`), движкам нейтральное: `new-card.cjs`, `card-move.cjs`, `check-board.cjs` вызываются как есть. Ключи зон и снаряжения — английские слова словаря (§6); проверка доски останавливает ход с неанглийским ключом.

## The Plumb (Contract 8: constructive)

Отвес — общий драйвер ядра (`plumb-run.cjs`), настройка в `PROJECT.md`, «Маршруты». Что знает только этот движок: встроенный исполнитель зоны — `plumb-glmflash` (переименован из унаследованного `plumb-haiku`; имя несёт модель зоны); подагенты-измерения вызываются инструментом `Agent` хоста; скрабинг перед внешней моделью — запрет 17, без него вызов падает в семейный исполнитель. Строку чтения пишет `Spec` сразу после возврата.

## Preflight verification (Contract 9: constructive)

Перед работой в зоне: `node .forma/dashboard/lib/engines.cjs check zcode` (код 0), `node .zcode/tests/test-zcode-adapter.cjs`, `node .zcode/scripts/hooks-trust.cjs` (все проектные хуки `trusted_persistent`, либо явное «skip» без хоста), `node .claude/scripts/sync-engines.cjs --check` (сверка без нарушений по зоне). Тест соответствия — единственная точка, где зона сверяется с контрактом экономики (ECONOMY.md); сверка движков находит адаптер сама по файлу §8.

## Names reminder (§1, prohibition 20) (Contract 10: constructive)

Локальный плагин `.zcode/plugins/forma-hooks` (marketplace `.zcode/plugins/marketplace.json`) регистрирует `UserPromptSubmit` → `hooks/names-context.cjs`: хук читает `prompt`, при протокольных кодах отдаёт `hookSpecificOutput.additionalContext` с именами из `.forma/i18n/names.cjs` — карточка по заголовку доски (включая `done/`), цель по `GOAL.md`, маршруты, надстройки, разделы и запреты по `keys.json`; fail-open — пустой stdout и код 0.

Хук — напоминание контекста, не проверка ответа. Плагин вступает в силу после того, как человек добавит `.zcode/plugins` как локальный marketplace (Settings → Plugins → Create → Add marketplace), установит и включит `forma-hooks`, затем начнёт новую сессию. Живая доставка из Qoder не наблюдалась; машинно проверены манифест, регистрация `UserPromptSubmit`, форма вывода и fail-open — `test-zcode-adapter.cjs`.

## Models per node

Дефолты пяти узлов объявлены в зоне — `nodeModels` файла `.zcode/forma-adapter.cjs`; здесь правится дефолт. `project/config/PROJECT.md`, «Дефолты узлов» — сводка: её zcode-колонка сходится с объявлением по нижнему регистру. <!-- k:zcode.node_defaults -->

| Узел | Модель | Усилие |
| --- | --- | --- |
| Intent | `glm-5.3-flash` | high |
| Spec | `glm-5.3-flash` | high |
| Kit | `glm-5.3-flash` | high |
| Run | `glm-5.3-flash` | low |
| Core | `glm-5.3-flash` | high |

Рантайм один — GLM (Z.AI), уровни `low | high | max` (среднего нет). Модель зеркала ставит генератор: узел — из объявления зоны; роль вне пяти узлов — первый кандидат привязки `project/config/models.json` (роль × движок zcode), без неё — `default_model` строки zcode; в шапку идёт голый id — последний сегмент адреса в нижнем регистре. Реестр или объявление не читаются — генератор падает с именем файла, дефолта из памяти нет. Перегенерация — генератором, сверка `--check`; усилие строки вызова правит вызывающий узел по закону §3.

## Zone of edits

Движок пишет только в `.zcode/` и карточки (`.devtool/features`) — `writeZones` адаптера. Чтение общих скриптов и закона — зависимость, не владение; правка чужих папок — возврат по маршруту, не правка на месте (запрет 12).

## Охрана реквизитов (§5, запрет 15: дисциплина)

Значения реквизитов (API-ключи, токены, пароли, PEM-ключи) живут только в `.env` в корне проекта и `project/VARS/credentials.md`. Событий хуков на запись файлов у движка нет, поэтому запрет 15 держится **дисциплиной** (ENGINE-CONTRACT.md): перед записью или коммитом файла, который может нести реквизит, узел прогоняет `node .forma/board/checks/credentials-zone.cjs --file <путь>`; находка останавливает запись (fail-closed). Ссылки по имени — `[[name]]` для VARS/, `VARIABLE_NAME` для `.env` — значениями не считаются и разрешены всегда.

## Verification of this zone

```
node .zcode/scripts/gen-roles.cjs --check          # зеркало ролей синхронно с .claude/agents
node .forma/dashboard/lib/engines.cjs check zcode  # контракт адаптера, код 0
node .zcode/tests/test-zcode-adapter.cjs           # §8, форма, паритет, расход, чистота зоны
node .claude/scripts/sync-engines.cjs --check      # сверка движков, нарушений по зоне нет
```
