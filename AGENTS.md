# AGENTS.md

Правила для агентов, работающих в этом репозитории. Дополняют глобальный `AGENTS.md`, не заменяют его.

## Что это

FileSwitcher - нативное macOS-приложение для перехвата и подмены HTTP(S)-трафика: локальный прокси
с MITM на SwiftNIO + AppKit-интерфейс. Electron-версии в репозитории больше нет (этап 8 миграции,
см. `MIGRATION_NATIVE_SWIFT.md`).

## Структура

| Каталог | Что внутри |
| --- | --- |
| `Sources/FileSwitcher/Proxy/` | HTTP-прокси, CONNECT-туннели, MITM, генерация сертификатов, правило-движок на пути запроса, `ReplayRequest` |
| `Sources/FileSwitcher/Rules/` | модель и группы правил, matcher, безопасный regex, валидация, `RulesStore` |
| `Sources/FileSwitcher/Storage/` | `LogStore` (jsonl-журнал), `LogEvent`, экспорт HAR/JSON/CSV |
| `Sources/FileSwitcher/System/` | системный прокси macOS, доверие к CA, перечисление сетевых сервисов, запуск `sudo`-команд |
| `Sources/FileSwitcher/Support/` | пути данных, JSON-файлы, `--system-check`, локализация интерфейса (`L10n`) |
| `Sources/FileSwitcher/UI/` | AppKit: `AppDelegate`, меню приложения и темы (`AppMenu`, `AppearanceSettings`), единое окно с журналом и правилами (`MainWindowController`), панели, формы правила, деталей и настроек, онбординг, иконка в строке меню, дерево JSON, палитра `AppTheme` |
| `Tests/FileSwitcherTests/` | Swift Testing, по файлу на модуль |

## Команды

```bash
swift build
swift test
swift run FileSwitcher --selftest
swift run FileSwitcher --system-check
./package-app.sh      # dist/FileSwitcher.app + dist/FileSwitcher.zip, ad-hoc подпись
./install-app.sh      # копирование в /Applications
```

## Правила кода

- Swift 6, строгая конкурентность: новый асинхронный код - `async`/`await` или `EventLoopFuture`,
  без гонок через глобальное состояние; разделяемые объекты - `actor`/`@MainActor` по месту.
- Док-комментарии и комментарии - по-русски, короткие; WHY-комментарий только там, где причина
  неочевидна (например, `shortcut:` у осознанных упрощений).
- Публичные типы и функции - с кратким док-комментарием; приватные помощники - без него.
- Никаких `try!`/`as!` в новом коде; ошибки возвращать или логировать, не глотать.
- UI только на AppKit, без сторонних UI-библиотек. Строки интерфейса - по-русски как ключи словаря
  и оборачиваются в `L10n.t(...)`; английские переводы - в `Support/AppLocalizationEnglish.swift`.

## Данные и совместимость

- Каталог данных - `~/Library/Application Support/FileSwitcher` (`AppPaths.supportDirectory`):
  `rules.json`, `traffic-logs/*.jsonl`, `proxy-system-state.json`. Форматы совместимы с Electron-версией -
  не переименовывать поля без миграции.
- CA - `~/.mitmproxy/mitmproxy-ca*.pem`, общий с прежним движком; менять расположение нельзя.
- Системный прокси включается с записью состояния в `proxy-system-state.json`; откат при краше
  опирается на этот файл - логику отката не упрощать.

## Проверки перед коммитом

- `swift build` и `swift test` зелёные; для изменений в прокси или сертификатах - дополнительно
  `swift run FileSwitcher --selftest`.
- `-warnings-as-errors` в проекте не включается: swift-nio-ssl объявляет
  `@available(*, unavailable) extension NIOSSLHandler: Sendable`, из-за чего три предупреждения
  неустранимы. Новые предупреждения в своём коде устранять.
- CI (`.github/workflows/ci.yml`) - джоба `swift` на `macos-26`: build, test, `package-app.sh`,
  `--selftest` из бандла.
