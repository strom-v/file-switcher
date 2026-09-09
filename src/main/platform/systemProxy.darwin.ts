import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir, userInfo } from 'os'
import { app } from 'electron'
import { execAsync } from '../execAsync'
import { readJsonFile, writeJsonFile } from '../jsonFile'
import type { SystemProxyManager } from './types'
import type { VpnStatus } from '../../shared/types'

const SUDOERS_FILE = '/etc/sudoers.d/filesswitcher-networksetup'

// правило sudoers: passwordless только для четырёх подкоманд networksetup, которыми приложение
// включает/выключает системный прокси — не для всего бинарника. Args-glob '*' в sudoers покрывает
// имя сетевого сервиса и host/port. Функция от username, чтобы сверять содержимое файла (см.
// isPasswordlessSetup) и не полагаться только на факт его существования.
function sudoersRuleFor(username: string): string {
  const cmds = [
    '/usr/sbin/networksetup -setwebproxy *',
    '/usr/sbin/networksetup -setsecurewebproxy *',
    '/usr/sbin/networksetup -setwebproxystate *',
    '/usr/sbin/networksetup -setsecurewebproxystate *'
  ].join(', ')
  return `${username} ALL=(root) NOPASSWD: ${cmds}`
}

// Выполняет shell-скрипт с правами администратора через один системный диалог авторизации (Touch ID/пароль).
// osascript сам не проходит через внешний shell (execFile), но AppleScript "do shell script" исполняет
// переданную строку через свой собственный shell — экранирование здесь обязательно и остаётся, это
// не Node.js shell-инъекция, а часть протокола AppleScript.
async function runAsAdminViaOsascript(script: string): Promise<void> {
  const escaped = script.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  // без таймаута execAsync по умолчанию (10с) — пользователь может думать над Touch ID/паролем
  // в системном диалоге сколько угодно, это не зависание, а ожидаемое ожидание ввода
  await execAsync('osascript', ['-e', `do shell script "${escaped}" with administrator privileges`], 0)
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

// экранирует один аргумент для вставки в POSIX-shell строку (single-quote wrapping,
// стандартный приём: закрыть кавычку, вставить экранированную одинарную кавычку, открыть заново)
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

// Выполняет networksetup-команды с правами администратора: сперва sudo -n по одной (см. scripts/setup_sudoers.sh),
// при неудаче — общий диалог авторизации macOS. Каждая команда — массив аргументов networksetup
// (без самого "networksetup" в начале), не готовая строка — исключает инъекцию через имя сервиса.
async function execAsAdmin(networksetupCommands: string[][]): Promise<void> {
  try {
    for (const args of networksetupCommands) {
      await execAsync('sudo', ['-n', 'networksetup', ...args])
    }
  } catch {
    // do shell script принимает только строку — единственное место, где аргументы обратно
    // собираются в shell-команду, поэтому здесь обязателен ручной shell-quoting каждого аргумента
    const combined = networksetupCommands
      .map((args) => ['networksetup', ...args].map(shellQuote).join(' '))
      .join(' && ')
    await runAsAdminViaOsascript(combined)
  }
}

// Активные network services macOS (Wi-Fi, Ethernet и т.п.)
async function getActiveServices(): Promise<string[]> {
  const allOutput = await execAsync('networksetup', ['-listallnetworkservices'])
  return allOutput
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('*'))
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
    execAsync('networksetup', ['-getwebproxy', service]),
    execAsync('networksetup', ['-getsecurewebproxy', service])
  ])
  return { web: parseProxyGetOutput(webOutput), secureWeb: parseProxyGetOutput(secureWebOutput) }
}

function buildRestoreCommand(service: string, saved: SavedProxyState): string[][] {
  return [
    saved.webEnabled && saved.webServer
      ? ['-setwebproxy', service, saved.webServer, saved.webPort]
      : ['-setwebproxystate', service, 'off'],
    saved.secureWebEnabled && saved.secureWebServer
      ? ['-setsecurewebproxy', service, saved.secureWebServer, saved.secureWebPort]
      : ['-setsecurewebproxystate', service, 'off']
  ]
}

/** Выполняет networksetup-команды, возвращающие прокси всех сервисов в сохранённое состояние */
async function restoreSavedStates(states: SavedStatesFile): Promise<void> {
  const commands = Object.entries(states).flatMap(([service, saved]) => buildRestoreCommand(service, saved))
  await execAsAdmin(commands)
}

// туннельные интерфейсы macOS: utun (большинство VPN, WireGuard, iCloud Private Relay),
// ppp/ipsec (устаревшие L2TP/PPTP), tap/tun (TunTap-драйверы старых OpenVPN-клиентов)
const TUNNEL_IFACE_RE = /^(utun|ppp|ipsec|tap|tun|wg)\d+$/

/** Имя интерфейса, через который идёт дефолтный маршрут (route -n get default → "interface: en0") */
async function getDefaultRouteInterface(): Promise<string | null> {
  try {
    const output = await execAsync('route', ['-n', 'get', 'default'])
    return output.match(/interface:\s*(\S+)/)?.[1] ?? null
  } catch {
    return null
  }
}

/** Есть ли подключённый VPN-сервис по данным scutil (именованные: IKEv2, OpenVPN Connect, Cisco и т.п.) */
async function hasConnectedVpnService(): Promise<boolean> {
  try {
    const output = await execAsync('scutil', ['--nc', 'list'])
    return output.split('\n').some((line) => /^\*?\s*\(Connected\)/.test(line.trim()))
  } catch {
    return false
  }
}

/** Активные туннельные интерфейсы с реальным (не link-local) IPv4 — ловит и безымянные VPN
 * (WireGuard-kext, Tailscale), но не пустые utun от AWDL/Handoff */
async function getActiveTunnelInterfaces(): Promise<string[]> {
  try {
    const output = await execAsync('ifconfig')
    const result: string[] = []
    for (const block of output.split(/\n(?=\S)/)) {
      const name = block.match(/^([a-z]+\d+):/)?.[1]
      if (!name || !TUNNEL_IFACE_RE.test(name)) continue
      if (/\n\tinet\s/.test(block) && !/\n\tinet 169\.254/.test(block)) {
        result.push(name)
      }
    }
    return result
  } catch {
    return []
  }
}

// корпоративные VPN-клиенты, которые не показываются в scutil и часто ставят системный extension,
// а не отдельный интерфейс с явным IP — детектим по процессу
const CORP_VPN_PROCESS_RE = /GlobalProtect|Cisco\s*Secure\s*Client|AnyConnect|vpnagentd|Zscaler|NetExtender|Ivanti/i

async function hasCorpVpnProcess(): Promise<boolean> {
  try {
    const output = await execAsync('ps', ['-Ao', 'comm='])
    return CORP_VPN_PROCESS_RE.test(output)
  } catch {
    return false
  }
}

class DarwinSystemProxyManager implements SystemProxyManager {
  /** true только если файл sudoers существует И содержит актуальное правило для текущего пользователя —
   * иначе (файл от прежнего имени пользователя, обрезан, отредактирован) приложение всё равно упрётся
   * в диалог авторизации, и честнее заново предложить настройку, чем молча считать её выполненной */
  isPasswordlessSetup(): boolean {
    if (!existsSync(SUDOERS_FILE)) return false
    try {
      return readFileSync(SUDOERS_FILE, 'utf-8').includes(sudoersRuleFor(userInfo().username))
    } catch {
      return false
    }
  }

  async setUpPasswordless(): Promise<void> {
    const rule = sudoersRuleFor(userInfo().username)
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

  /** Удаляет sudoers-правило — passwordless-настройка отзывается, дальше networksetup снова
   * через диалог авторизации. No-op, если файла нет. */
  async revokePasswordless(): Promise<void> {
    if (!existsSync(SUDOERS_FILE)) return
    await runAsAdminViaOsascript(`rm -f "${SUDOERS_FILE}"`)
  }

  async getVpnStatus(): Promise<VpnStatus> {
    const [defaultIface, byService, tunnels, byCorpProcess] = await Promise.all([
      getDefaultRouteInterface(),
      hasConnectedVpnService(),
      getActiveTunnelInterfaces(),
      hasCorpVpnProcess()
    ])

    const active = byService || tunnels.length > 0 || byCorpProcess
    // весь трафик через VPN, если дефолтный маршрут указывает на туннельный интерфейс —
    // именно этот случай ломает перехват системного прокси (split-tunnel сюда не попадает)
    const blocksProxy = !!defaultIface && (TUNNEL_IFACE_RE.test(defaultIface) || tunnels.includes(defaultIface))

    return { active, blocksProxy }
  }

  /** Включает системный HTTP/HTTPS-прокси на всех активных сервисах, сохранив исходное состояние на диск.
   * Бросает, если активных сетевых сервисов нет — иначе вызывающий код не может отличить "прокси
   * реально применён" от "применять было не на что", а статус в UI всё равно станет "running". */
  async enable(host: string, port: number): Promise<void> {
    const services = await getActiveServices()
    if (services.length === 0) {
      throw new Error('Нет активных сетевых сервисов — системный прокси не применён ни к одному интерфейсу')
    }

    // состояния сервисов независимы друг от друга — запрашиваем параллельно, а не по одному в цикле:
    // с несколькими активными интерфейсами (Wi-Fi + Ethernet + VPN) это меньше networksetup-спавнов подряд
    const serviceStates = await Promise.all(
      services.map(async (service) => ({ service, ...(await getServiceProxyState(service)) }))
    )

    const states: SavedStatesFile = {}
    const commands: string[][] = []

    for (const { service, web, secureWeb } of serviceStates) {
      states[service] = {
        webEnabled: web.enabled,
        webServer: web.server,
        webPort: web.port,
        secureWebEnabled: secureWeb.enabled,
        secureWebServer: secureWeb.server,
        secureWebPort: secureWeb.port
      }

      commands.push(['-setwebproxy', service, host, String(port)])
      commands.push(['-setsecurewebproxy', service, host, String(port)])
    }

    writeSavedStates(states)
    await execAsAdmin(commands)
  }

  async disable(): Promise<void> {
    const states = readSavedStates()
    if (!states || Object.keys(states).length === 0) {
      clearSavedStates()
      return
    }

    clearSavedStates()
    await restoreSavedStates(states)
  }

  async recoverStale(host: string): Promise<void> {
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

    const services = await getActiveServices()
    const serviceStates = await Promise.all(
      services.map(async (service) => ({ service, ...(await getServiceProxyState(service)) }))
    )

    const staleCommands: string[][] = []
    for (const { service, web, secureWeb } of serviceStates) {
      if (web.enabled && web.server === host) {
        staleCommands.push(['-setwebproxystate', service, 'off'])
      }
      if (secureWeb.enabled && secureWeb.server === host) {
        staleCommands.push(['-setsecurewebproxystate', service, 'off'])
      }
    }

    if (staleCommands.length > 0) {
      await execAsAdmin(staleCommands)
    }
  }
}

export const darwinSystemProxy = new DarwinSystemProxyManager()
