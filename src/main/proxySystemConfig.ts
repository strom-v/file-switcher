import { existsSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir, userInfo } from 'os'
import { app } from 'electron'
import { execAsync } from './execAsync'
import { readJsonFile, writeJsonFile } from './jsonFile'

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

// Активные network services macOS (Wi-Fi, Ethernet и т.п.)
async function getActiveServices(): Promise<string[]> {
  const allOutput = await execAsync('networksetup -listallnetworkservices')
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

/** Включает системный HTTP/HTTPS-прокси на всех активных сервисах, сохранив исходное состояние на диск для восстановления при остановке/падении. */
export async function enableSystemProxy(host: string, port: number): Promise<void> {
  const services = await getActiveServices()
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

  const services = await getActiveServices()
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
