/**
 * Платформо-зависимые операции main-процесса за единым интерфейсом. macOS-реализация —
 * эталонная и полная; реализации для других платформ подключаются через ./index по process.platform.
 */
import type { CertStatus, VpnStatus } from '../../shared/types'

/** Управление системным HTTP/HTTPS-прокси ОС (как это делает Fiddler/Charles) */
export interface SystemProxyManager {
  /** Включает системный прокси на host:port, сохранив прежнее состояние для последующего отката */
  enable(host: string, port: number): Promise<void>
  /** Возвращает системный прокси в состояние до enable() */
  disable(): Promise<void>
  /** Страховка на старте/выходе: откатывает состояние после аварийного завершения приложения */
  recoverStale(host: string): Promise<void>
  /** Установлено ли разовое разрешение менять прокси без запроса пароля (там, где это применимо) */
  isPasswordlessSetup(): boolean
  /** Выдаёт такое разрешение через один системный диалог авторизации */
  setUpPasswordless(): Promise<void>
  /** Отзывает разрешение (удаляет sudoers-правило); no-op там, где настройки нет */
  revokePasswordless(): Promise<void>
  /** Статус VPN: есть ли туннель и заворачивает ли он весь трафик (тогда перехват прокси сломан).
   * best-effort: при ошибке определения возвращает { active: false, blocksProxy: false }. */
  getVpnStatus(): Promise<VpnStatus>
}

/** Управление доверием к CA-сертификату mitmproxy в системном хранилище */
export interface CertManager {
  /** Путь к CA-сертификату mitmproxy, который генерирует сам mitmproxy при первом запуске */
  readonly caCertPath: string
  status(): Promise<CertStatus>
  install(): Promise<void>
  removeTrust(): Promise<void>
}

/** Пути к бандлам, специфичные для платформы упаковки */
export interface PlatformPaths {
  /** Поддиректория resources/bin/<...> с бинарником mitmdump для текущей платформы */
  readonly mitmdumpBinDir: string
  /** Имя исполняемого файла mitmdump (с расширением на Windows) */
  readonly mitmdumpBinName: string
}

export interface Platform {
  readonly systemProxy: SystemProxyManager
  readonly cert: CertManager
  readonly paths: PlatformPaths
}
