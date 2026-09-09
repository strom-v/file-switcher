# FileSwitcher

Настольное приложение (macOS, частично Windows), запускающее локальный прокси для подмены файлов и
ответов в HTTP(S)-трафике. Правила подмены задаются по URL (точное совпадение или regex), журнал
всего трафика виден в реальном времени.

## Как это устроено

Три процесса:

- **main** (`src/main/`) — Node/Electron. Управляет дочерним процессом `mitmdump`, системным прокси
  ОС (вкл./выкл. с откатом при краше), доверием к CA-сертификату, хранением правил и журнала.
  Платформозависимые операции — за интерфейсом `src/main/platform/` (`systemProxy.*`, `cert.*`),
  выбор реализации по `process.platform`. macOS — эталонная полная реализация, Windows — частичная,
  прочее — заглушки (работает только сам прокси-сервер).
- **preload** (`src/preload/preload.ts`) — узкий типизированный мост `window.api` через
  `contextBridge` (renderer в sandbox, без Node).
- **renderer** (`src/renderer/`) — React + antd. Панели журнала и правил, настройки в Drawer.
- **прокси** (`resources/addon.py`) — Python-аддон для `mitmproxy`: матчинг правил, подмена тела/
  статуса/заголовков, логирование трафика в stdout как JSONL. Контракт правила (какие поля читает) —
  `src/shared/rule.schema.json`, общий с TS-стороной.

## Приватность журнала

Журнал трафика (`~/Library/Application Support/FileSwitcher/traffic-logs/*.jsonl` на macOS) содержит
**URL и тела всех запросов/ответов**, прошедших через прокси. Секретные заголовки (`Authorization`,
`Cookie`, `Set-Cookie`, `X-Api-Key` и др.) вырезаются при записи, но в **телах** могут остаться пароли
из форм и токены. Файл сессии ограничен 100 МБ, при старте удаляются все файлы, кроме 20 последних.
Экспорт (HAR/JSON/CSV) содержит те же данные — при экспорте показывается предупреждение.

## Разработка

Нужен Python-venv с `mitmproxy` до первого `npm run dev`:

```bash
scripts/setup_venv.sh          # runtime: mitmproxy (для dev)
scripts/setup_venv.sh --dev    # + pytest (для тестов addon.py)
scripts/setup_venv.sh --build  # + pyinstaller (для сборки бинарника)
```

```bash
npm install
npm run dev          # запуск с HMR
npm run typecheck    # tsc по main+renderer
npm test             # vitest (чистые функции TS/JS)
npm run test:py      # pytest (логика addon.py)
npm run format       # prettier
npm run build        # electron-vite build (бандлы, без упаковки)
```

### Сборка дистрибутива

`mitmdump` — отдельный бинарник (PyInstaller не кросс-компилирует, собирать на целевой ОС):

```bash
scripts/setup_venv.sh --build
scripts/build_mitmdump.sh      # → resources/bin/mac/mitmdump  (build_mitmdump.ps1 для Windows)
npm run build:mac              # → dist/*.dmg  (build:win / build:linux аналогично)
```

`resources/bin/` в gitignore — бинарник кладётся локально перед упаковкой.
