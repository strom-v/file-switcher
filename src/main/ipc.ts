import { readFile, writeFile } from 'fs/promises'
import { app, dialog, ipcMain, BrowserWindow } from 'electron'
import { proxyController } from './proxyController'
import { rulesStore, Rule } from './rulesStore'
import { getCertStatus, installCert, listCerts, removeCertTrust } from './certInstaller'
import { installSudoersRule, isSudoersRuleInstalled } from './proxySystemConfig'
import { replayRequest } from './replayRequest'
import type { ProxyLogEvent } from '../shared/types'

/** Регистрирует все ipcMain-обработчики и подписки на события прокси */
export function registerIpcHandlers(): void {
  ipcMain.handle('rules:get', () => rulesStore.getAll())

  ipcMain.handle('rules:save', (_event, rules: Rule[]) => rulesStore.saveAll(rules))

  ipcMain.handle('proxy:start', (_event, port: number) => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { ...proxyController.getState(), status: 'crashed', error: `Некорректный порт: ${port}` }
    }
    proxyController.start(rulesStore.getFilePath(), port)
    return proxyController.getState()
  })

  ipcMain.handle('proxy:stop', async () => {
    await proxyController.stop()
    return proxyController.getState()
  })

  ipcMain.handle('proxy:status', () => proxyController.getState())

  ipcMain.handle('system:sudoersInstalled', () => isSudoersRuleInstalled())

  ipcMain.handle('system:installSudoersRule', () => installSudoersRule())

  ipcMain.handle('cert:status', () => getCertStatus())

  ipcMain.handle('cert:list', () => listCerts())

  ipcMain.handle('cert:install', async () => {
    await installCert()
    return getCertStatus()
  })

  ipcMain.handle('cert:remove', async () => {
    await removeCertTrust()
    return getCertStatus()
  })

  ipcMain.handle('proxy:replayRequest', (_event, logEvent: ProxyLogEvent) => replayRequest(logEvent))

  ipcMain.handle('window:toggleDevTools', (event) => {
    event.sender.toggleDevTools()
  })

  ipcMain.handle('window:isDevToolsOpened', (event) => event.sender.isDevToolsOpened())

  // app.relaunch() только планирует перезапуск при следующем выходе — сам app.quit() ниже
  // проходит через уже существующий 'before-quit' хендлер в main.ts, который останавливает
  // прокси и откатывает системный прокси-настройки перед реальным завершением процесса
  ipcMain.handle('app:relaunch', () => {
    app.relaunch()
    app.quit()
  })

  ipcMain.handle('dialog:openTextFile', async (_event, extensions?: string[]) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: extensions ? [{ name: 'Files', extensions }] : undefined
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return readFile(result.filePaths[0], 'utf-8')
  })

  ipcMain.handle('dialog:saveTextFile', async (_event, defaultFileName: string, content: string) => {
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

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload)
  }
}
