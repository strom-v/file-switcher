import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { execAsync } from './execAsync'

interface SavedProxyState {
  webEnabled: boolean
  webServer: string
  webPort: string
  secureWebEnabled: boolean
  secureWebServer: string
  secureWebPort: string
}

type SavedStatesFile = Record<string, SavedProxyState>

// сохраняем на диск, а не только в памяти процесса — иначе перезапуск/падение Electron
// с включённым прокси делает откат невозможным (некому вспомнить исходные значения)
function getStateFilePath(): string {
  return join(app.getPath('userData'), 'proxy-system-state.json')
}

function readSavedStates(): SavedStatesFile | null {
  const filePath = getStateFilePath()
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as SavedStatesFile
  } catch {
    return null
  }
}

function writeSavedStates(states: SavedStatesFile): void {
  writeFileSync(getStateFilePath(), JSON.stringify(states, null, 2), 'utf-8')
}

function clearSavedStates(): void {
  const filePath = getStateFilePath()
  if (existsSync(filePath)) unlinkSync(filePath)
}

/**
 * Выполняет networksetup-команды с привилегиями администратора. Сначала пробует `sudo -n`
 * (неинтерактивно, без запроса пароля) — сработает мгновенно, если в /etc/sudoers настроено
 * NOPASSWD для networksetup (см. README/онбординг). Если нет — падает обратно на системный
 * диалог авторизации macOS, который спрашивает пароль/Touch ID каждый раз.
 */
async function execAsAdmin(cmd: string): Promise<string> {
  try {
    return await execAsync(`sudo -n sh -c "${cmd.replace(/"/g, '\\"')}"`)
  } catch {
    const escaped = cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    return execAsync(`osascript -e 'do shell script "${escaped}" with administrator privileges'`)
  }
}

/**
 * Активные (не отключённые пользователем) сетевые сервисы macOS, включая VPN — на них тоже
 * настраивается прокси, иначе трафик через активный VPN-туннель проходит мимо и не логируется.
 * Если VPN-клиент не готов работать вместе с системным прокси, его стоит выключать перед
 * запуском отслеживания вручную.
 */
async function getActiveNetworkServices(): Promise<string[]> {
  const output = await execAsync('networksetup -listallnetworkservices')
  return output
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('*'))
}

/**
 * Проверяет, активен ли сейчас хотя бы один VPN-туннель — определяется по наличию `utun`-интерфейса
 * с назначенным IP-адресом (`inet ...`). Это ловит любой VPN независимо от того, зарегистрирован ли
 * он как сервис в System Settings → Network (как VPN MIR) или запускается напрямую через своё
 * приложение без системной конфигурации (WireGuard-клиенты и т.п.) — оба варианта используют
 * utun под капотом. Пустые utun-интерфейсы без IP (их создаёт сама macOS для AWDL/Private Relay
 * и т.п. даже без VPN) не считаются. Только чтение, не требует прав администратора.
 */
export async function isVpnActive(): Promise<boolean> {
  const output = await execAsync('ifconfig')
  const interfaceBlocks = output.split(/\n(?=\S)/)
  return interfaceBlocks.some((block) => /^utun\d+:/.test(block) && /\n\tinet\s/.test(block))
}

interface ProxyGetResult {
  enabled: boolean
  server: string
  port: string
}

function parseProxyGetOutput(output: string): ProxyGetResult {
  const enabled = /Enabled:\s*Yes/i.test(output)
  const server = output.match(/Server:\s*(.*)/)?.[1]?.trim() ?? ''
  const port = output.match(/Port:\s*(.*)/)?.[1]?.trim() ?? ''
  return { enabled, server, port }
}

/** Текущее состояние HTTP и HTTPS прокси конкретного сетевого сервиса */
async function getServiceProxyState(service: string): Promise<{ web: ProxyGetResult; secureWeb: ProxyGetResult }> {
  const [webOutput, secureWebOutput] = await Promise.all([
    execAsync(`networksetup -getwebproxy "${service}"`),
    execAsync(`networksetup -getsecurewebproxy "${service}"`)
  ])
  return { web: parseProxyGetOutput(webOutput), secureWeb: parseProxyGetOutput(secureWebOutput) }
}

function buildRestoreCommand(service: string, saved: SavedProxyState): string[] {
  return [
    saved.webEnabled && saved.webServer
      ? `networksetup -setwebproxy "${service}" ${saved.webServer} ${saved.webPort}`
      : `networksetup -setwebproxystate "${service}" off`,
    saved.secureWebEnabled && saved.secureWebServer
      ? `networksetup -setsecurewebproxy "${service}" ${saved.secureWebServer} ${saved.secureWebPort}`
      : `networksetup -setsecurewebproxystate "${service}" off`
  ]
}

/** Выполняет networksetup-команды, возвращающие прокси всех сервисов в сохранённое состояние */
async function restoreSavedStates(states: SavedStatesFile): Promise<void> {
  const commands = Object.entries(states).flatMap(([service, saved]) => buildRestoreCommand(service, saved))
  await execAsAdmin(commands.join(' && '))
}

/**
 * Включает системный HTTP/HTTPS-прокси macOS на всех активных физических интерфейсах (как это
 * делает Fiddler на Windows автоматически), предварительно сохраняя исходное состояние на диск
 * для восстановления при остановке — переживает перезапуск/падение приложения. Требует
 * привилегий администратора — macOS покажет системный диалог авторизации (либо пройдёт молча,
 * если настроен sudoers NOPASSWD).
 */
export async function enableSystemProxy(host: string, port: number): Promise<void> {
  const services = await getActiveNetworkServices()
  if (services.length === 0) return

  const states: SavedStatesFile = {}
  const commands: string[] = []

  for (const service of services) {
    const { web, secureWeb } = await getServiceProxyState(service)

    states[service] = {
      webEnabled: web.enabled,
      webServer: web.server,
      webPort: web.port,
      secureWebEnabled: secureWeb.enabled,
      secureWebServer: secureWeb.server,
      secureWebPort: secureWeb.port
    }

    commands.push(`networksetup -setwebproxy "${service}" ${host} ${port}`)
    commands.push(`networksetup -setsecurewebproxy "${service}" ${host} ${port}`)
  }

  writeSavedStates(states)
  await execAsAdmin(commands.join(' && '))
}

/** Восстанавливает системный прокси в состояние, которое было до enableSystemProxy() */
export async function disableSystemProxy(): Promise<void> {
  const states = readSavedStates()
  if (!states || Object.keys(states).length === 0) {
    clearSavedStates()
    return
  }

  clearSavedStates()
  await restoreSavedStates(states)
}

/**
 * Страховка на старте/выходе из приложения: если на диске остался файл сохранённого состояния
 * (прошлый запуск завершился аварийно, не успев откатить прокси) — восстанавливает его. Если
 * файла нет, но системный прокси всё ещё указывает на локальный адрес (например файл состояния
 * был утерян) — на всякий случай выключает прокси, чтобы не оставить пользователя без интернета.
 */
export async function recoverStaleSystemProxy(host: string): Promise<void> {
  const states = readSavedStates()
  if (states && Object.keys(states).length > 0) {
    clearSavedStates()
    try {
      await restoreSavedStates(states)
    } catch {
      // не удалось восстановить точное состояние — ниже всё равно проверим и выключим при необходимости
    }
    return
  }

  const services = await getActiveNetworkServices()
  const staleCommands: string[] = []
  for (const service of services) {
    const { web, secureWeb } = await getServiceProxyState(service)

    if (web.enabled && web.server === host) {
      staleCommands.push(`networksetup -setwebproxystate "${service}" off`)
    }
    if (secureWeb.enabled && secureWeb.server === host) {
      staleCommands.push(`networksetup -setsecurewebproxystate "${service}" off`)
    }
  }

  if (staleCommands.length > 0) {
    await execAsAdmin(staleCommands.join(' && '))
  }
}
