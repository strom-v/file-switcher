import Foundation
import NIOCore
import NIOHTTP1

/// Куда на самом деле идёт запрос: из CONNECT (https) или из absolute-form URL (http)
struct ProxyTarget: Sendable, Equatable {
    enum Scheme: String, Sendable {
        case http
        case https

        var defaultPort: Int {
            self == .https ? 443 : 80
        }
    }

    var scheme: Scheme
    var host: String
    var port: Int
}

/// Заголовки одного соединения, которые дальше не передаются (RFC 9110 §7.6.1)
let hopByHopHeaderNames: Set<String> = [
    "connection",
    "keep-alive",
    "proxy-connection",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade"
]

/// Сколько байт тела сохраняем в журнал
let bodyCaptureLimitBytes = 64 * 1024
/// Потолок объёма заголовков в одной записи журнала
let maxLogHeaderCharacters = 64 * 1024
/// Потолок числа заголовков в одной записи журнала
let maxLogHeaderCount = 100

/// Разбирает "host:port" и "[ipv6]:port"
func parseAuthority(_ authority: String, defaultPort: Int) -> (host: String, port: Int) {
    if authority.hasPrefix("[") {
        guard let closing = authority.firstIndex(of: "]") else {
            return (authority, defaultPort)
        }
        let host = String(authority[authority.index(after: authority.startIndex)..<closing])
        let rest = authority[authority.index(after: closing)...]
        guard rest.hasPrefix(":"), let port = Int(rest.dropFirst()) else {
            return (host, defaultPort)
        }
        return (host, port)
    }
    if let colon = authority.lastIndex(of: ":") {
        let host = String(authority[authority.startIndex..<colon])
        let maybePort = authority[authority.index(after: colon)...]
        if !host.isEmpty, let port = Int(maybePort) {
            return (host, port)
        }
    }
    return (authority, defaultPort)
}

/// Разбирает absolute-form URL прокси-запроса; nil - это обращение не через прокси
func parseAbsoluteForm(_ uri: String) -> (target: ProxyTarget, path: String)? {
    guard let separator = uri.range(of: "://") else {
        return nil
    }
    let schemeName = uri[uri.startIndex..<separator.lowerBound].lowercased()
    guard let scheme = ProxyTarget.Scheme(rawValue: schemeName) else {
        return nil
    }
    let rest = uri[separator.upperBound...]
    let authorityEnd = rest.firstIndex { character in
        character == "/" || character == "?" || character == "#"
    } ?? rest.endIndex
    let authority = String(rest[rest.startIndex..<authorityEnd])
    guard !authority.isEmpty else {
        return nil
    }
    let path = String(rest[authorityEnd...])
    let parsed = parseAuthority(authority, defaultPort: scheme.defaultPort)
    let target = ProxyTarget(scheme: scheme, host: parsed.host, port: parsed.port)
    return (target, path.isEmpty ? "/" : path)
}

/// URL в том виде, в каком его сравнивают с правилами: порт по умолчанию опускается
func prettyUrl(target: ProxyTarget, hostHeader: String?, path: String) -> String {
    let authority = hostHeader.flatMap { $0.isEmpty ? nil : $0 } ?? target.host
    let parsed = parseAuthority(authority, defaultPort: target.port)
    let printedHost = parsed.host.contains(":") ? "[\(parsed.host)]" : parsed.host
    let printedPort = parsed.port == target.scheme.defaultPort ? "" : ":\(parsed.port)"
    return "\(target.scheme.rawValue)://\(printedHost.lowercased())\(printedPort)\(path)"
}

/// Имена, перечисленные в Connection: они тоже hop-by-hop для этого соединения
func connectionListedHeaderNames(_ headers: HTTPHeaders) -> Set<String> {
    var names: Set<String> = []
    for (name, value) in headers where name.lowercased() == "connection" {
        for part in value.split(separator: ",") {
            let trimmed = part.trimmingCharacters(in: .whitespaces).lowercased()
            if !trimmed.isEmpty {
                names.insert(trimmed)
            }
        }
    }
    return names
}

/// Пары имя/значение без hop-by-hop заголовков
func forwardableHeaders(_ headers: HTTPHeaders) -> [(String, String)] {
    let listed = connectionListedHeaderNames(headers)
    var pairs: [(String, String)] = []
    for (name, value) in headers {
        let lowerName = name.lowercased()
        if hopByHopHeaderNames.contains(lowerName) || listed.contains(lowerName) {
            continue
        }
        pairs.append((name, value))
    }
    return pairs
}

/// Заголовки запроса для настоящего сервера: без accept-encoding, чтобы тело ответа
/// попадало в журнал несжатым и было читаемо в поиске и деталях
func forwardableRequestHeaders(_ headers: HTTPHeaders) -> [(String, String)] {
    var pairs = forwardableHeaders(headers)
    pairs.removeAll { $0.0.lowercased() == "accept-encoding" }
    return pairs
}

/// Заголовки ответа для клиента: hop-by-hop убираются, но признак chunked сохраняется,
/// иначе тело нельзя закодировать частями
func forwardableResponseHeaders(_ headers: HTTPHeaders) -> [(String, String)] {
    let listed = connectionListedHeaderNames(headers)
    var pairs: [(String, String)] = []
    for (name, value) in headers {
        let lowerName = name.lowercased()
        if lowerName == "transfer-encoding" {
            if value.lowercased().contains("chunked") {
                pairs.append((name, value))
            }
            continue
        }
        if hopByHopHeaderNames.contains(lowerName) || listed.contains(lowerName) {
            continue
        }
        pairs.append((name, value))
    }
    return pairs
}

/// Заголовки для журнала: повторы склеены через запятую, число и объём ограничены
func headersForLog(_ pairs: [(String, String)]) -> [String: String] {
    var merged: [String: String] = [:]
    var nameByLower: [String: String] = [:]
    for (name, value) in pairs {
        let lowerName = name.lowercased()
        if let existing = nameByLower[lowerName] {
            merged[existing, default: ""] += ", \(value)"
            continue
        }
        nameByLower[lowerName] = name
        merged[name] = value
    }

    var bounded: [String: String] = [:]
    var usedCharacters = 0
    for (name, value) in merged.prefix(maxLogHeaderCount) {
        let remaining = maxLogHeaderCharacters - usedCharacters
        if remaining <= 0 {
            break
        }
        let boundedName = String(name.prefix(remaining))
        let boundedValue = String(value.prefix(remaining - boundedName.count))
        bounded[boundedName] = boundedValue
        usedCharacters += boundedName.count + boundedValue.count
    }
    return RedactedHeaders.redact(bounded)
}

/// Тело, накопленное для журнала: первые 64 КБ и полный размер
final class BodyCapture: @unchecked Sendable {
    private var captured: [UInt8] = []
    private(set) var size = 0

    init() {}

    /// Учитывает очередной кусок тела
    func add(_ buffer: ByteBuffer) {
        size += buffer.readableBytes
        guard captured.count < bodyCaptureLimitBytes else {
            return
        }
        let room = bodyCaptureLimitBytes - captured.count
        if let slice = buffer.getBytes(at: buffer.readerIndex, length: min(room, buffer.readableBytes)) {
            captured.append(contentsOf: slice)
        }
    }

    /// Учитывает байты, сформированные самим прокси (тело подмены)
    func add(bytes: some Sequence<UInt8>) {
        let array = Array(bytes)
        size += array.count
        let room = bodyCaptureLimitBytes - captured.count
        if room > 0 {
            captured.append(contentsOf: array.prefix(room))
        }
    }

    /// Текст тела и признак бинарности (тело не декодируется как строгий UTF-8)
    func decode() -> (text: String, isBinary: Bool) {
        if size == 0 {
            return ("", false)
        }
        guard let text = String(bytes: captured, encoding: .utf8) else {
            return ("", true)
        }
        return (text, false)
    }
}
