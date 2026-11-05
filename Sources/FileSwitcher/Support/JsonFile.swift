import Foundation

/// Запись JSON-файла: сперва во временный файл рядом, затем rename поверх целевого
enum JsonFile {
    /// Читает JSON-файл; при отсутствии и порче отдаёт fallback и сообщает о порче
    static func read<T: Decodable>(_ type: T.Type, at url: URL, fallback: T, onCorrupted: (String) -> Void) -> T {
        guard FileManager.default.fileExists(atPath: url.path) else {
            return fallback
        }
        do {
            let data = try Data(contentsOf: url)
            return try JSONDecoder().decode(type, from: data)
        } catch {
            onCorrupted(error.localizedDescription)
            return fallback
        }
    }

    /// Пишет JSON с отступом в 2 пробела атомарно: rename на той же файловой системе
    /// оставляет целевой файл либо старым, либо новым целиком
    static func write(_ value: some Encodable, to url: URL) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .withoutEscapingSlashes]
        let data = try encoder.encode(value)
        let directory = url.deletingLastPathComponent()
        let temporaryURL = directory.appendingPathComponent(".\(Int(Date().timeIntervalSince1970 * 1000))-\(ProcessInfo.processInfo.processIdentifier).tmp")
        do {
            try data.write(to: temporaryURL)
            _ = try FileManager.default.replaceItemAt(url, withItemAt: temporaryURL)
        } catch {
            try? FileManager.default.removeItem(at: temporaryURL)
            throw error
        }
    }

    /// Разбирает JSON-объект целиком — нужен для проверки неизвестных полей и не-массивов
    static func readObject(at url: URL) throws -> [String: Any] {
        let data = try Data(contentsOf: url)
        let parsed = try JSONSerialization.jsonObject(with: data)
        guard let object = parsed as? [String: Any] else {
            throw JsonFileError.notAnObject
        }
        return object
    }
}

/// Ошибки чтения JSON-файлов
enum JsonFileError: LocalizedError {
    case notAnObject
    case rulesNotArray

    var errorDescription: String? {
        switch self {
        case .notAnObject:
            return "ожидался JSON-объект"
        case .rulesNotArray:
            return "поле \"rules\" не является массивом"
        }
    }
}
