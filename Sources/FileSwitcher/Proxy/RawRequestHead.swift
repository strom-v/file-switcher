import Foundation
import NIOCore

/// Заголовок запроса, разобранный до HTTP-кодека: нужен, чтобы решить режим соединения
/// (CONNECT, обычный прокси-запрос, WebSocket) ещё на сырых байтах
struct RawRequestHead {
    var method: String
    var uri: String
    var version: String
    var headers: [(String, String)]

    /// Значение заголовка без учёта регистра имени
    func header(_ name: String) -> String? {
        let lowerName = name.lowercased()
        return headers.first { $0.0.lowercased() == lowerName }?.1
    }

    var isConnect: Bool {
        method.uppercased() == "CONNECT"
    }

    /// Запрос с Upgrade: рукопожатие WebSocket и подобное — дальше гоняем байты как есть
    var isUpgrade: Bool {
        if header("upgrade") != nil {
            return true
        }
        guard let connection = header("connection") else {
            return false
        }
        return connection.lowercased().split(separator: ",").contains { $0.trimmingCharacters(in: .whitespaces) == "upgrade" }
    }
}

/// Ищет конец заголовка запроса и разбирает его вместе с оставшимися во входном буфере байтами
func parseRawRequestHead(_ buffer: ByteBuffer) -> (head: RawRequestHead, leftover: ByteBuffer)? {
    let bytes = buffer.readableBytesView
    guard let terminator = findHeaderTerminator(bytes) else {
        return nil
    }
    let headBytes = bytes[bytes.startIndex..<terminator]
    let leftoverStart = bytes.index(terminator, offsetBy: 4)
    var leftover = buffer.getSlice(at: buffer.readerIndex + (terminator - bytes.startIndex) + 4, length: bytes.endIndex - leftoverStart)
        ?? ByteBuffer()
    if leftover.readableBytes == 0 {
        leftover = ByteBuffer()
    }

    let text = String(decoding: headBytes, as: UTF8.self)
    var lines = text.components(separatedBy: "\r\n")
    guard let requestLine = lines.first, !requestLine.isEmpty else {
        return nil
    }
    lines.removeFirst()

    let parts = requestLine.split(separator: " ", maxSplits: 2, omittingEmptySubsequences: true)
    guard parts.count >= 2 else {
        return nil
    }
    var headers: [(String, String)] = []
    for line in lines where !line.isEmpty {
        guard let colon = line.firstIndex(of: ":") else {
            continue
        }
        let name = String(line[line.startIndex..<colon]).trimmingCharacters(in: .whitespaces)
        let value = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
        headers.append((name, value))
    }
    let head = RawRequestHead(
        method: String(parts[0]),
        uri: String(parts[1]),
        version: parts.count > 2 ? String(parts[2]) : "HTTP/1.1",
        headers: headers
    )
    return (head, leftover)
}

/// Собирает заголовок запроса обратно в байты для апстрима
func serializeRawRequestHead(_ head: RawRequestHead, path: String) -> String {
    var lines = ["\(head.method) \(path) HTTP/1.1"]
    for (name, value) in head.headers where name.lowercased() != "proxy-connection" {
        lines.append("\(name): \(value)")
    }
    return lines.joined(separator: "\r\n") + "\r\n\r\n"
}

/// Позиция конца заголовка (начала "\r\n\r\n") в буфере
private func findHeaderTerminator(_ bytes: ByteBufferView) -> Int? {
    guard bytes.count >= 4 else {
        return nil
    }
    var index = bytes.startIndex
    let end = bytes.endIndex - 3
    while index < end {
        if bytes[index] == 0x0D, bytes[index + 1] == 0x0A, bytes[index + 2] == 0x0D, bytes[index + 3] == 0x0A {
            return index
        }
        index += 1
    }
    return nil
}
