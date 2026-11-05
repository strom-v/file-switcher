import Foundation

/// Ошибка повтора запроса, показываемая в интерфейсе
enum ReplayRequestError: LocalizedError {
    case binaryRequestBody
    case invalidURL(String)
    case nonPublicTarget(String)
    case redirectLimit(Int)

    var errorDescription: String? {
        switch self {
        case .binaryRequestBody:
            "Тело запроса бинарное - повторная отправка исказит данные"
        case let .invalidURL(url):
            "Некорректный URL для повтора: \(url)"
        case let .nonPublicTarget(host):
            "Повтор на приватный или локальный адрес запрещён: \(host)"
        case let .redirectLimit(limit):
            "Превышен лимит редиректов (\(limit))"
        }
    }
}

/// Повтор запроса из журнала в обход прокси
enum ReplayRequest {
    static let timeout: TimeInterval = 15
    static let maxRedirects = 5
    /// Потолок тела ответа: без него крупный ответ вычитался бы целиком в память и в журнал
    static let maxBodyBytes = 8 * 1024 * 1024

    /// Заголовки, которые нельзя выставлять вручную или которые описывают исходное соединение
    static let skippedHeaders: Set<String> = [
        "host",
        "content-length",
        "connection",
        "accept-encoding",
        "cookie",
        "origin",
        "referer"
    ]

    /// Склоняет URL к повторам: проверяет публичность хоста и запрещает бинарные тела
    static func replay(_ event: ProxyLogEvent) async throws -> ProxyLogEvent {
        guard !event.requestBodyIsBinary else {
            throw ReplayRequestError.binaryRequestBody
        }
        guard let startURL = URL(string: event.url), let host = startURL.host() else {
            throw ReplayRequestError.invalidURL(event.url)
        }
        try await assertPublicTarget(host: host)

        var requestHeaders: [String: String] = [:]
        for (name, value) in event.requestHeaders where !skippedHeaders.contains(name.lowercased()) {
            requestHeaders[name] = value
        }

        let session = URLSessionConfiguration.ephemeral
        session.timeoutIntervalForRequest = timeout
        session.timeoutIntervalForResource = timeout
        session.httpCookieStorage = nil
        session.httpShouldSetCookies = false
        let blockRedirects = RedirectBlocker()
        let urlSession = URLSession(configuration: session, delegate: blockRedirects, delegateQueue: nil)
        defer {
            urlSession.finishTasksAndInvalidate()
        }

        var currentURL = startURL
        var method = event.method
        var hop = 0
        while true {
            var request = URLRequest(url: currentURL)
            request.httpMethod = method
            for (name, value) in requestHeaders {
                request.setValue(value, forHTTPHeaderField: name)
            }
            let methodAllowsBody = method.uppercased() != "GET" && method.uppercased() != "HEAD"
            if !event.requestBody.isEmpty, methodAllowsBody {
                request.httpBody = Data(event.requestBody.utf8)
            }

            let (statusCode, responseHeaders, body) = try await send(urlSession, request)
            let isRedirect = (300..<400).contains(statusCode)
            guard isRedirect,
                  let location = responseHeaders.first(where: { $0.key.lowercased() == "location" })?.value else {
                return makeEntry(event: event, statusCode: statusCode, headers: responseHeaders, body: body)
            }
            guard hop < maxRedirects else {
                throw ReplayRequestError.redirectLimit(maxRedirects)
            }
            guard let nextURL = URL(string: location, relativeTo: currentURL) else {
                throw ReplayRequestError.invalidURL(location)
            }
            if let nextHost = nextURL.host() {
                try await assertPublicTarget(host: nextHost)
            }
            currentURL = nextURL
            // 301/302/303 на не-GET превращают запрос в GET без тела, как это делают браузеры
            if statusCode == 303 || (statusCode == 301 || statusCode == 302) {
                method = "GET"
            }
            hop += 1
        }
    }
}

/// Глушит автоматические редиректы: их разбирает сам повтор, проверяя каждый новый хост
private final class RedirectBlocker: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

extension ReplayRequest {
    /// Делает один запрос и возвращает статус, заголовки и тело с учётом потолка
    private static func send(_ session: URLSession, _ request: URLRequest) async throws -> (Int, [String: String], String) {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            return (0, [:], "")
        }
        var headers: [String: String] = [:]
        for (name, value) in http.allHeaderFields {
            if let name = name as? String, let value = value as? String {
                headers[name] = value
            }
        }
        // shortcut: потолок применяется после загрузки, память ограничена не жёстко;
        // потоковое чтение с обрывом - если упрёмся в крупные ответы
        let truncated = data.count > maxBodyBytes
        let body = String(decoding: data.prefix(maxBodyBytes), as: UTF8.self)
            + (truncated ? "\n… [обрезано FileSwitcher: ответ больше \(maxBodyBytes) байт]" : "")
        return (http.statusCode, headers, body)
    }

    /// Собирает запись журнала для события повтора
    private static func makeEntry(
        event: ProxyLogEvent,
        statusCode: Int,
        headers: [String: String],
        body: String
    ) -> ProxyLogEvent {
        ProxyLogEvent(
            event: .replay,
            url: event.url,
            file: "",
            method: event.method,
            statusCode: statusCode,
            requestHeaders: RedactedHeaders.redact(event.requestHeaders),
            // обычный трафик редактирует секретные заголовки в прокси, а повтор идёт мимо него
            responseHeaders: RedactedHeaders.redact(headers),
            responseSize: Data(body.utf8).count,
            ts: Date().timeIntervalSince1970,
            requestBody: event.requestBody,
            requestBodyIsBinary: false,
            requestBodySize: event.requestBodySize,
            responseBody: body,
            responseBodyIsBinary: false
        )
    }
}


extension ReplayRequest {
    /// Отклоняет повтор на loopback, link-local и приватный адрес
    static func assertPublicTarget(host: String) async throws {
        if host.lowercased() == "localhost" {
            throw ReplayRequestError.nonPublicTarget(host)
        }
        if let address = IPAddress.parse(host) {
            guard IPAddress.isPublic(address) else {
                throw ReplayRequestError.nonPublicTarget(host)
            }
            return
        }
        let addresses = try await resolve(host: host)
        guard !addresses.isEmpty else {
            return
        }
        for address in addresses where !IPAddress.isPublic(address) {
            throw ReplayRequestError.nonPublicTarget(host)
        }
    }

    /// Резолвит хост в числовые адреса
    private static func resolve(host: String) async throws -> [String] {
        try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                var hints = addrinfo()
                hints.ai_family = AF_UNSPEC
                hints.ai_socktype = SOCK_STREAM
                var result: UnsafeMutablePointer<addrinfo>?
                guard getaddrinfo(host, nil, &hints, &result) == 0, let first = result else {
                    continuation.resume(throwing: ReplayRequestError.invalidURL(host))
                    return
                }
                defer {
                    freeaddrinfo(first)
                }
                var addresses: [String] = []
                var pointer: UnsafeMutablePointer<addrinfo>? = first
                while let current = pointer {
                    if let address = current.pointee.ai_addr {
                        var buffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                        if getnameinfo(address, current.pointee.ai_addrlen, &buffer, socklen_t(buffer.count), nil, 0, NI_NUMERICHOST) == 0 {
                            let bytes = buffer.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }
                            addresses.append(String(decoding: bytes, as: UTF8.self))
                        }
                    }
                    pointer = current.pointee.ai_next
                }
                continuation.resume(returning: addresses)
            }
        }
    }
}

/// Разбор и проверка числовых адресов на публичность
enum IPAddress {
    /// Разбирает IPv4 или IPv6-литерал
    static func parse(_ text: String) -> String? {
        var ipv4 = in_addr()
        if inet_pton(AF_INET, text, &ipv4) == 1 {
            return text
        }
        let trimmed = text.trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        var ipv6 = in6_addr()
        guard inet_pton(AF_INET6, trimmed, &ipv6) == 1 else {
            return nil
        }
        return trimmed
    }

    /// true для адресов, доступных из интернета
    static func isPublic(_ address: String) -> Bool {
        if address.contains(":") {
            return isPublicIPv6(address)
        }
        let parts = address.split(separator: ".").compactMap { Int($0) }
        guard parts.count == 4 else {
            return false
        }
        let (first, second) = (parts[0], parts[1])
        if first == 0 || first == 10 || first == 127 || first >= 224 {
            return false
        }
        if first == 169 && second == 254 {
            return false
        }
        if first == 172 && (16...31).contains(second) {
            return false
        }
        if first == 192 && second == 168 {
            return false
        }
        if first == 100 && (64...127).contains(second) {
            return false
        }
        return true
    }

    /// Проверка IPv6: loopback, link-local, unique local, multicast
    private static func isPublicIPv6(_ address: String) -> Bool {
        let scopeFree = address.split(separator: "%").first.map(String.init) ?? address
        let lowered = scopeFree.lowercased()
        if lowered == "::1" || lowered == "::" {
            return false
        }
        let linkLocalPrefixes = ["fe8", "fe9", "fea", "feb"]
        if linkLocalPrefixes.contains(where: { lowered.hasPrefix($0) }) {
            return false
        }
        if lowered.hasPrefix("fc") || lowered.hasPrefix("fd") || lowered.hasPrefix("ff") {
            return false
        }
        if lowered.hasPrefix("::ffff:"), let mapped = lowered.split(separator: ":").last {
            return isPublic(String(mapped))
        }
        return true
    }
}
