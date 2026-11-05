# FileSwitcher

Нативное macOS-приложение (Swift 6 + AppKit) - локальный прокси для подмены файлов и ответов
в HTTP(S)-трафике. Правила подмены задаются по URL (точное совпадение или regex), журнал всего
трафика виден в реальном времени.

## Как это устроено

- `Sources/FileSwitcher/Proxy/` - HTTP-прокси на SwiftNIO с перехватом TLS в CONNECT-туннелях.
  Сертификаты хостов подписываются своим CA (`~/.mitmproxy/mitmproxy-ca*.pem`, совместим с прежним
  движком), апстрим-соединение открывается на каждый запрос. `ReplayRequest` повторяет запрос
  из журнала через `URLSession` (проверка публичности адреса на каждом редиректе).
- `Sources/FileSwitcher/Rules/` - модель правил, группы, безопасный поднабор regex
  (без lookaround и обратных ссылок), валидация, хранилище.
- `Sources/FileSwitcher/Storage/` - журнал (`traffic-logs/*.jsonl`), экспорт в HAR/JSON/CSV.
- `Sources/FileSwitcher/System/` - системный прокси macOS (вкл./выкл. с откатом при краше),
  доверие к CA, список сетевых сервисов.
- `Sources/FileSwitcher/UI/` - AppKit: одно окно с журналом и правилами, иконка в строке меню,
  онбординг первого запуска.

Ограничения движка: HTTP/2 не перехватывается (браузер договаривается на HTTP/1.1).

## Приватность журнала

Журнал трафика (`~/Library/Application Support/FileSwitcher/traffic-logs/*.jsonl`) содержит
**URL и тела всех запросов/ответов**, прошедших через прокси. Секретные заголовки (`Authorization`,
`Cookie`, `Set-Cookie`, `X-Api-Key` и др.) вырезаются при записи, но в **телах** могут остаться
пароли из форм и токены. Файл сессии ограничен 100 МБ, при старте удаляются все файлы, кроме
20 последних. Экспорт (HAR/JSON/CSV) содержит те же данные - при экспорте показывается
предупреждение.

## Разработка

```bash
swift build
swift test                             # юнит-тесты (Swift Testing)
swift run FileSwitcher                 # запуск приложения
swift run FileSwitcher --selftest      # проверка CA, сертификата и TLS-контекста
swift run FileSwitcher --system-check  # состояние CA и системного прокси
```

## Сборка и установка

```bash
./package-app.sh    # universal-бандл dist/FileSwitcher.app + dist/FileSwitcher.zip
./install-app.sh    # копирует бандл в /Applications
./release.sh        # тег и GitHub-релиз с архивом
```

Подпись - ad-hoc (`CODE_SIGN_IDENTITY=-`) по умолчанию; для Developer ID задать переменную
`CODE_SIGN_IDENTITY`. Первый запуск просит пароль администратора: приложение включает системный
прокси и добавляет свой CA в доверенные.

## Документация

- `AGENTS.md` - структура, команды и ограничения этого репозитория.
- `MIGRATION_NATIVE_SWIFT.md` - план перехода с Electron на Swift, история этапов.
