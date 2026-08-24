import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir, userInfo } from 'os'
import { app } from 'electron'
import { execAsync } from './execAsync'
import { vpnAllowlistStore } from './vpnAllowlistStore'
import type { VpnService } from '../shared/types'

const SUDOERS_FILE = '/etc/sudoers.d/filesswitcher-networksetup'

// Разрешает networksetup без пароля/Touch ID при каждом старте/остановке прокси — NOPASSWD только на этот бинарник, не на произвольные команды.
export function isSudoersRuleInstalled(): boolean {
  return existsSync(SUDOERS_FILE)
}

/** Устанавливает NOPASSWD-правило для networksetup через один системный диалог авторизации (Touch ID/пароль). */
export async function installSudoersRule(): Promise<void> {
  const rule = `${userInfo().username} ALL=(root) NOPASSWD: /usr/sbin/networksetup`
  const tmpFile = join(tmpdir(), `filesswitcher-sudoers-${Date.now()}`)
  writeFileSync(tmpFile, `${rule}\n`, { mode: 0o440 })

  try {
    const script = [
      `visudo -c -f "${tmpFile}"`,
      `cp "${tmpFile}" "${SUDOERS_FILE}"`,
      `chmod 440 "${SUDOERS_FILE}"`,
      `chown root:wheel "${SUDOERS_FILE}"`
    ].join(' && ')
    const escaped = script.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    await execAsync(`osascript -e 'do shell script "${escaped}" with administrator privileges'`)
  } finally {
    unlinkSync(tmpFile)
  }
}

interface SavedProxyState {
  webEnabled: boolean
  webServer: string
  webPort: string
  secureWebEnabled: boolean
  secureWebServer: string
  secureWebPort: string
}

type SavedStatesFile = Record<string, SavedProxyState>

// сохраняем на диск, а не только в памяти — иначе падение Electron с включённым прокси делает откат невозможным
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

// Выполняет networksetup-команды с правами администратора: сперва sudo -n по одной (см. scripts/setup_sudoers.sh), при неудаче — общий диалог авторизации macOS.
async function execAsAdmin(networksetupArgs: string[]): Promise<void> {
  try {
    for (const args of networksetupArgs) {
      await execAsync(`sudo -n networksetup ${args}`)
    }
  } catch {
    const combined = networksetupArgs.map((args) => `networksetup ${args}`).join(' && ')
    const escaped = combined.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    await execAsync(`osascript -e 'do shell script "${escaped}" with administrator privileges'`)
  }
}

// Активные network services macOS, кроме VPN — на VPN прокси ставится отдельно, только если разрешён (см. enableSystemProxy).
async function getActiveNonVpnServices(vpnNames: string[]): Promise<string[]> {
  const allOutput = await execAsync('networksetup -listallnetworkservices')
  const vpnNameSet = new Set(vpnNames)
  return allOutput
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('*') && !vpnNameSet.has(line))
}

// Имена подключённых (Connected) VPN network services по данным `scutil --nc list`.
async function getConnectedVpnServiceNames(): Promise<string[]> {
  const output = await execAsync('scutil --nc list')
  const names: string[] = []
  for (const line of output.split('\n')) {
    const match = line.match(/^\*?\s*\(Connected\).*"([^"]+)"/)
    if (match) names.push(match[1])
  }
  return names
}

// Есть ли активный utun-туннель с IP — ловит любой VPN, включая безымянные (WireGuard и т.п.); пустые utun (AWDL и т.п.) не считаются.
async function hasActiveUtunTunnel(): Promise<boolean> {
  const output = await execAsync('ifconfig')
  const interfaceBlocks = output.split(/\n(?=\S)/)
  return interfaceBlocks.some((block) => /^utun\d+:/.test(block) && /\n\tinet\s/.test(block))
}

/** Активен ли сейчас хоть один VPN — именованный сервис или безымянный utun-туннель. */
export async function isVpnActive(): Promise<boolean> {
  const [vpnNames, hasUtun] = await Promise.all([getConnectedVpnServiceNames(), hasActiveUtunTunnel()])
  return vpnNames.length > 0 || hasUtun
}

/** Список активных VPN для UI: именованные сервисы (можно разрешить/запретить прокси) плюс `{ name: null }`, если есть ещё и безымянный utun (только индикация). */
export async function getVpnServices(): Promise<VpnService[]> {
  const [vpnNames, hasUtun] = await Promise.all([getConnectedVpnServiceNames(), hasActiveUtunTunnel()])
  const services: VpnService[] = vpnNames.map((name) => ({ name, allowed: vpnAllowlistStore.isAllowed(name) }))
  if (hasUtun) services.push({ name: null, allowed: false })
  return services
}

export function setVpnServiceAllowed(name: string, allowed: boolean): void {
  vpnAllowlistStore.setAllowed(name, allowed)
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
      ? `-setwebproxy "${service}" ${saved.webServer} ${saved.webPort}`
      : `-setwebproxystate "${service}" off`,
    saved.secureWebEnabled && saved.secureWebServer
      ? `-setsecurewebproxy "${service}" ${saved.secureWebServer} ${saved.secureWebPort}`
      : `-setsecurewebproxystate "${service}" off`
  ]
}

/** Выполняет networksetup-команды, возвращающие прокси всех сервисов в сохранённое состояние */
async function restoreSavedStates(states: SavedStatesFile): Promise<void> {
  const commands = Object.entries(states).flatMap(([service, saved]) => buildRestoreCommand(service, saved))
  await execAsAdmin(commands)
}

/** Включает системный HTTP/HTTPS-прокси на активных сервисах (плюс разрешённые VPN), сохранив исходное состояние на диск для восстановления при остановке/падении. */
export async function enableSystemProxy(host: string, port: number): Promise<void> {
  const vpnNames = await getConnectedVpnServiceNames()
  const nonVpnServices = await getActiveNonVpnServices(vpnNames)
  const allowedVpnServices = vpnNames.filter((name) => vpnAllowlistStore.isAllowed(name))
  const services = [...nonVpnServices, ...allowedVpnServices]
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

    commands.push(`-setwebproxy "${service}" ${host} ${port}`)
    commands.push(`-setsecurewebproxy "${service}" ${host} ${port}`)
  }

  writeSavedStates(states)
  await execAsAdmin(commands)
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

/** Страховка на старте/выходе: восстанавливает сохранённое состояние прокси после аварийного завершения, либо выключает прокси, если файл состояния утерян. */
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

  const vpnNames = await getConnectedVpnServiceNames()
  const nonVpnServices = await getActiveNonVpnServices(vpnNames)
  const services = [...nonVpnServices, ...vpnNames]
  const staleCommands: string[] = []
  for (const service of services) {
    const { web, secureWeb } = await getServiceProxyState(service)

    if (web.enabled && web.server === host) {
      staleCommands.push(`-setwebproxystate "${service}" off`)
    }
    if (secureWeb.enabled && secureWeb.server === host) {
      staleCommands.push(`-setsecurewebproxystate "${service}" off`)
    }
  }

  if (staleCommands.length > 0) {
    await execAsAdmin(staleCommands)
  }
}
