import Foundation

/// Сборка ASN.1 DER: ровно те примитивы, которые нужны для сертификатов.
enum Der {
    /// Кодирует длину содержимого по правилам BER/DER
    static func encodeLength(_ length: Int) -> [UInt8] {
        if length < 0x80 {
            return [UInt8(length)]
        }
        var bytes: [UInt8] = []
        var value = length
        while value > 0 {
            bytes.insert(UInt8(value & 0xff), at: 0)
            value >>= 8
        }
        return [0x80 | UInt8(bytes.count)] + bytes
    }

    /// TLV-блок из тега и содержимого
    static func tlv(_ tag: UInt8, _ content: [UInt8]) -> [UInt8] {
        [tag] + encodeLength(content.count) + content
    }

    /// Последовательность (SEQUENCE)
    static func sequence(_ parts: [UInt8]...) -> [UInt8] {
        tlv(0x30, parts.flatMap { $0 })
    }

    /// Множество (SET)
    static func set(_ parts: [UInt8]...) -> [UInt8] {
        tlv(0x31, parts.flatMap { $0 })
    }

    /// Целое (INTEGER) из байтов: ведущие нули убираются, знаковый бит не выставляется
    static func integer(_ bytes: [UInt8]) -> [UInt8] {
        var body = bytes
        while body.count > 1 && body[0] == 0 && body[1] & 0x80 == 0 {
            body.removeFirst()
        }
        if body.first.map({ $0 & 0x80 != 0 }) ?? false {
            body.insert(0, at: 0)
        }
        return tlv(0x02, body)
    }

    /// Целое (INTEGER) из числа
    static func integer(_ value: Int) -> [UInt8] {
        var bytes: [UInt8] = []
        var rest = value
        repeat {
            bytes.insert(UInt8(rest & 0xff), at: 0)
            rest >>= 8
        } while rest > 0
        return integer(bytes)
    }

    /// Логическое (BOOLEAN)
    static func boolean(_ value: Bool) -> [UInt8] {
        tlv(0x01, [value ? 0xff : 0x00])
    }

    /// Пустое значение (NULL)
    static func null() -> [UInt8] {
        [0x05, 0x00]
    }

    /// Идентификатор объекта (OBJECT IDENTIFIER) из точечной записи
    static func oid(_ dotted: String) -> [UInt8] {
        let numbers = dotted.split(separator: ".").compactMap { Int($0) }
        guard numbers.count >= 2 else { return tlv(0x06, []) }
        var body: [UInt8] = [UInt8(numbers[0] * 40 + numbers[1])]
        for number in numbers.dropFirst(2) {
            var chunk: [UInt8] = [UInt8(number & 0x7f)]
            var rest = number >> 7
            while rest > 0 {
                chunk.insert(UInt8(rest & 0x7f) | 0x80, at: 0)
                rest >>= 7
            }
            body.append(contentsOf: chunk)
        }
        return tlv(0x06, body)
    }

    /// Строка UTF-8 (UTF8String)
    static func utf8String(_ value: String) -> [UInt8] {
        tlv(0x0c, Array(value.utf8))
    }

    /// Время по Гринвичу (UTCTime) в формате YYMMDDHHMMSSZ
    static func utcTime(_ date: Date) -> [UInt8] {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyMMddHHmmss'Z'"
        return tlv(0x17, Array(formatter.string(from: date).utf8))
    }

    /// Октетная строка (OCTET STRING)
    static func octetString(_ bytes: [UInt8]) -> [UInt8] {
        tlv(0x04, bytes)
    }

    /// Битовая строка (BIT STRING); неиспользованные биты указываются для keyUsage
    static func bitString(_ bytes: [UInt8], unusedBits: UInt8 = 0) -> [UInt8] {
        tlv(0x03, [unusedBits] + bytes)
    }

    /// Контекстный тег (например [0] версии или [3] расширений)
    static func contextTag(_ number: UInt8, _ content: [UInt8], constructed: Bool = true) -> [UInt8] {
        tlv((constructed ? 0xa0 : 0x80) | number, content)
    }
}

/// Разбор DER: нужен, чтобы взять байты subject'а из готового сертификата CA.
enum DerReader {
    /// Один TLV-блок внутри буфера
    struct Element {
        /// Байт тега
        let tag: UInt8
        /// Начало заголовка TLV
        let start: Int
        /// Начало содержимого
        let contentStart: Int
        /// Конец содержимого (за ним же заканчивается TLV)
        let end: Int
    }

    /// Байты содержимого элемента
    static func content(of element: Element, in bytes: [UInt8]) -> [UInt8] {
        Array(bytes[element.contentStart..<element.end])
    }

    /// Байты элемента целиком, вместе с заголовком
    static func encoded(_ element: Element, in bytes: [UInt8]) -> [UInt8] {
        Array(bytes[element.start..<element.end])
    }

    /// Разбирает последовательность TLV в диапазоне; на первом же сбое возвращает то, что успел
    static func elements(in bytes: [UInt8], range: Range<Int>) -> [Element] {
        var result: [Element] = []
        var index = range.lowerBound
        while index < range.upperBound {
            guard let element = element(in: bytes, at: index, limit: range.upperBound) else {
                return result
            }
            result.append(element)
            index = element.end
        }
        return result
    }

    /// Читает один TLV по смещению
    static func element(in bytes: [UInt8], at index: Int, limit: Int) -> Element? {
        guard index + 2 <= limit else { return nil }
        let tag = bytes[index]
        // составные теги (0x1f) в сертификатах не встречаются
        guard tag & 0x1f != 0x1f else { return nil }
        var cursor = index + 1
        var length = Int(bytes[cursor])
        cursor += 1
        if length & 0x80 != 0 {
            let byteCount = length & 0x7f
            guard byteCount > 0, byteCount <= 4, cursor + byteCount <= limit else { return nil }
            length = 0
            for _ in 0..<byteCount {
                length = (length << 8) | Int(bytes[cursor])
                cursor += 1
            }
        }
        guard cursor + length <= limit else { return nil }
        return Element(tag: tag, start: index, contentStart: cursor, end: cursor + length)
    }

    /// Байты subject'а из DER сертификата X.509 (вместе с заголовком TLV)
    static func subjectDER(inCertificate der: [UInt8]) -> [UInt8]? {
        guard let certificate = elements(in: der, range: 0..<der.count).first, certificate.tag == 0x30 else {
            return nil
        }
        let certificateFields = elements(in: der, range: certificate.contentStart..<certificate.end)
        guard let tbs = certificateFields.first, tbs.tag == 0x30 else { return nil }
        let fields = elements(in: der, range: tbs.contentStart..<tbs.end)
        // [0] version есть не всегда: без него сдвиг у всех последующих полей
        let body = fields.first?.tag == 0xa0 ? Array(fields.dropFirst()) : fields
        // serialNumber, signature, issuer, validity, subject
        guard body.count > 4, body[4].tag == 0x30 else { return nil }
        return encoded(body[4], in: der)
    }
}
