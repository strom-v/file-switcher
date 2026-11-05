# FileSwitcher

Menu-bar приложение для macOS: локальный прокси для подмены файлов и ответов в HTTP(S)-трафике.
Правила подмены задаются по URL (точное совпадение или regex), журнал всего трафика виден в реальном
времени. Иконка живёт в строке меню, в Dock приложение не показывается.

## Как это устроено

- **main** (`src/main/`) — Node/Electron. Сам прокси встроен в main-процесс (`src/main/proxy/`):
  HTTP-прокси с перехватом TLS в CONNECT-туннелях, сертификаты хостов подписываются своим CA
  (`~/.mitmproxy/mitmproxy-ca*.pem`, совместим с CA от прежнего mitmproxy-движка). Там же системный
  прокси macOS (вкл./выкл. с откатом при краше), доверие к CA, хранение правил и журнала.
  Контракт правила — `src/shared/rule.schema.json`.
- **preload** (`src/preload/preload.ts`) — узкий типизированный мост `window.api` через
  `contextBridge` (renderer в sandbox, без Node).
- **renderer** (`src/renderer/`) — React + antd. Панели журнала и правил, настройки в Drawer.

Ограничения движка: HTTP/2 не перехватывается (браузер договаривается на HTTP/1.1), regex правил —
безопасный поднабор JS RegExp без lookaround и обратных ссылок (`src/shared/regexSafety.ts`).

## Приватность журнала

Журнал трафика (`~/Library/Application Support/FileSwitcher/traffic-logs/*.jsonl` на macOS) содержит
**URL и тела всех запросов/ответов**, прошедших через прокси. Секретные заголовки (`Authorization`,
`Cookie`, `Set-Cookie`, `X-Api-Key` и др.) вырезаются при записи, но в **телах** могут остаться пароли
из форм и токены. Файл сессии ограничен 100 МБ, при старте удаляются все файлы, кроме 20 последних.
Экспорт (HAR/JSON/CSV) содержит те же данные — при экспорте показывается предупреждение.

## Разработка

```bash
npm install
npm run dev          # запуск с HMR
npm run typecheck    # tsc по main+renderer
npm test             # vitest
npm run format       # prettier
npm run build        # electron-vite build (бандлы, без упаковки)
npm run build:mac    # → dist/*.dmg
```
