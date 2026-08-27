import { existsSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir, userInfo } from 'os'
import { app } from 'electron'
import { execAsync } from './execAsync'
import { readJsonFile, writeJsonFile } from './jsonFile'
import { vpnAllowlistStore } from './vpnAllowlistStore'
import type { VpnService } from '../shared/types'

const SUDOERS_FILE = '/etc/sudoers.d/filesswitcher-networksetup'

// Выполняет shell-скрипт с правами администратора через один системный диалог авторизации (Touch ID/пароль).
async function runAsAdminViaOsascript(script: string): Promise<void> {
  const escaped = script.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  await execAsync(`osascript -e 'do shell script "${escaped}" with administrator privileges'`)
}

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
    await runAsAdminViaOsascript(script)
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
  return readJsonFile<SavedStatesFile | null>(getStateFilePath(), null)
}

function writeSavedStates(states: SavedStatesFile): void {
  writeJsonFile(getStateFilePath(), states)
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
    await runAsAdminViaOsascript(combined)
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

interface ConnectedVpnService {
  uuid: string
  name: string
}

// Подключённые (Connected) VPN network services по данным `scutil --nc list`, с UUID для сопоставления с интерфейсом.
async function getConnectedVpnServices(): Promise<ConnectedVpnService[]> {
  const output = await execAsync('scutil --nc list')
  const services: ConnectedVpnService[] = []
  for (const line of output.split('\n')) {
    const match = line.match(/^\*?\s*\(Connected\)\s+(\S+).*"([^"]+)"/)
    if (match) services.push({ uuid: match[1], name: match[2] })
  }
  return services
}

async function getConnectedVpnServiceNames(): Promise<string[]> {
  return (await getConnectedVpnServices()).map((service) => service.name)
}

// Точное имя интерфейса (utunN) для сервиса по его UUID — из системного dynamic store
// (то же место, что использует System Preferences), а не по эвристике/имени процесса.
async function getServiceInterfaceName(uuid: string): Promise<string | null> {
  for (const family of ['IPv4', 'IPv6']) {
    try {
      const output = await execAsync(`echo "show State:/Network/Service/${uuid}/${family}" | scutil`)
      const match = output.match(/InterfaceName\s*:\s*(\S+)/)
      if (match) return match[1]
    } catch {
      // сервис может не иметь состояния в этом family — пробуем следующий
    }
  }
  return null
}

// utunN-интерфейсы, уже принадлежащие подключённым именованным VPN-сервисам — их не нужно
// повторно учитывать как "безымянный" VPN при подсчёте активных utun-туннелей.
async function getNamedServiceInterfaces(connectedServices: ConnectedVpnService[]): Promise<Set<string>> {
  const interfaces = await Promise.all(connectedServices.map((service) => getServiceInterfaceName(service.uuid)))
  return new Set(interfaces.filter((name): name is string => name !== null))
}

// Есть ли активный utun-туннель с IP, не принадлежащий уже учтённому именованному VPN-сервису —
// ловит по-настоящему безымянные VPN (WireGuard и т.п.); пустые utun (AWDL и т.п.) не считаются.
async function hasActiveUtunTunnel(namedServiceInterfaces: Set<string>): Promise<boolean> {
  const output = await execAsync('ifconfig')
  const interfaceBlocks = output.split(/\n(?=\S)/)
  return interfaceBlocks.some((block) => {
    const match = block.match(/^(utun\d+):/)
    if (!match || namedServiceInterfaces.has(match[1])) return false
    return /\n\tinet\s/.test(block)
  })
}

// Процессы известных VPN-клиентов, создающих безымянный (не networksetup-сервис) utun-туннель.
// Два разных способа обнаружения, т.к. клиенты по-разному владеют туннелем:
// - amneziawg-go (WireGuard-based) сам держит видимый UDP-сокет наружу — его находит nettop без sudo,
//   даже будучи root-процессом (в отличие от lsof).
// - OpenVPN Connect (ovpnagent) обрабатывает туннель на уровне system extension/kernel и не оставляет
//   в nettop никакого сетевого сокета от себя — там виден только "простой" трафик приложений через utun,
//   не сам VPN-клиент. Поэтому для него проверяем просто факт, что процесс запущен (`ps`), не сетевую активность.
const NETTOP_DETECTABLE_VPN_CLIENTS: Record<string, string> = {
  'amneziawg-go': 'AmneziaVPN'
}
const PROCESS_ONLY_VPN_CLIENTS: Record<string, string> = {
  ovpnagent: 'OpenVPN Connect'
}

// Клиенты, для которых индикатор не показывается красным по явному запросу пользователя (2026-08-24) —
// подмена через них физически всё ещё не работает (нет networksetup-сервиса, см. IDEAS.md), это чисто
// косметическое решение "не пугать индикатором для этого VPN", а не реальная поддержка проксирования.
const UNNAMED_VPN_CLIENTS_TREATED_AS_ALLOWED = new Set(['OpenVPN Connect', 'OpenVPN'])

// Пытается опознать владельца безымянного utun по активности/наличию известных VPN-клиентских процессов.
// Возвращает имя клиента, только если ровно один из известных процессов сейчас активен —
// при нескольких одновременно нельзя достоверно сказать, какой из них создал именно этот utun.
async function detectUnnamedVpnClientName(): Promise<string | null> {
  const nettopNames = Object.keys(NETTOP_DETECTABLE_VPN_CLIENTS)
  const pFlags = nettopNames.map((name) => `-p ${name}`).join(' ')

  let nettopOutput = ''
  try {
    nettopOutput = await execAsync(`nettop ${pFlags} -l 1 -x`)
  } catch {
    // nettop недоступен — считаем, что ни один из этих клиентов не активен
  }
  const activeFromNettop = nettopNames.filter((name) => new RegExp(`^\\S+ ${name}\\.\\d+`, 'm').test(nettopOutput))

  let psOutput = ''
  try {
    psOutput = await execAsync('ps ax -o comm=')
  } catch {
    // ps недоступен — пропускаем эту группу клиентов
  }
  const processOnlyNames = Object.keys(PROCESS_ONLY_VPN_CLIENTS)
  const activeFromPs = processOnlyNames.filter((name) => new RegExp(`(^|/)${name}$`, 'm').test(psOutput))

  const detected = [
    ...activeFromNettop.map((name) => NETTOP_DETECTABLE_VPN_CLIENTS[name]),
    ...activeFromPs.map((name) => PROCESS_ONLY_VPN_CLIENTS[name])
  ]
  if (detected.length !== 1) return null
  return detected[0]
}

/** Активен ли сейчас хоть один VPN — именованный сервис или безымянный utun-туннель. */
export async function isVpnActive(): Promise<boolean> {
  const connectedServices = await getConnectedVpnServices()
  if (connectedServices.length > 0) return true
  const namedServiceInterfaces = await getNamedServiceInterfaces(connectedServices)
  return hasActiveUtunTunnel(namedServiceInterfaces)
}

/** Список активных VPN для UI: именованные сервисы (можно разрешить/запретить прокси) плюс `{ name: null }`, если есть ещё и безымянный utun, не принадлежащий ни одному из них (только индикация, имя клиента — best-effort). */
export async function getVpnServices(): Promise<VpnService[]> {
  const connectedServices = await getConnectedVpnServices()
  const namedServiceInterfaces = await getNamedServiceInterfaces(connectedServices)
  const hasUtun = await hasActiveUtunTunnel(namedServiceInterfaces)
  const services: VpnService[] = connectedServices.map(({ name }) => ({
    name,
    allowed: vpnAllowlistStore.isAllowed(name)
  }))
  if (hasUtun) {
    const detectedName = await detectUnnamedVpnClientName()
    const allowed = detectedName !== null && UNNAMED_VPN_CLIENTS_TREATED_AS_ALLOWED.has(detectedName)
    services.push({ name: null, allowed, detectedClientName: detectedName })
  }
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
