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
import type { Platform, PlatformPaths } from './types'

export type { Platform, PlatformPaths, SystemProxyManager, CertManager } from './types'

const PLATFORM_PATHS: Record<NodeJS.Platform, PlatformPaths> = {
  darwin: { mitmdumpBinDir: 'mac', mitmdumpBinName: 'mitmdump' },
  win32: { mitmdumpBinDir: 'win', mitmdumpBinName: 'mitmdump.exe' },
  linux: { mitmdumpBinDir: 'linux', mitmdumpBinName: 'mitmdump' }
} as Record<NodeJS.Platform, PlatformPaths>

function pickPaths(): PlatformPaths {
  return PLATFORM_PATHS[process.platform] ?? PLATFORM_PATHS.linux
}

function pickPlatform(): Platform {
  switch (process.platform) {
    case 'darwin':
      return { systemProxy: darwinSystemProxy, cert: darwinCert, paths: pickPaths() }
    case 'win32':
      return { systemProxy: win32SystemProxy, cert: win32Cert, paths: pickPaths() }
    default:
      return { systemProxy: unsupportedSystemProxy, cert: unsupportedCert, paths: pickPaths() }
  }
}

export const platform: Platform = pickPlatform()
