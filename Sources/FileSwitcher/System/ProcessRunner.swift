import Foundation

/// Ошибка запуска внешней команды
struct ProcessError: LocalizedError {
    let executable: String
    let status: Int32
    let output: String

    var errorDescription: String? {
        let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "\(executable) завершился с кодом \(status)" : trimmed
    }
}

/// Запускает внешние команды без shell и возвращает их вывод
enum ProcessRunner {
    /// Запускает команду и ждёт завершения в фоне; при ненулевом коде бросает с выводом
    static func run(_ executable: String, _ arguments: [String]) async throws -> String {
        try await Task.detached(priority: .userInitiated) {
            try runSynchronously(executable, arguments)
        }.value
    }

    /// Синхронный запуск: stdout целиком, ошибки через вывод команды
    static func runSynchronously(_ executable: String, _ arguments: [String]) throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        do {
            try process.run()
        } catch {
            throw ProcessError(executable: executable, status: -1, output: error.localizedDescription)
        }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        let output = String(decoding: data, as: UTF8.self)
        guard process.terminationStatus == 0 else {
            throw ProcessError(executable: executable, status: process.terminationStatus, output: output)
        }
        return output
    }

    /// Запускает команду и отдаёт код возврата без исключения при неудаче
    static func runIgnoringFailure(_ executable: String, _ arguments: [String]) async -> (status: Int32, output: String) {
        await Task.detached(priority: .userInitiated) {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: executable)
            process.arguments = arguments
            let pipe = Pipe()
            process.standardOutput = pipe
            process.standardError = pipe
            do {
                try process.run()
            } catch {
                return (-1, error.localizedDescription)
            }
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            return (process.terminationStatus, String(decoding: data, as: UTF8.self))
        }.value
    }
}
