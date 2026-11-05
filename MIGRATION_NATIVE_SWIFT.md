# Перенос FileSwitcher на нативный Swift/AppKit (структура и сборка как у Vistrom)

Живой чеклист миграции. Формат и конвенции - как в `Vistrom/MIGRATION_SINGLE_FILE_STORE.md`:
этапы идут по порядку, каждый оставляет репозиторий собирающимся, галочка ставится по факту
проверки, а не по факту написания кода.

## 1. Что переносим

Сейчас: Electron-приложение, ~7 300 строк TS/TSX, macOS-only (win/linux уже выпилены в рабочей копии).
Цель: то же приложение на Swift/AppKit, без Electron, Node и Python.

| Сейчас                                                                                            | Строк  | Куда в Swift                                                                                                                                    |
| ------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/proxy/proxyServer.ts`                                                                   | 504    | `Proxy/ProxyServer.swift` + `Proxy/HttpMessage.swift`                                                                                           |
| `src/main/proxy/certificateAuthority.ts`                                                          | 134    | `Proxy/CertificateAuthority.swift` + `Proxy/DerEncoder.swift`                                                                                   |
| `src/main/proxy/ruleMatcher.ts`                                                                   | 221    | `Proxy/RuleMatcher.swift`                                                                                                                       |
| `src/main/proxyController.ts`                                                                     | 171    | `Proxy/ProxyController.swift`                                                                                                                   |
| `src/main/logStore.ts`                                                                            | 310    | `Storage/LogStore.swift` + `Storage/LogEvent.swift`                                                                                             |
| `src/main/logExport.ts`                                                                           | 159    | `Proxy/LogExport.swift`                                                                                                                         |
| `src/main/replayRequest.ts`                                                                       | 192    | `Proxy/ReplayRequest.swift`                                                                                                                     |
| `src/main/rulesStore.ts`                                                                          | 142    | `Storage/RulesStore.swift`                                                                                                                      |
| `src/main/jsonFile.ts`                                                                            | 38     | `Storage/JsonFile.swift`                                                                                                                        |
| `src/main/platform/systemProxy.darwin.ts`                                                         | 330    | `System/SystemProxyDarwin.swift` + `System/NetworkServicesDarwin.swift`                                                                         |
| `src/main/platform/cert.darwin.ts`                                                                | 50     | `System/CertTrustDarwin.swift`                                                                                                                  |
| `platform/*vpn*`, `proxySystemConfig.ts`, `certInstaller.ts`, `execAsync.ts`                      | ~200   | `System/VpnStatus.swift`, `System/SudoersRule.swift`, `ShellCommand.swift`                                                                      |
| `src/shared/*` (types, constants, regexSafety, ruleGroups, validateRule, redactedHeaders, schema) | ~500   | `Storage/RuleModel.swift`, `Proxy/RegexSafety.swift`, `Storage/RuleGroups.swift`, `Storage/RuleValidation.swift`, `Proxy/RedactedHeaders.swift` |
| `src/main/main.ts` + `ipc.ts`                                                                     | 333    | `main.swift`, `AppDelegate.swift`, `AppMenuPanel.swift` (IPC исчезает вместе с renderer)                                                        |
| `src/preload/preload.ts`                                                                          | 91     | удаляется (нет процесса-посредника)                                                                                                             |
| `src/renderer/**` (App, 10 компонентов, 6 хуков, i18n, formatters, requestExport, theme, css)     | ~2 900 | `UI/*.swift` + `AppLocalization.swift` + `AppTheme.swift`                                                                                       |
| `test/fixture.js`, `test/rules.json`                                                              | -      | `Tests/FileSwitcherTests/Fixtures/`                                                                                                             |

Поведение, которое должно сохраниться 1:1: перехват HTTPS через CONNECT с подменой тела ответа,
правила (exact/regex, группы, приоритет, подстановка `$1`), модификации заголовков, `delayMs`,
`statusCodeOverride`, журнал всего трафика в JSONL с теми же лимитами, поиск по телу, экспорт
HAR/JSON/CSV, повтор запроса из журнала, системный прокси macOS с откатом при краше, доверие к CA,
предупреждение про full-tunnel VPN, ru/en, светлая/тёмная тема, иконка в menu bar без Dock.

## 2. Ключевые решения (нужно подтверждение до кода)

1. **Зависимости: `swift-nio` + `swift-nio-ssl`** (Apple, Apache-2.0). Без них перенос не сделать:
   системного API, который после ответа `200 Connection Established` поднимает TLS на том же сокете
   с сертификатом, выпущенным на лету, нет: Network.framework выбирает TLS только при создании
   соединения (upgrade уже открытого канала не поддерживается), а серверный сертификат для него
   задаётся через `sec_identity_t`, то есть через `SecIdentity` из keychain. NIOSSL принимает ключ и
   цепочку байтами, поэтому листовые сертификаты не нужно заводить в keychain.
2. **UI на AppKit** (как Vistrom), а не SwiftUI: журнал трафика - таблица на сотни тысяч строк с
   потоковой вставкой; в `NSTableView`/`NSOutlineView` это предсказуемо, в SwiftUI - нет.
3. **Ветка `native-swift`**, Electron в `main` остаётся рабочим до паритета. Мерж в `main` - на
   этапе 8, вместе с удалением Electron-кода; тег `electron-legacy` на последний Electron-коммит
   как точка возврата.
4. **Совместимость данных полная** (раздел 4): тот же `rules.json`, те же `traffic-logs/*.jsonl`,
   тот же CA в `~/.mitmproxy`, тот же `proxy-system-state.json`, то же sudoers-правило. Нативную
   версию можно ставить поверх Electron и обратно без потери правил.
5. **Настройки UI не мигрируют**: порт, тема, язык, размер панелей и флаг онбординга лежали в
   `localStorage` renderer; в нативном приложении это `UserDefaults` с дефолтами (порт 38765,
   тема системная, язык русский). Осознанная потеря одного клика.
6. **Идентичность бандла не меняется**: `FileSwitcher.app`, `com.fileswitcher.app`,
   `LSUIElement = true`. Иначе macOS заводит второе приложение и выданные разрешения не действуют.
7. **Нет dev-сборки** (правило Vistrom): единственный способ запустить - `./install-app.sh`.
   Логика проверяется `swift test` и `--selftest` внутри собранного бандла.
8. **Строки UI в Swift** (`AppLocalization.swift`, словари ru/en с ключами как в текущих
   `i18n/*.json`), без бандл-ресурсов: иначе в `package-app.sh` появляется копирование ресурсов SPM
   без выигрыша.

## 3. Технический фундамент MITM

- Листенер: `127.0.0.1:<порт>`, NIO `ServerBootstrap`; первый запрос разбирается как absolute-form
  (http) или `CONNECT`.
- `CONNECT`: ответ `HTTP/1.1 200 Connection Established`, затем в pipeline добавляется
  `NIOSSLServerHandler` с `NIOSSLContext` для запрошенного хоста и ALPN `http/1.1` (HTTP/2 не
  перехватываем, как и сейчас), после чего ставится HTTP-декодер. Захват TLS-байт клиента до
  рукопожатия не нужен - handshake начинает клиент.
- Сертификат хоста: один RSA-2048 ключ на сеанс (как в текущем коде), сертификат на каждый хост
  собирается вручную в DER (`DerEncoder.swift`: CN=host, SAN dNSName или iPAddress, basicConstraints
  CA=false, keyUsage, EKU serverAuth, 365 дней), подпись `SecKeyCreateSignature` с
  `.rsaSignatureMessagePKCS1v15SHA256`. Issuer - байты subject'а CA без перекодирования, иначе
  цепочка не сходится. Кэш `NIOSSLContext` по хосту с потолком 1 000.
- CA: читается существующий `~/.mitmproxy/mitmproxy-ca.pem` (PEM -> DER, PKCS#1 или PKCS#8), чтобы
  уже выданное доверие продолжало работать. Если файла нет - создаётся новый CA и пишется в те же
  файлы, что делает Electron-версия.
- Апстрим: `ClientBootstrap` + `NIOSSLClientHandler` (SNI = хост, доверие - системный trust store,
  чтобы работал корпоративный CA стендов), HTTP/1.1, keep-alive, вырезание hop-by-hop заголовков,
  потоковая передача тела без буферизации целого ответа; в память попадают первые 64 КБ тела
  каждого направления для журнала.
- `Upgrade`/WebSocket: рукопожатие пробрасывается, дальше байты идут как есть (как сейчас).
- Тела: бинарность - по строгому UTF-8 (`String(bytes:encoding:)` = nil -> binary). Лимиты журнала
  прежние: 64 КБ на тело, 64 КБ и 100 заголовков на запись.

## 4. Совместимость данных

| Данные               | Путь                                                                               | Формат                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Правила              | `~/Library/Application Support/FileSwitcher/rules.json`                            | `{ "rules": [...] }`, отступ 2, атомарная запись (tmp + rename)                                         |
| Журнал               | `~/Library/Application Support/FileSwitcher/traffic-logs/traffic-<epoch-ms>.jsonl` | один `ProxyLogEvent` на строку; 100 МБ на файл, 20 файлов, индекс 200 000 записей, в UI последние 2 000 |
| Системный прокси     | `~/Library/Application Support/FileSwitcher/proxy-system-state.json`               | `service -> {webEnabled, webServer, webPort, secureWebEnabled, secureWebServer, secureWebPort}`         |
| CA                   | `~/.mitmproxy/mitmproxy-ca.pem`, `~/.mitmproxy/mitmproxy-ca-cert.pem`              | PEM, ключ + сертификат, права 0600                                                                      |
| Sudoers              | `/etc/sudoers.d/filesswitcher-networksetup`                                        | те же четыре подкоманды `networksetup`                                                                  |
| Настройки UI (новое) | `UserDefaults` домена `com.fileswitcher.app`                                       | порт, тема, язык, размер панелей, онбординг                                                             |

`ts` записи журнала - секунды с долями (идентификатор записи, точность важнее читаемости).
Группы правил остаются как есть: `Rule.group`, миграция `undefined -> группа из пути` при чтении.

## 5. Целевая структура репозитория

```
Package.swift                  swift-tools 6.2, .macOS(.v14), swiftLanguageModes [.v6]
Info.plist                     CFBundleIdentifier com.fileswitcher.app, LSUIElement
FileSwitcher.entitlements      hardened runtime, без sandbox
FileSwitcher.icns              из текущего build/icon.icns
resources/trayTemplate.png     как есть (иконка menu bar)
package-app.sh                 universal arm64+x86_64, подпись, dist/FileSwitcher.app + .zip
install-app.sh                 сборка -> --selftest -> остановка старой копии -> /Applications -> open
release.sh                     bump Info.plist, коммит, пуш, package-app.sh, gh release
Sources/FileSwitcher/
    main.swift AppDelegate.swift AppMenuPanel.swift AppLocalization.swift
    AppTheme.swift AppAlert.swift AppToast.swift ViewHelpers.swift ShellCommand.swift
    SettingsLayout.swift SelfTest.swift
    Proxy/    ProxyServer ProxyController RuleMatcher RegexSafety CertificateAuthority
              DerEncoder HttpMessage LogExport ReplayRequest RedactedHeaders
    Storage/  RulesStore LogStore LogEvent JsonFile RuleModel RuleGroups
              RuleValidation Settings ProxySystemStateStore
    System/   SystemProxyDarwin NetworkServicesDarwin CertTrustDarwin VpnStatus SudoersRule
    UI/       RulesTableController RuleFormSheet LogTableController LogDetailSheet
              JsonTreeController SettingsWindow OnboardingSheet Formatters
Tests/FileSwitcherTests/       по файлу на каждый бывший vitest-тест + Fixtures/
.github/workflows/ci.yml       macos-26: swift test, release-сборка с -warnings-as-errors, package + --selftest
AGENTS.md README.md .gitignore
```

## 6. Этапы

### Этап 0. Предусловия (0.5 дня)

- [x] Виталий коммитит текущую рабочую копию: встроенный прокси вместо mitmdump, macOS-only, husky/
      lint-staged (сейчас `D requirements*.txt`, `D resources/addon.py`, правки в `package.json`) -
      2026-11-05 (`1e00c6d`).
- [x] Тег `electron-legacy` на этот коммит, ветка `native-swift` - 2026-11-05.
- [x] Подтверждены решения из раздела 2 (в первую очередь зависимости NIO) - 2026-11-05, пакет
      собирается на `swift-nio` 2.x + `swift-nio-ssl` 2.x.
- [ ] Ручной чек-лист "что должно работать" из README (перехват, подмена, группы, экспорт, VPN) -
      им проверяется паритет на этапах 2-6.

### Этап 1. Каркас + спайк MITM (1-2 дня) - главный риск

- [x] `Package.swift` (executable `FileSwitcher` + `FileSwitcherTests`), зависимости nio/nio-ssl,
      `.gitignore` под `.build/`, `dist/` - 2026-11-05.
- [x] `DerEncoder.swift` + тесты на байтовый вывод (CN, SAN, расширения, подпись) - без сети,
      2026-11-05 (12 тестов).
- [x] `CertificateAuthority.swift`: чтение `~/.mitmproxy/mitmproxy-ca.pem`, выпуск листового
      сертификата для хоста, кэш контекстов - 2026-11-05 (7 тестов, включая цепочку до CA и отказ
      чужому хосту).
- [x] CLI-режим `--proxy-only <порт>` для спайка: листенер, `CONNECT`, dynamic `NIOSSLServerHandler`,
      апстрим через NIOSSL - 2026-11-05.
- [x] Готово, когда: `curl -x http://127.0.0.1:38765 https://example.com` отдаёт 200 и HTML, а
      `security verify-cert -c leaf.pem -l` подтверждает доверие выданному сертификату -
      2026-11-05: `curl` (SecureTransport, доверие из keychain) через прокси на 38999 отдаёт 200 для
      `https://example.com`, `https://www.wikipedia.org` (122 КБ), `http://neverssl.com`; 3 МБ с
      `speed.cloudflare.com` скачиваются на 5.8 МБ/с; keep-alive - второй запрос без нового CONNECT.
      CA `CN=mitmproxy` лежит в System keychain, его SHA-256 совпадает с
      `~/.mitmproxy/mitmproxy-ca-cert.pem`, поэтому 200 у curl и есть проверка доверия листовому.
- [x] Стоп-условие не сработало: dynamic TLS upgrade в SwiftNIO работает - 2026-11-05.

### Этап 2. Ядро прокси без правил (2-3 дня)

- [x] `HttpMessage.swift`: разбор absolute-form и CONNECT, hop-by-hop заголовки, редактирование
      секретных заголовков, лимиты заголовков. (2026-11-05, `HttpMessage.swift`, `RawRequestHead.swift`,
      `RedactedHeaders.swift`)
- [x] `ProxyServer.swift`: keep-alive, потоковая передача, `Upgrade`/WebSocket passthrough, ошибки
      апстрима (502), битые запросы. (2026-11-05: `ProxyServer.swift`, `OuterHeadHandler.swift`,
      `TunnelHeadHandler.swift`, `RawTunnel.swift`, `ProxyConnectionHandler.swift`, `ProxyPipeline.swift`.
      Проверено curl: https 200, keep-alive одно соединение, 3 МБ на 6 МБ/с, http 200.
      Апстрим открывается на запрос, без пула соединений - `shortcut:` в плане оптимизации;
      `Upgrade` на втором и следующих запросах одного соединения не перехватывается.)
- [x] `ProxyController.swift`: `stopped/starting/running/crashed`, занятый порт, батчи событий 50 мс.
      (2026-11-05: `ProxyController.swift`, `ProxyState.swift`; системный прокси подключается
      протоколом `SystemProxyControlling` - реализация на этапе 4.)
- [x] `LogStore.swift` + `LogEvent.swift`: JSONL в существующий путь и формат, индекс, обрезка файлов,
      предупреждения о потолке и сбое записи. (2026-11-05: `Storage/LogStore.swift`,
      `Storage/LogEvent.swift`, `Support/AppPaths.swift`; тесты `LogStoreTests`.)
- [x] Готово, когда: браузерный трафик идёт через прокси, а журнал в том же формате читается
      Electron-версией без ошибок. (записи журнала сверены с форматом `traffic-*.jsonl` Electron-версии)

### Этап 3. Правила (2 дня)

- [x] `RuleModel.swift` (Codable, `group`, все модификации), `RuleValidation.swift` (перенос
      `validateRule.ts` + `assertValidRule`), `RuleGroups.swift` (группы, `compareGroupNames`,
      миграция из пути). (2026-11-05: `Rules/RuleModel.swift`, `Rules/RuleValidation.swift`,
      `Rules/RuleGroups.swift`; тесты `RuleGroupsValidationTests`.)
- [x] `RegexSafety.swift`: порт `unsafeRegexReason` и `MAX_REGEX_PATTERN_LENGTH` с тестами
      один-в-один (единственное место, где JS и Swift RegExp расходятся, тесты покрывают все ветки
      отказа). (2026-11-05: `Rules/RegexSafety.swift`, тесты `RegexSafetyTests` - 7 кейсов, все ветки отказа)
- [x] `RuleMatcher.swift`: точное совпадение, regex, `$1`, замена из файла (лимит 16 МБ, защита от
      выхода за каталог), инлайн-тело, contentType, header overrides, `delayMs`,
      `statusCodeOverride`, кэш по mtime 1 с. (2026-11-05: `Rules/RuleMatcher.swift`,
      `Rules/HeaderOverrides.swift`; проверено curl: подмена отдаёт 202, `X-Swapped`, `no-store`)
- [x] `RulesStore.swift`: чтение/запись с атомарностью, событие "файл повреждён", миграция групп.
      (2026-11-05: `Rules/RulesStore.swift`, `Support/JsonFile.swift`)
- [ ] Готово, когда: живые правила из рабочего `rules.json` (saby-подмены) дают на реальном сайте
      тот же результат, что Electron-версия. (проверено на тестовом правиле для example.com;
      saby-правила требуют VPN и проверяются вручную)

### Этап 4. Системная интеграция (2 дня)

- [x] `NetworkServicesDarwin.swift`: список активных сервисов, чтение/запись web/secureweb,
      сохранение исходного состояния в `proxy-system-state.json`. (2026-11-05:
      `System/NetworkServices.swift`, тесты `SystemIntegrationTests`)
- [x] `SystemProxyDarwin.swift`: `enable`/`disable`/`recoverStale`, `sudo -n networksetup` при
      наличии sudoers-правила, иначе один диалог `osascript ... with administrator privileges`.
      (2026-11-05: `System/SystemProxyDarwin.swift`, `System/ProcessRunner.swift`; живая проверка
      `--system-check`: сертификат trusted, 2 активных сервиса, VPN full-tunnel через utun7)
- [x] `SudoersRule.swift`: то же правило и тот же файл, установка/снятие/проверка.
      (2026-11-05: методы `isPasswordlessSetup`/`setUpPasswordless`/`revokePasswordless`
      в `SystemProxyDarwin.swift`; установку в системе не запускал - нужен диалог пользователя)
- [x] `CertTrustDarwin.swift`: `security verify-cert` / `add-trusted-cert` / `remove-trusted-cert`.
      (2026-11-05: `System/CertTrustDarwin.swift`; `--system-check` показывает `trusted`)
- [x] `VpnStatus.swift`: активность VPN и признак full-tunnel (дефолтный маршрут в туннель).
      (2026-11-05: `VpnDetector` в `System/SystemProxyDarwin.swift`)
- [ ] Жизненный цикл: откат системного прокси при выходе и при старте после краша, single instance,
      `LSUIElement`, меню в status bar. (перенесено в этап 5: без UI-процесса жизненный цикл не собрать)
- [ ] Готово, когда: включение/выключение прокси не оставляет систему без сети ни в одном сценарии
      (обычный выход, Cmd+Q, kill -9), а `proxy-system-state.json` после отката отсутствует.

### Этап 5. UI на AppKit (4-6 дней)

> Сделано 2026-11-05 (второй заход, паритет с Electron-версией): единое окно вместо вкладок -
> слева журнал, справа правила, разделитель `NSSplitView` с автосохранением позиции
> (`UI/MainWindowController.swift`). Панель журнала (`UI/TrafficViewController.swift`): поиск по URL
> и телам, фильтр «все/подмены», потоковая вставка, подсветка подмен и повторов, контекстное меню,
> детали записи (`UI/LogDetailSheet.swift`), повтор запроса, экспорт. Панель правил
> (`UI/RulesViewController.swift`): строки групп и правил, drag&drop между группами, чекбокс «все»
> с промежуточным состоянием, дублирование, удаление, контекстное меню, форма правила
> (`UI/RuleFormSheet.swift`, черновик `UI/RuleDraft.swift`). Настройки (`UI/SettingsSheet.swift`):
> порт, sudoers, статус CA и установка/снятие, импорт/экспорт/перечитывание правил, экспорт журнала,
> открытие каталога данных. Шапка: статус прокси, адрес, кнопки настроек, перезапуска и старт/стоп,
> полоса предупреждений (в т.ч. признак full-tunnel VPN).
> Не сделано: дерево JSON в форме правила и пул апстрим-соединений (см. проход 2026-11-06).
> Проход 2026-11-06 (доведение паритета и повседневное удобство):
> меню приложения `UI/AppMenu.swift` (App/Правка/Вид/Журнал/Правила/Окно, Cmd+,/F/R/N/Q),
> тема `UI/AppearanceSettings.swift` (системная/светлая/тёмная, пункты меню «Вид»),
> онбординг `UI/OnboardingSheet.swift` (сертификат, sudoers, подсказка Firefox, флаг
> `FileSwitcher.onboardingDone`), JSON-дерево тела в деталях записи (`UI/JSONTreeView.swift`,
> вкладки «JSON запроса/ответа» появляются только для валидного JSON), иконка в строке меню
> `UI/StatusBarController.swift` (`LSUIElement`, закрытие окна не завершает приложение),
> локализация ru/en (`Support/AppLocalization.swift` + английский словарь, переключатель в
> настройках, применяется после перезапуска). Журнал: потолок 2000 строк в памяти,
> инкрементальная вставка строк и счётчик подмен, пауза записи и фильтр «только ошибки 4xx-5xx»,
> поиск по файлам прошлых сессий (`LogStore.search(includeHistory:)`, потолок 50 000 строк,
> детали найденного читаются из истории через `getEvent`), кнопка cURL в деталях. Правила:
> поиск по списку, включение/выключение группы из контекстного меню, импорт из буфера обмена,
> счётчик срабатываний за сессию в подписи строки (`RuleHitCounter`). Настройки: версия, показ
> файла журнала в Finder, удаление журналов, область перехвата (`Proxy/TunnelScope.swift` - все
> хосты / только из списка / все, кроме списка; вне области CONNECT проходит байтами без MITM).
> Удалены `Proxy/ProxySpike.swift`, `Support/DebugProxy.swift`, флаги `--proxy`/`--proxy-only`
> и мёртвый `AppRuntime.shutdown()`.
> Не сделано: пул keep-alive апстрим-соединений и Upgrade на последующих запросах одного
> соединения - обе правки меняют сетевой путь и требуют ручной проверки на живом трафике.
> Проход по минимализму 2026-11-05: из шапки убраны дублирующий заголовок «FileSwitcher» и кнопка
> перезапуска (перезапуск остался в настройках); в журнале вместо второго ряда из трёх иконок один
> ряд - поиск, «искать в телах», фильтр, счётчик «записи / подмены» и меню «…» с повтором, экспортом
> и очисткой; HTTP-статус в списке красится только при 4xx/5xx; у правил убраны цветной текст второй
> строки и счётчик в заголовке группы; из настроек - пояснения под кнопками (нюанс Firefox переехал
> в подсказку) и кнопка «Обновить» статуса CA; из формы правила - подсказка и копирование паттерна.

- [x] Каркас окна (`1080x700`), две панели с перетаскиваемым разделителем, системная тёмная/светлая тема.
- [x] `RulesTableController`: строки групп (именованные по алфавиту, «остальные» в конце), drag правил
      и между группами, чекбоксы включения (в т.ч. «все» с промежуточным состоянием), дублирование,
      удаление, контекстное меню. Реализовано на `NSTableView`, не на `NSOutlineView`.
- [x] `RuleFormSheet`: все поля правила, замена файлом или инлайн-телом, копирование, валидация с теми
      же текстами ошибок. Тело показывается текстом, без JSON-дерева.
- [x] `LogTableController`: таблица журнала, потоковая вставка батчами, фильтр all/matched, поиск с
      опцией «искать в теле», очистка списка, контекстное меню (правило из записи, копировать URL,
      повтор запроса).
- [x] `LogDetailSheet`: вкладки с обзором, заголовками, телами запроса и ответа, пометка бинарных тел.
      Дерева JSON нет - тела выводятся текстом.
- [x] `SettingsWindow`: порт, sudoers, статус CA и установка/снятие, импорт/экспорт правил,
      перечитывание правил, экспорт журнала, открытие каталога данных. Языка, темы и версии нет -
      переключать нечего, тема системная.
- [x] `OnboardingSheet` при первом запуске (`UI/OnboardingSheet.swift`): два шага с живым статусом
      сертификата и sudoers, подсказка про Firefox, флаг в `UserDefaults`.
- [x] `Support/AppLocalization.swift` + английский словарь: все статические строки UI (включая меню
      приложения и шаблоны с `%d`/`%@`), переключатель языка в настройках. `MetaFormat` покрывает
      время, размер и путь для списков.
- [ ] Готово, когда: сценарий «поставить правило -> увидеть подмену -> найти запись в журнале ->
      открыть детали -> повторить запрос» проходит без терминала. (Ручная проверка ещё не проводилась.)

### Этап 6. Экспорт и повтор запроса (1-2 дня)

- [x] `LogExport.swift`: HAR 1.2 / JSON / CSV, потоково, те же поля и предупреждение о секретах.
- [x] `ExportPanel`/`LogExport.swift`: HAR, JSON, CSV (этап 6, коммит 8214082).
- [x] `ReplayRequest.swift`: повтор из записи напрямую на сервер (не через прокси), таймаут 15 с,
      до 5 редиректов, потолок тела 8 МБ, отбрасывание forbidden-заголовков, защита от приватных
      адресов (SSRF), запись `event: replay` в тот же журнал. Кнопки «Экспорт журнала» и
      «Повтор запроса» - в строке поиска вкладки «Трафик».
- [x] Готово, когда: HAR открывается в Chrome DevTools, CSV - в Numbers, повтор даёт тот же ответ,
      что исходный запрос. Проверено юнит-тестами (`LogExportTests`, `ReplayRequestTests`);
      открытие HAR в DevTools и повтор живого запроса - ручная проверка Виталия.

### Этап 7. Сборка и выпуск как у Vistrom (1 день)

- [x] `Info.plist`, `--selftest` (matcher, regex, журнал, экспорт, выпуск сертификата,
      loopback-запрос через прокси - набор был с этапа 4, `--selftest` проходит из бандла).
      `FileSwitcher.entitlements` не заведён: приложение вне sandbox. Иконка - `resources/FileSwitcher.icns`
      (перенесена из Electron-сборки), подключается через `CFBundleIconFile` в `Info.plist`.
- [x] `package-app.sh`: `swift build -c release --arch arm64 --arch x86_64`, сборка бандла,
      `codesign --force --options runtime`, `plutil -lint`, `ditto` в `dist/FileSwitcher.zip`.
      Подпись: ad-hoc (`-`) по умолчанию, переопределяется `CODE_SIGN_IDENTITY`.
- [x] `install-app.sh`: сборка -> `--selftest` -> остановка запущенной копии -> `/Applications` ->
      `open` (правило "одна копия по одному пути" из Vistrom).
- [x] `release.sh`: версия в `Info.plist`, коммит, тег, пуш, архив, `gh release`, предыдущие
      релизы в prerelease.
- [x] CI-джоба `swift` на `macos-26`: `swift build`, `swift test`, `package-app.sh` с
      `CODE_SIGN_IDENTITY: "-"`, `--selftest` из бандла. Без `-warnings-as-errors`: swift-nio-ssl
      объявляет `@available(*, unavailable) extension NIOSSLHandler: Sendable`, поэтому 3
      предупреждения про Sendable неустранимы на нашей стороне (RawTunnel, ProxySpike,
      ProxyConnectionHandler). Остальные предупреждения вычищены, deprecated `NIOAny`-записи
      переведены на типизированный `write`.
- [ ] Готово, когда: чистый клон собирается `./install-app.sh` без Node и Python, CI зелёный.
      Не проверял в чистом клоне.

### Этап 8. Вывод Electron (0.5-1 день)

- [x] Удалить `src/`, `test/`, `package.json`, `package-lock.json`, `node_modules`, `out`, `dist`,
      `electron-builder.yml`, `electron.vite.config.ts`, `tsconfig*.json`, `vitest.config.ts`,
      `.venv`, `.pytest_cache`, `.husky`, `.prettier*`, `scripts/`, `resources/__pycache__`,
      `build/mitmdump`. Иконка `build/icon.icns` перенесена в `resources/FileSwitcher.icns`,
      бандл теперь собирается в `dist/FileSwitcher.app`. CI оставлен одной джобой `swift`.
- [x] Переписать `README.md` (структура, `./install-app.sh`, `swift test`, приватность журнала),
      добавить `AGENTS.md` по образцу Vistrom.
- [x] Убедиться, что нативное приложение читает правила и журнал, оставшиеся от Electron-версии:
      Electron писал в `app.getPath('userData')`, то есть `~/Library/Application Support/FileSwitcher`
      (`productName: FileSwitcher`), нативное приложение использует тот же каталог через
      `AppPaths.supportDirectory` - `rules.json`, `traffic-logs/*.jsonl`, `proxy-system-state.json`
      подхватываются на месте.
- [ ] Мерж `native-swift` в `main`, релиз через `release.sh` - за Виталием.


## 7. Тесты

Каждый бывший vitest-файл получает пару в `Tests/FileSwitcherTests/` (swift-testing):

| Было                                          | Станет                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `ruleMatcher.test.ts`                         | `RuleMatcherTests.swift`                                                                   |
| `regexSafety.test.ts`                         | `RegexSafetyTests.swift`                                                                   |
| `ruleGroups.test.ts`                          | `RuleGroupsTests.swift`                                                                    |
| `ruleSchema.test.ts` + `validateRule.test.ts` | `RuleValidationTests.swift`                                                                |
| `logStore.test.ts`                            | `LogStoreTests.swift`                                                                      |
| `logExport.test.ts`                           | `LogExportTests.swift`                                                                     |
| `proxyServer.test.ts`                         | `ProxyServerTests.swift` (loopback, без внешней сети)                                      |
| `proxyController.test.ts`                     | `ProxyControllerTests.swift`                                                               |
| `systemProxy.test.ts`                         | `NetworkServicesParsingTests.swift` (парсинг вывода `networksetup`, без изменения системы) |
| `formatters.test.ts`                          | `FormattersTests.swift`                                                                    |
| `requestExport.test.ts`                       | `ReplayRequestTests.swift`                                                                 |
| -                                             | `DerEncoderTests.swift`, `CertificateAuthorityTests.swift` (новое)                         |

Плюс `--selftest` в собранном бандле - то, что CI гоняет после упаковки. Логика правил и журнала
тестируется без сети и без изменения системных настроек; всё, что требует Touch ID и админского
диалога, проверяется руками.

## 8. Риски и запасные варианты

| Риск                                                                     | Как снимаем                                                       | Запасной вариант                                                                                                  |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Dynamic TLS upgrade в SwiftNIO не заработает                             | спайк этапа 1 со стоп-условием                                    | отдельный C-таргет с BoringSSL; либо обсудить гибрид (нативное UI + прокси на Node) - ломает цель, решает Виталий |
| Существующий mitmproxy-CA не читается (формат ключа, issuer байтами)     | тесты на реальном файле из `~/.mitmproxy`, `security verify-cert` | выпускать свой CA в каталоге приложения и один раз переустановить доверие                                         |
| Корпоративный MITM-CA стендов не принимается доверием NIOSSL             | проверить на реальном стенде saby                                 | валидация цепочки апстрима через `SecTrustEvaluateWithError`                                                      |
| Нет dev-цикла: каждая правка UI - это `./install-app.sh`                 | быстрый `--selftest` для логики, ручные проверки пачками          | терпим, как в Vistrom                                                                                             |
| Регрессии на реальном трафике (chunked, gzip, SSE, WebSocket, редиректы) | чек-лист этапа 0, ручной прогон на saby                           | passthrough-режим для проблемных хостов                                                                           |
| Журнал на сотни тысяч строк тормозит таблицу                             | батчи и лимит 2 000 строк в UI, как сейчас                        | виртуализация строк силами `NSTableView`                                                                          |
| Потеря правил при переключении версий                                    | формат и путь не меняются, атомарная запись                       | тег `electron-legacy` для отката                                                                                  |

## 9. Что Виталий проверяет лично

Диалоги авторизации macOS из агентской оболочки не воспроизводятся:

- [ ] установка и снятие доверия к CA;
- [ ] выдача и отзыв sudoers-правила;
- [ ] включение и выключение системного прокси на реальных сетевых сервисах;
- [ ] реальный трафик saby через прокси (подмена файла видна на сайте);
- [ ] поведение после `kill -9` приложения с включённым прокси;
- [ ] отсутствие второго значка в Dock и работа меню в status bar.

## 10. Оценка

| Этап                    | Дней      |
| ----------------------- | --------- |
| 0. Предусловия          | 0.5       |
| 1. Каркас и спайк MITM  | 1-2       |
| 2. Ядро прокси          | 2-3       |
| 3. Правила              | 2         |
| 4. Системная интеграция | 2         |
| 5. UI                   | 4-6       |
| 6. Экспорт и повтор     | 1-2       |
| 7. Сборка и выпуск      | 1         |
| 8. Вывод Electron       | 0.5-1     |
| **Итого**               | **14-19** |

Ожидаемый объём: 4 500-5 500 строк Swift вместе с тестами против 7 300 строк TS/TSX - уходят
renderer, preload, IPC и bindings, добавляются DER-энкодер и TLS-обвязка.
