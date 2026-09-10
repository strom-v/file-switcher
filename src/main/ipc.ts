import { readFile, writeFile } from 'fs/promises'
import { app, dialog, ipcMain, BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { is } from '@electron-toolkit/utils'
import { proxyController } from './proxyController'
import { rulesStore, Rule } from './rulesStore'
import { getCertStatus, installCert, removeCertTrust } from './certInstaller'
import { installSudoersRule, isSudoersRuleInstalled, removeSudoersRule } from './proxySystemConfig'
import { platform } from './platform'
import { replayRequest } from './replayRequest'
import { logStore } from './logStore'
import { streamLogExport, type LogExportFormat } from './logExport'
import type { ProxyLogEvent } from '../shared/types'

// защита от IPC, пришедшего не из нашего renderer: у приложения одно окно с локальным контентом,
// setWindowOpenHandler запрещает новые — но если renderer скомпрометирован (XSS в показанном теле,
// зависимость UI), app:relaunch + dialog:saveTextFile + cert:* становятся удобными примитивами.
// В dev origin — dev-сервер electron-vite (http://localhost:5173), в проде — file://.
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? ''
  if (is.dev) return url.startsWith('http://localhost:') || url.startsWith('file://')
  return url.startsWith('file://')
}

/** Обёртка над ipcMain.handle: отклоняет вызовы из недоверенного фрейма до передачи в handler */
function handle(channel: string, handler: (event: IpcMainInvokeEvent, ...args: never[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event)) {
      throw new Error(`IPC ${channel}: запрос из недоверенного источника отклонён`)
    }
    return (handler as (event: IpcMainInvokeEvent, ...a: unknown[]) => unknown)(event, ...args)
  })
}

/** Регистрирует все ipcMain-обработчики и подписки на события прокси */
export function registerIpcHandlers(): void {
  handle('rules:get', () => rulesStore.getAll())

  handle('rules:save', (_event, rules: Rule[]) => rulesStore.saveAll(rules))

  handle('proxy:start', (_event, port: number) => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { ...proxyController.getState(), status: 'crashed', error: `Некорректный порт: ${port}` }
    }
    proxyController.start(rulesStore.getFilePath(), port)
    return proxyController.getState()
  })

  handle('proxy:stop', async () => {
    await proxyController.stop()
    return proxyController.getState()
  })

  handle('proxy:status', () => proxyController.getState())

  handle('system:sudoersInstalled', () => isSudoersRuleInstalled())

  handle('system:installSudoersRule', () => installSudoersRule())

  handle('system:removeSudoersRule', () => removeSudoersRule())

  handle('system:vpnStatus', () => platform.systemProxy.getVpnStatus())

  handle('cert:status', () => getCertStatus())

  handle('cert:install', async () => {
    await installCert()
    return getCertStatus()
  })

  handle('cert:remove', async () => {
    await removeCertTrust()
    return getCertStatus()
  })

  handle('proxy:replayRequest', async (_event, logEvent: ProxyLogEvent) => {
    const replayed = await replayRequest(logEvent)
    // повтор попадает в тот же файл лога отдельной записью event: 'replay'
    const [meta] = logStore.appendBatch([replayed])
    broadcastLogStoreWarning()
    return meta
  })

  handle('log:getRecent', () => logStore.getRecent())

  handle('log:getEvent', (_event, ts: number) => logStore.getEvent(ts))

  handle('log:search', (_event, query: string, searchInBody: boolean) => logStore.search(query, searchInBody))

  handle('log:export', async (_event, format: LogExportFormat, defaultFileName: string) => {
    const result = await dialog.showSaveDialog({ defaultPath: defaultFileName })
    if (result.canceled || !result.filePath) return null
    await streamLogExport(logStore.getFilePath(), result.filePath, format)
    return result.filePath
  })

  handle('window:toggleDevTools', (event) => {
    event.sender.toggleDevTools()
  })

  handle('window:isDevToolsOpened', (event) => event.sender.isDevToolsOpened())

  // app.relaunch() только планирует перезапуск при следующем выходе — сам app.quit() ниже
  // проходит через уже существующий 'before-quit' хендлер в main.ts, который останавливает
  // прокси и откатывает системный прокси-настройки перед реальным завершением процесса
  handle('app:relaunch', () => {
    app.relaunch()
    app.quit()
  })

  handle('dialog:openTextFile', async (_event, extensions?: string[]) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: extensions ? [{ name: 'Files', extensions }] : undefined
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return readFile(result.filePaths[0], 'utf-8')
  })

  handle('dialog:saveTextFile', async (_event, defaultFileName: string, content: string) => {
    const result = await dialog.showSaveDialog({ defaultPath: defaultFileName })
    if (result.canceled || !result.filePath) {
      return null
    }
    await writeFile(result.filePath, content, 'utf-8')
    return result.filePath
  })

  proxyController.on('status', (state) => {
    broadcast('proxy:status', state)
  })

  proxyController.on('logBatch', (batch) => {
    broadcast('proxy:logBatch', batch)
    broadcastLogStoreWarning()
  })

  proxyController.on('stderr', (text: string) => {
    broadcast('proxy:stderr', text)
  })

  // переиспользуем тот же канал, что и ошибки прокси — rulesStore не EventEmitter-компонент прокси,
  // но пользователю без разницы, откуда пришло предупреждение, а заводить отдельный IPC-канал
  // ради одного редкого события (повреждённый rules.json) избыточно
  rulesStore.on('corrupted', (message: string) => {
    broadcast('proxy:stderr', `rules.json повреждён, правила сброшены к пустому списку: ${message}`)
  })
}

/** Передаёт renderer одно предупреждение об отключении traffic-log */
function broadcastLogStoreWarning(): void {
  const warning = logStore.consumeDiskLoggingWarning()
  if (warning) broadcast('proxy:stderr', warning)
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload)
  }
}
