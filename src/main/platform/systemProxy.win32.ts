import { existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { execAsync } from '../execAsync'
import { readJsonFile, writeJsonFile } from '../jsonFile'
import type { SystemProxyManager } from './types'
import type { VpnStatus } from '../../shared/types'

// один системный прокси на всю Windows, живёт в реестре текущего пользователя (без прав администратора)
const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'

// PowerShell со встроенным C#: дёргает WinINet InternetSetOption, чтобы уже запущенные приложения
// (не только новые процессы) подхватили изменение прокси без перезахода в систему
const REFRESH_WININET_PS = `
$sig = @'
[DllImport("wininet.dll", SetLastError = true, CharSet = CharSet.Auto)]
public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
'@
$w = Add-Type -MemberDefinition $sig -Name WinINet -Namespace Native -PassThru
$INTERNET_OPTION_SETTINGS_CHANGED = 39
$INTERNET_OPTION_REFRESH = 37
[void]$w::InternetSetOption([IntPtr]::Zero, $INTERNET_OPTION_SETTINGS_CHANGED, [IntPtr]::Zero, 0)
[void]$w::InternetSetOption([IntPtr]::Zero, $INTERNET_OPTION_REFRESH, [IntPtr]::Zero, 0)
`.trim()

interface SavedProxyState {
  proxyEnable: number
  proxyServer: string
  proxyOverride: string
}

function getStateFilePath(): string {
  return join(app.getPath('userData'), 'proxy-system-state.json')
}

function readSavedState(): SavedProxyState | null {
  return readJsonFile<SavedProxyState | null>(getStateFilePath(), null)
}

function writeSavedState(state: SavedProxyState): void {
  writeJsonFile(getStateFilePath(), state)
}

function clearSavedState(): void {
  const filePath = getStateFilePath()
  if (existsSync(filePath)) unlinkSync(filePath)
}

/** Значение одного параметра реестра или null, если параметра нет */
async function regQuery(name: string): Promise<string | null> {
  let output: string
  try {
    output = await execAsync('reg', ['query', REG_KEY, '/v', name])
  } catch {
    return null
  }
  // строка вида: "    ProxyServer    REG_SZ    127.0.0.1:8080"
  const match = output.match(new RegExp(`\\b${name}\\s+REG_(?:SZ|DWORD)\\s+(.*)`, 'i'))
  return match ? match[1].trim() : null
}

async function regSetString(name: string, value: string): Promise<void> {
  await execAsync('reg', ['add', REG_KEY, '/v', name, '/t', 'REG_SZ', '/d', value, '/f'])
}

async function regSetDword(name: string, value: number): Promise<void> {
  await execAsync('reg', ['add', REG_KEY, '/v', name, '/t', 'REG_DWORD', '/d', String(value), '/f'])
}

async function refreshWinInet(): Promise<void> {
  try {
    await execAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', REFRESH_WININET_PS])
  } catch {
    // не удалось уведомить WinINet — новые процессы всё равно увидят прокси из реестра,
    // уже запущенным приложениям может потребоваться перезапуск
  }
}

async function readCurrentState(): Promise<SavedProxyState> {
  const [enable, server, override] = await Promise.all([
    regQuery('ProxyEnable'),
    regQuery('ProxyServer'),
    regQuery('ProxyOverride')
  ])
  return {
    // REG_DWORD в выводе reg — "0x1" / "0x0"
    proxyEnable: enable ? parseInt(enable, 16) || 0 : 0,
    proxyServer: server ?? '',
    proxyOverride: override ?? ''
  }
}

class Win32SystemProxyManager implements SystemProxyManager {
  isPasswordlessSetup(): boolean {
    // HKCU не требует прав администратора — «настройка без пароля» всегда выполнена
    return true
  }

  async setUpPasswordless(): Promise<void> {
    // no-op: на Windows нечего настраивать
  }

  async getVpnStatus(): Promise<VpnStatus> {
    // один powershell-вызов на всё: подключённые VPN-профили (встроенный клиент), активные
    // TAP/WireGuard/OpenVPN-адаптеры и интерфейс дефолтного маршрута (0.0.0.0/0 с наименьшей
    // метрикой) — туннельный ли он. best-effort, ошибки гасим в { active:false, blocksProxy:false }
    const ps = [
      '$ErrorActionPreference = "SilentlyContinue"',
      '$vpn = @(Get-VpnConnection -ErrorAction SilentlyContinue) + @(Get-VpnConnection -AllUserConnection -ErrorAction SilentlyContinue) | Where-Object { $_.ConnectionStatus -eq "Connected" }',
      '$tunAdapters = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq "Up" -and ($_.InterfaceDescription -match "VPN|TAP-|TUN|WireGuard|OpenVPN|WAN Miniport|Wintun") }',
      '$defRoute = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue | Sort-Object RouteMetric,ifMetric | Select-Object -First 1',
      '$defAdapter = if ($defRoute) { Get-NetAdapter -InterfaceIndex $defRoute.ifIndex -ErrorAction SilentlyContinue } else { $null }',
      '$defIsTunnel = $defAdapter -and ($defAdapter.InterfaceDescription -match "VPN|TAP-|TUN|WireGuard|OpenVPN|WAN Miniport|Wintun")',
      '$active = ($vpn.Count -gt 0) -or ($tunAdapters.Count -gt 0)',
      '"ACTIVE=$active BLOCKS=$defIsTunnel"'
    ].join('; ')
    try {
      const output = await execAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps])
      return {
        active: /ACTIVE=True/i.test(output),
        blocksProxy: /BLOCKS=True/i.test(output)
      }
    } catch {
      return { active: false, blocksProxy: false }
    }
  }

  async enable(host: string, port: number): Promise<void> {
    const current = await readCurrentState()
    writeSavedState(current)

    await regSetString('ProxyServer', `${host}:${port}`)
    // локальные адреса мимо прокси, чтобы не ломать доступ к localhost и intranet
    await regSetString('ProxyOverride', '<local>')
    await regSetDword('ProxyEnable', 1)
    await refreshWinInet()
  }

  async disable(): Promise<void> {
    const saved = readSavedState()
    clearSavedState()

    if (saved) {
      await regSetDword('ProxyEnable', saved.proxyEnable)
      await regSetString('ProxyServer', saved.proxyServer)
      await regSetString('ProxyOverride', saved.proxyOverride)
    } else {
      await regSetDword('ProxyEnable', 0)
    }
    await refreshWinInet()
  }

  async recoverStale(host: string): Promise<void> {
    const saved = readSavedState()
    if (saved) {
      clearSavedState()
      await regSetDword('ProxyEnable', saved.proxyEnable)
      await regSetString('ProxyServer', saved.proxyServer)
      await regSetString('ProxyOverride', saved.proxyOverride)
      await refreshWinInet()
      return
    }

    // файла состояния нет, но прокси мог остаться указывающим на нас после аварийного завершения
    const current = await readCurrentState()
    if (current.proxyEnable === 1 && current.proxyServer.startsWith(`${host}:`)) {
      await regSetDword('ProxyEnable', 0)
      await refreshWinInet()
    }
  }
}

export const win32SystemProxy = new Win32SystemProxyManager()
