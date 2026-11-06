import Foundation
import NIOCore
import NIOPosix

/// Управляет встроенным прокси-сервером: запуск, остановка, системный прокси, журнал
@MainActor
final class ProxyController {
    /// События уходят пачкой раз в этот интервал, а не по одному на каждый запрос
    private static let logBatchInterval = Duration.milliseconds(50)

    private static let logSizeLimitMessage =
        "Файл лога сессии достиг 100 МБ - новые запросы больше не сохраняются на диск (в списке отображаются). Экспортируйте лог и перезапустите приложение, чтобы начать новый файл."

    private let authority: CertificateAuthority
    private let group: any EventLoopGroup
    private let store: LogStore
    private let systemProxy: any SystemProxyControlling
    private let makeRuleEngine: @Sendable () -> (any RuleEngine)?

    private var server: ProxyServer?
    private var pendingLogs: [ProxyLogEvent] = []
    private var flushTask: Task<Void, Never>?
    /// Очередь записи пачек журнала: диск пишется в фоне, но пачки идут строго по порядку
    private var logWriteChain: Task<Void, Never> = Task {}
    private var shownWarnings: Set<String> = []
    private var systemProxyChain: Task<Void, Never> = Task {}

    /// Текущее состояние прокси
    private(set) var state = ProxyState(status: .stopped, port: defaultProxyPort)

    /// Сообщает интерфейсу о смене состояния
    var onStateChange: (@MainActor (ProxyState) -> Void)?
    /// Отдаёт интерфейсу новые записи журнала
    var onLogBatch: (@MainActor ([LogEntryMeta]) -> Void)?
    /// Сообщает интерфейсу о предупреждении
    var onWarning: (@MainActor (String) -> Void)?

    init(
        authority: CertificateAuthority,
        group: any EventLoopGroup,
        store: LogStore,
        systemProxy: any SystemProxyControlling,
        makeRuleEngine: @escaping @Sendable () -> (any RuleEngine)?
    ) {
        self.authority = authority
        self.group = group
        self.store = store
        self.systemProxy = systemProxy
        self.makeRuleEngine = makeRuleEngine
    }

    /// Запускает прокси на порту
    func start(port: Int = defaultProxyPort) {
        guard server == nil else {
            return
        }
        setState(ProxyState(status: .starting, port: port))
        shownWarnings.removeAll()

        let server = ProxyServer(
            authority: authority,
            group: group,
            ruleEngine: makeRuleEngine(),
            onLog: { [weak self] event in
                Task { @MainActor in
                    self?.queueLogEvent(event)
                }
            },
            onWarning: { [weak self] message in
                Task { @MainActor in
                    self?.showWarning(message)
                }
            }
        )
        self.server = server

        Task { [weak self] in
            do {
                try await server.start(host: proxyHost, port: port)
                guard let self, self.server === server else {
                    return
                }
                setState(ProxyState(status: .running, port: port))
                enqueueSystemProxy { [weak self] in
                    guard let self, self.server === server else {
                        return
                    }
                    do {
                        try await systemProxy.enable(host: proxyHost, port: port)
                    } catch {
                        emitWarning("Не удалось включить системный прокси автоматически: \(error.localizedDescription)")
                    }
                }
            } catch {
                guard let self, self.server === server else {
                    return
                }
                self.server = nil
                setState(ProxyState(status: .crashed, port: port, error: self.startErrorMessage(error, port: port)))
            }
        }
    }

    /// Останавливает прокси и возвращает системные настройки
    func stop() {
        flushPendingLogs()
        server?.stop()
        server = nil
        setState(ProxyState(status: .stopped, port: state.port))
        enqueueSystemProxy { [weak self] in
            guard let self else {
                return
            }
            do {
                try await systemProxy.disable()
            } catch {
                emitWarning("Не удалось восстановить системный прокси: \(error.localizedDescription)")
            }
        }
    }

    /// Останавливает прокси и ждёт, пока система и журнал вернутся в исходное состояние
    func stopAndWait() async {
        stop()
        await logWriteChain.value
        await systemProxyChain.value
    }

    /// Восстанавливает системный прокси после аварийного завершения прошлого запуска
    func recoverStaleSystemProxy() {
        enqueueSystemProxy { [weak self] in
            do {
                try await self?.systemProxy.recoverStale(host: proxyHost)
            } catch {
                self?.emitWarning("Не удалось восстановить системный прокси: \(error.localizedDescription)")
            }
        }
    }

    /// Отдаёт интерфейсу одну полную запись по её времени
    func event(ts: Double) -> ProxyLogEvent? {
        store.getEvent(ts: ts)
    }

    /// Последние записи для первичной отрисовки списка
    func recentEntries() -> [LogEntryMeta] {
        store.getRecent()
    }

    /// Записи, подходящие под фильтр по URL и телу
    func search(query: String, searchInBody: Bool, includeHistory: Bool = false) -> [LogEntryMeta] {
        store.search(query: query, searchInBody: searchInBody, includeHistory: includeHistory)
    }

    private func setState(_ next: ProxyState) {
        state = next
        onStateChange?(next)
    }

    /// Предупреждения движка показываем по разу за запуск, а не на каждый запрос
    private func showWarning(_ message: String) {
        guard !shownWarnings.contains(message) else {
            return
        }
        shownWarnings.insert(message)
        emitWarning(message)
    }

    private func emitWarning(_ message: String) {
        onWarning?(message)
    }

    /// Копит события в буфер и один раз за интервал пишет пачку в журнал
    private func queueLogEvent(_ event: ProxyLogEvent) {
        pendingLogs.append(event)
        guard flushTask == nil else {
            return
        }
        flushTask = Task { [weak self] in
            try? await Task.sleep(for: ProxyController.logBatchInterval)
            self?.flushPendingLogs()
        }
    }

    /// Забирает накопленные события, пишет пачку в файл и отдаёт интерфейсу метаданные
    private func flushPendingLogs() {
        flushTask?.cancel()
        flushTask = nil
        guard !pendingLogs.isEmpty else {
            return
        }
        let batch = pendingLogs
        pendingLogs = []
        let store = store
        let previous = logWriteChain
        // запись на диск идёт в фоне, но пачки не обгоняют друг друга: порядок в журнале сохраняется
        logWriteChain = Task { [weak self] in
            await previous.value
            let metas = await Task.detached(priority: .utility) {
                store.appendBatch(batch)
            }.value
            guard let self else {
                return
            }
            onLogBatch?(metas)
            if store.consumeSizeLimitWarning() {
                emitWarning(ProxyController.logSizeLimitMessage)
            }
            if let diskWarning = store.consumeDiskLoggingWarning() {
                emitWarning(diskWarning)
            }
        }
    }

    /// Последовательно выполняет изменения системного прокси
    private func enqueueSystemProxy(_ operation: @escaping @MainActor () async -> Void) {
        let previous = systemProxyChain
        systemProxyChain = Task { @MainActor in
            await previous.value
            await operation()
        }
    }

    /// Текст ошибки запуска с отдельным случаем занятого порта
    private func startErrorMessage(_ error: some Error, port: Int) -> String {
        let nsError = error as NSError
        if nsError.domain == NSPOSIXErrorDomain, nsError.code == Int(EADDRINUSE) {
            return "Порт \(port) уже занят другим процессом"
        }
        return "Прокси не запустился: \(error.localizedDescription)"
    }
}

/// Адрес, на котором слушает прокси
let proxyHost = "127.0.0.1"
/// Порт локального прокси по умолчанию
let defaultProxyPort = 38765
