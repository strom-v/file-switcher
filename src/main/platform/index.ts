/**
 * Точка выбора платформенной реализации по process.platform. Остальной main-код импортирует
 * только отсюда (`platform.systemProxy`, `platform.cert`, `platform.paths`) и платформы не знает.
 *
 * macOS — эталонная реализация (полная: VPN-осведомлённость, sudoers-оптимизация).
 * Windows — скелеты (см. *.win32.ts), дописываются отдельно.
 * Прочее — заглушки: работает только сам прокси-сервер.
 */
import { darwinSystemProxy } from './systemProxy.darwin'
import { win32SystemProxy } from './systemProxy.win32'
import { darwinCert } from './cert.darwin'
import { win32Cert } from './cert.win32'
import { unsupportedCert, unsupportedSystemProxy } from './unsupported'
import type { Platform } from './types'

export type { Platform, SystemProxyManager, CertManager } from './types'

function pickPlatform(): Platform {
  switch (process.platform) {
    case 'darwin':
      return { systemProxy: darwinSystemProxy, cert: darwinCert }
    case 'win32':
      return { systemProxy: win32SystemProxy, cert: win32Cert }
    default:
      return { systemProxy: unsupportedSystemProxy, cert: unsupportedCert }
  }
}

export const platform: Platform = pickPlatform()
