import Foundation

/// Статус доверия к CA-сертификату прокси
enum CertStatus: String, Sendable {
    case notGenerated = "not-generated"
    case notTrusted = "not-trusted"
    case trusted
}

/// Доверие к CA-сертификату прокси в связке ключей текущего пользователя
enum CertTrustDarwin {
    /// Путь к CA-сертификату без ключа
    static var certificatePath: String {
        CertificateAuthority.certificatePath.path
    }

    /// Проверяет, доверен ли CA-сертификат как корневой в системе пользователя
    static func status() async -> CertStatus {
        guard FileManager.default.fileExists(atPath: certificatePath) else {
            return .notGenerated
        }
        let result = await ProcessRunner.runIgnoringFailure("/usr/bin/security", ["verify-cert", "-c", certificatePath, "-l"])
        return result.status == 0 ? .trusted : .notTrusted
    }

    /// Устанавливает доверие к CA: macOS сам запрашивает пароль или Touch ID в user keychain
    static func install() async throws {
        try CertificateAuthority.ensureCAExists()
        _ = try await ProcessRunner.run("/usr/bin/security", ["add-trusted-cert", "-r", "trustRoot", certificatePath])
    }

    /// Убирает доверие к CA (файл сертификата не удаляет)
    static func removeTrust() async throws {
        guard FileManager.default.fileExists(atPath: certificatePath) else {
            throw CertTrustError.certificateMissing
        }
        _ = try await ProcessRunner.run("/usr/bin/security", ["remove-trusted-cert", certificatePath])
    }
}

/// Ошибки работы с доверием к сертификату
enum CertTrustError: LocalizedError {
    case certificateMissing

    var errorDescription: String? {
        switch self {
        case .certificateMissing:
            return "Сертификат не найден: \(CertTrustDarwin.certificatePath)"
        }
    }
}
