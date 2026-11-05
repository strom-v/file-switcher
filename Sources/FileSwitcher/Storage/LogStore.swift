import Foundation

/// Хранилище журнала трафика: полные события пишутся построчным JSON в файл сессии, в памяти
/// держится лёгкий индекс (метаданные и положение строки в файле)
final class LogStore: @unchecked Sendable {
    static let shared = LogStore()

    // сколько последних записей отдаём в UI при первичной загрузке — лимит отображения, не хранения
    private let recentLimit = 2000
    // потолок файла сессии: журнал содержит тела и заголовки всего трафика и растёт без предела
    private let maxSessionFileBytes = 100 * 1024 * 1024
    // сколько файлов прошлых сессий держим на диске
    private let keepSessionFiles = 20
    // потолок индекса в памяти (~200 байт на запись)
    private let maxIndexEntries = 200_000
    // сколько строк прошлых сессий просматривает поиск по истории
    private let historyLineLimit = 50_000

    /// Запись индекса: лёгкие поля для списка и положение полной строки в файле
    private struct IndexEntry {
        var meta: LogEntryMeta
        var byteOffset: Int
        var byteLength: Int
    }

    private let lock = NSLock()
    private let fileURL: URL
    private var writeHandle: FileHandle?
    private var bytesWritten = 0
    private var sizeLimitReached = false
    private var sizeLimitWarned = false
    private var diskLoggingError: String?
    private var diskLoggingWarning: String?
    private var index: [IndexEntry] = []
    private var searchGeneration = 0

    init(directory: URL = AppPaths.trafficLogDirectory) {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        LogStore.pruneOldSessionFiles(in: directory, keep: 20)
        let stamp = Int(Date().timeIntervalSince1970 * 1000)
        fileURL = directory.appendingPathComponent("traffic-\(stamp).jsonl")
    }

    /// Путь к append-only файлу текущей сессии
    var filePath: String {
        fileURL.path
    }

    /// Оставляет на диске только свежие файлы сессий
    private static func pruneOldSessionFiles(in directory: URL, keep: Int) {
        let manager = FileManager.default
        guard let names = try? manager.contentsOfDirectory(atPath: directory.path) else {
            return
        }
        let sessionFiles = names
            .filter { name in
                name.hasPrefix("traffic-") && name.hasSuffix(".jsonl")
            }
            .sorted()
        guard sessionFiles.count > keep else {
            return
        }
        for name in sessionFiles.prefix(sessionFiles.count - keep) {
            try? manager.removeItem(at: directory.appendingPathComponent(name))
        }
    }

    /// true, если в сессии есть хоть одна записанная на диск строка
    func hasExportableEvents() -> Bool {
        lock.lock()
        defer {
            lock.unlock()
        }
        return bytesWritten > 0
    }

    /// true один раз за сессию — когда файл впервые упёрся в потолок размера
    func consumeSizeLimitWarning() -> Bool {
        lock.lock()
        defer {
            lock.unlock()
        }
        if !sizeLimitReached || sizeLimitWarned {
            return false
        }
        sizeLimitWarned = true
        return true
    }

    /// Возвращает предупреждение об отключении дискового журнала только один раз
    func consumeDiskLoggingWarning() -> String? {
        lock.lock()
        defer {
            lock.unlock()
        }
        let warning = diskLoggingWarning
        diskLoggingWarning = nil
        return warning
    }

    /// Дописывает пачку событий в файл и возвращает их лёгкие версии для списка
    func appendBatch(_ events: [ProxyLogEvent]) -> [LogEntryMeta] {
        guard !events.isEmpty else {
            return []
        }
        let lines = events.map { event -> (String, Int) in
            let line = LogStore.encodeLine(event)
            return (line, line.utf8.count)
        }

        lock.lock()
        defer {
            lock.unlock()
        }

        let writeStartOffset = bytesWritten
        var writtenInBatch = 0
        if diskLoggingError == nil {
            var payload = ""
            for (line, byteLength) in lines {
                if writeStartOffset + writtenInBatch + byteLength <= maxSessionFileBytes {
                    payload += line
                    writtenInBatch += byteLength
                } else {
                    // потолок размера: остаток пачки уходит в список, но на диск уже не пишется
                    sizeLimitReached = true
                    break
                }
            }
            if !payload.isEmpty {
                do {
                    try writeLine(payload)
                    bytesWritten += writtenInBatch
                } catch {
                    disableDiskLogging(error)
                    writtenInBatch = 0
                }
            }
        }

        var metas: [LogEntryMeta] = []
        var offsetCursor = writeStartOffset
        for (offset, event) in events.enumerated() {
            let byteLength = lines[offset].1
            // byteLength 0 означает "строки нет в файле": доступ к телам вернёт nil
            let isOnDisk = offsetCursor + byteLength <= writeStartOffset + writtenInBatch
            let entry = IndexEntry(
                meta: event.meta(),
                byteOffset: isOnDisk ? offsetCursor : 0,
                byteLength: isOnDisk ? byteLength : 0
            )
            if isOnDisk {
                offsetCursor += byteLength
            }
            index.append(entry)
            metas.append(entry.meta)
        }
        if index.count > maxIndexEntries {
            index.removeFirst(index.count - maxIndexEntries)
        }
        return metas
    }

    /// Полное событие с этим ts — читает одну строку из файла по смещению из индекса
    func getEvent(ts: Double) -> ProxyLogEvent? {
        lock.lock()
        let entry = index.first { $0.meta.ts == ts }
        lock.unlock()

        guard let entry else {
            return eventFromHistory(ts: ts)
        }
        guard entry.byteLength > 0 else {
            return nil
        }
        guard let handle = try? FileHandle(forReadingFrom: fileURL) else {
            return nil
        }
        defer {
            try? handle.close()
        }
        do {
            try handle.seek(toOffset: UInt64(entry.byteOffset))
            guard let data = try handle.read(upToCount: entry.byteLength), data.count == entry.byteLength else {
                return nil
            }
            return try JSONDecoder().decode(ProxyLogEvent.self, from: data)
        } catch {
            return nil
        }
    }

    /// Последние записи для первичной отрисовки списка
    func getRecent() -> [LogEntryMeta] {
        lock.lock()
        defer {
            lock.unlock()
        }
        return index.suffix(recentLimit).map(\.meta)
    }

    /// Метаданные записей, чьи url/method/тело содержат query (по телу — только с поиском в теле).
    /// С includeHistory читаются и строки прошлых сессий. Синхронный: чтение тысяч строк
    /// вызывающий выполняет в фоне.
    func search(query: String, searchInBody: Bool, includeHistory: Bool = false) -> [LogEntryMeta] {
        lock.lock()
        searchGeneration += 1
        let generation = searchGeneration
        let searchable = Array(index.suffix(recentLimit))
        lock.unlock()

        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if needle.isEmpty {
            return searchable.map(\.meta)
        }

        var matchedTs = Set(
            searchable
                .filter { entry in
                    entry.meta.url.lowercased().contains(needle)
                        || (entry.meta.event == .matched && entry.meta.file.lowercased().contains(needle))
                }
                .map(\.meta.ts)
        )
        if searchInBody {
            matchedTs = searchBodies(needle: needle, entries: searchable, alreadyMatched: matchedTs)
            if isSearchStale(generation) {
                return []
            }
        }
        var result = searchable.filter { matchedTs.contains($0.meta.ts) }.map(\.meta)
        guard includeHistory else {
            return result
        }
        var known = Set(result.map(\.ts))
        for meta in searchHistoryFiles(needle: needle, searchInBody: searchInBody, generation: generation) {
            guard !known.contains(meta.ts) else {
                continue
            }
            known.insert(meta.ts)
            result.append(meta)
        }
        return result
    }

    /// Файлы прошлых сессий на диске, от новых к старым
    private func historyFiles() -> [URL] {
        let directory = fileURL.deletingLastPathComponent()
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: directory.path) else {
            return []
        }
        let current = fileURL.lastPathComponent
        return names
            .filter { $0.hasPrefix("traffic-") && $0.hasSuffix(".jsonl") && $0 != current }
            .sorted(by: >)
            .map { directory.appendingPathComponent($0) }
    }

    /// Поиск по строкам прошлых сессий: сначала отсев по тексту строки, потом точная сверка полей
    private func searchHistoryFiles(needle: String, searchInBody: Bool, generation: Int) -> [LogEntryMeta] {
        var found: [LogEntryMeta] = []
        var budget = historyLineLimit
        for url in historyFiles() {
            guard budget > 0, !isSearchStale(generation) else {
                break
            }
            var read = 0
            LogStore.forEachLine(in: url, limit: budget) { line in
                read += 1
                if isSearchStale(generation) {
                    return false
                }
                guard line.lowercased().contains(needle),
                      let event = LogStore.decodeEvent(line),
                      LogStore.eventMatches(event, needle: needle, searchInBody: searchInBody) else {
                    return true
                }
                found.append(event.meta())
                return true
            }
            budget -= read
        }
        return found
    }

    /// Полная запись по времени из файлов прошлых сессий
    private func eventFromHistory(ts: Double) -> ProxyLogEvent? {
        var found: ProxyLogEvent?
        for url in historyFiles() {
            LogStore.forEachLine(in: url, limit: historyLineLimit) { line in
                guard let event = LogStore.decodeEvent(line) else {
                    return true
                }
                guard abs(event.ts - ts) < 0.0005 else {
                    return true
                }
                found = event
                return false
            }
            if found != nil {
                break
            }
        }
        return found
    }

    /// Читает файл построчно, пока обработчик не вернёт false
    private static func forEachLine(in url: URL, limit: Int, _ body: (String) -> Bool) {
        guard let handle = try? FileHandle(forReadingFrom: url) else {
            return
        }
        defer {
            try? handle.close()
        }
        var remainder = Data()
        var read = 0
        while read < limit {
            guard let chunk = try? handle.read(upToCount: 1 << 20), !chunk.isEmpty else {
                break
            }
            remainder.append(chunk)
            while let newline = remainder.firstIndex(of: 0x0A) {
                let lineData = remainder[remainder.startIndex..<newline]
                remainder = Data(remainder[remainder.index(after: newline)...])
                read += 1
                guard let line = String(data: lineData, encoding: .utf8) else {
                    continue
                }
                guard body(line) else {
                    return
                }
            }
        }
    }

    /// Разбирает строку журнала
    private static func decodeEvent(_ line: String) -> ProxyLogEvent? {
        guard let data = line.data(using: .utf8) else {
            return nil
        }
        return try? JSONDecoder().decode(ProxyLogEvent.self, from: data)
    }

    /// Совпадает ли запись с поисковой строкой по url, файлу подмены и телам
    private static func eventMatches(_ event: ProxyLogEvent, needle: String, searchInBody: Bool) -> Bool {
        if event.url.lowercased().contains(needle) {
            return true
        }
        if event.event == .matched, event.file.lowercased().contains(needle) {
            return true
        }
        guard searchInBody else {
            return false
        }
        return event.requestBody.lowercased().contains(needle)
            || event.responseBody.lowercased().contains(needle)
    }

    /// Строка файла сессии: JSON без переводов строки
    private static func encodeLine(_ event: ProxyLogEvent) -> String {
        let encoder = JSONEncoder()
        guard let data = try? encoder.encode(event), let json = String(data: data, encoding: .utf8) else {
            return "{}"
        }
        // Foundation экранирует слэши как "\/", в журнале это лишний шум
        return json.replacingOccurrences(of: "\\/", with: "/") + "\n"
    }

    /// Дописывает строку в файл сессии, открывая его при первой записи
    private func writeLine(_ text: String) throws {
        if writeHandle == nil {
            if !FileManager.default.fileExists(atPath: fileURL.path) {
                FileManager.default.createFile(atPath: fileURL.path, contents: nil)
            }
            writeHandle = try FileHandle(forWritingTo: fileURL)
            try writeHandle?.seekToEnd()
        }
        try writeHandle?.write(contentsOf: Data(text.utf8))
    }

    /// Отключает запись на диск после первой ошибки файловой системы
    private func disableDiskLogging(_ error: some Error) {
        guard diskLoggingError == nil else {
            return
        }
        let message = error.localizedDescription
        diskLoggingError = message
        diskLoggingWarning = "Запись traffic-log на диск отключена: \(message)"
        try? writeHandle?.close()
        writeHandle = nil
    }

    /// Поиск по телам: читает строки по индексу
    private func searchBodies(
        needle: String,
        entries: [IndexEntry],
        alreadyMatched: Set<Double>
    ) -> Set<Double> {
        var matched = alreadyMatched
        let pending = entries.filter { !matched.contains($0.meta.ts) && $0.byteLength > 0 }
        guard !pending.isEmpty, let handle = try? FileHandle(forReadingFrom: fileURL) else {
            return matched
        }
        defer {
            try? handle.close()
        }
        for entry in pending {
            guard let event = LogStore.readEvent(handle: handle, entry: entry) else {
                continue
            }
            if event.requestBody.lowercased().contains(needle) || event.responseBody.lowercased().contains(needle) {
                matched.insert(entry.meta.ts)
            }
        }
        return matched
    }

    /// Читает индексированную строку по смещению и разбирает её
    private static func readEvent(handle: FileHandle, entry: IndexEntry) -> ProxyLogEvent? {
        do {
            try handle.seek(toOffset: UInt64(entry.byteOffset))
            guard let data = try handle.read(upToCount: entry.byteLength), data.count == entry.byteLength else {
                return nil
            }
            return try JSONDecoder().decode(ProxyLogEvent.self, from: data)
        } catch {
            return nil
        }
    }

    /// true, если за время поиска был запущен более новый — старый результат уже не нужен
    private func isSearchStale(_ generation: Int) -> Bool {
        lock.lock()
        defer {
            lock.unlock()
        }
        return generation != searchGeneration
    }
}
