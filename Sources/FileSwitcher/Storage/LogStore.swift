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
    /// Запись по её ts: детали открываются по времени, линейный поиск по индексу не нужен
    private var indexByTs: [Double: IndexEntry] = [:]
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
        let lines = LogStore.encodeLines(events)

        lock.lock()
        defer {
            lock.unlock()
        }

        let writeStartOffset = bytesWritten
        var writtenInBatch = 0
        if diskLoggingError == nil {
            var payload = Data()
            for line in lines {
                if writeStartOffset + writtenInBatch + line.count <= maxSessionFileBytes {
                    payload.append(line)
                    writtenInBatch += line.count
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
            let byteLength = lines[offset].count
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
            indexByTs[entry.meta.ts] = entry
            metas.append(entry.meta)
        }
        trimIndex()
        return metas
    }

    /// Держит индекс в пределах потолка, забывая самые старые записи
    private func trimIndex() {
        let extra = index.count - maxIndexEntries
        guard extra > 0 else {
            return
        }
        for entry in index.prefix(extra) {
            indexByTs.removeValue(forKey: entry.meta.ts)
        }
        index.removeFirst(extra)
    }

    /// Полное событие с этим ts — читает одну строку из файла по смещению из индекса
    func getEvent(ts: Double) -> ProxyLogEvent? {
        lock.lock()
        let entry = indexByTs[ts]
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
        return LogStore.readEvent(
            handle: handle,
            offset: entry.byteOffset,
            length: entry.byteLength,
            decoder: JSONDecoder()
        )
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
        let decoder = JSONDecoder()
        let needleBytes = Array(needle.utf8)
        for url in historyFiles() {
            guard budget > 0, !isSearchStale(generation) else {
                break
            }
            var read = 0
            LogStore.forEachLine(in: url, limit: budget) { lineData in
                read += 1
                if isSearchStale(generation) {
                    return false
                }
                guard LogStore.lineContains(lineData, needleBytes: needleBytes, needle: needle),
                      let event = LogStore.decodeEvent(lineData, decoder: decoder),
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
        let decoder = JSONDecoder()
        for url in historyFiles() {
            LogStore.forEachLine(in: url, limit: historyLineLimit) { lineData in
                guard let event = LogStore.decodeEvent(lineData, decoder: decoder) else {
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
    private static func forEachLine(in url: URL, limit: Int, _ body: (Data) -> Bool) {
        // файл сессии отдаётся отображением в память: построчные срезы не копируют остаток файла
        guard let data = try? Data(contentsOf: url, options: .mappedIfSafe) else {
            return
        }
        let end = data.endIndex
        var start = data.startIndex
        var read = 0
        while start < end, read < limit {
            read += 1
            guard let newline = data[start..<end].firstIndex(of: 0x0A) else {
                guard body(Data(data[start..<end])) else {
                    return
                }
                return
            }
            guard body(Data(data[start..<newline])) else {
                return
            }
            start = data.index(after: newline)
        }
    }

    /// Разбирает строку журнала
    private static func decodeEvent(_ lineData: Data, decoder: JSONDecoder) -> ProxyLogEvent? {
        try? decoder.decode(ProxyLogEvent.self, from: lineData)
    }

    /// Совпадение строки файла с поисковой строкой: ASCII проверяется по байтам без сборки String
    private static func lineContains(_ lineData: Data, needleBytes: [UInt8], needle: String) -> Bool {
        if let asciiResult = asciiContains(lineData, needleBytes: needleBytes) {
            return asciiResult
        }
        guard let line = String(data: lineData, encoding: .utf8) else {
            return false
        }
        return line.lowercased().contains(needle)
    }

    /// Регистронезависимое вхождение по байтам; nil, когда байты не ASCII и нужна сверка строк
    private static func asciiContains(_ lineData: Data, needleBytes: [UInt8]) -> Bool? {
        guard !needleBytes.isEmpty, needleBytes.allSatisfy({ $0 < 0x80 }) else {
            return nil
        }
        let haystack = [UInt8](lineData)
        guard haystack.count >= needleBytes.count else {
            return false
        }
        let first = asciiLower(needleBytes[0])
        let lastStart = haystack.count - needleBytes.count
        var hasNonASCII = false
        var start = 0
        while start < haystack.count {
            let byte = haystack[start]
            if byte >= 0x80 {
                hasNonASCII = true
            }
            if start <= lastStart, asciiLower(byte) == first {
                var offset = 1
                while offset < needleBytes.count, asciiLower(haystack[start + offset]) == needleBytes[offset] {
                    offset += 1
                }
                if offset == needleBytes.count {
                    return true
                }
            }
            start += 1
        }
        return hasNonASCII ? nil : false
    }

    /// Переводит байт ASCII в нижний регистр
    private static func asciiLower(_ byte: UInt8) -> UInt8 {
        byte >= 0x41 && byte <= 0x5A ? byte + 0x20 : byte
    }

    /// Регистронезависимое вхождение подстроки, needle уже в нижнем регистре
    private static func contains(_ text: String, _ needle: String) -> Bool {
        text.lowercased().contains(needle)
    }

    /// Совпадает ли запись с поисковой строкой по url, файлу подмены и телам
    private static func eventMatches(_ event: ProxyLogEvent, needle: String, searchInBody: Bool) -> Bool {
        if LogStore.contains(event.url, needle) {
            return true
        }
        if event.event == .matched, LogStore.contains(event.file, needle) {
            return true
        }
        guard searchInBody else {
            return false
        }
        return LogStore.contains(event.requestBody, needle) || LogStore.contains(event.responseBody, needle)
    }

    /// Строки файла сессии: один кодировщик на пачку, JSON с переводом строки на конце
    private static func encodeLines(_ events: [ProxyLogEvent]) -> [Data] {
        let encoder = JSONEncoder()
        return events.map { event in
            guard let data = try? encoder.encode(event), let json = String(data: data, encoding: .utf8) else {
                return Data("{}\n".utf8)
            }
            // Foundation экранирует слэши как "\/", в журнале это лишний шум
            return Data((json.replacingOccurrences(of: "\\/", with: "/") + "\n").utf8)
        }
    }

    /// Дописывает строку в файл сессии, открывая его при первой записи
    private func writeLine(_ line: Data) throws {
        if writeHandle == nil {
            if !FileManager.default.fileExists(atPath: fileURL.path) {
                FileManager.default.createFile(atPath: fileURL.path, contents: nil)
            }
            writeHandle = try FileHandle(forWritingTo: fileURL)
            try writeHandle?.seekToEnd()
        }
        try writeHandle?.write(contentsOf: line)
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
        let decoder = JSONDecoder()
        for entry in pending {
            guard let event = LogStore.readEvent(
                handle: handle,
                offset: entry.byteOffset,
                length: entry.byteLength,
                decoder: decoder
            ) else {
                continue
            }
            if LogStore.contains(event.requestBody, needle) || LogStore.contains(event.responseBody, needle) {
                matched.insert(entry.meta.ts)
            }
        }
        return matched
    }

    /// Читает индексированную строку по смещению и разбирает её
    private static func readEvent(
        handle: FileHandle,
        offset: Int,
        length: Int,
        decoder: JSONDecoder
    ) -> ProxyLogEvent? {
        do {
            try handle.seek(toOffset: UInt64(offset))
            guard let data = try handle.read(upToCount: length), data.count == length else {
                return nil
            }
            return try decoder.decode(ProxyLogEvent.self, from: data)
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
