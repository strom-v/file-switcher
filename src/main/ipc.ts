import { readFile, writeFile } from 'fs/promises'
import { dialog, ipcMain, BrowserWindow } from 'electron'
import { proxyController } from './proxyController'
import { rulesStore, Rule } from './rulesStore'
import { traceSettingsStore } from './traceSettingsStore'
import { getCertStatus, installCert, listCerts, removeCertTrust } from './certInstaller'
import { installSudoersRule, isSudoersRuleInstalled } from './proxySystemConfig'
import type { TrafficCaptureSettings } from '../shared/types'

/** Регистрирует все ipcMain-обработчики и подписки на события прокси */
export function registerIpcHandlers(): void {
  ipcMain.handle('rules:get', () => rulesStore.getAll())

  ipcMain.handle('rules:save', (_event, rules: Rule[]) => rulesStore.saveAll(rules))

  ipcMain.handle('trace:get', () => traceSettingsStore.get())

  ipcMain.handle('trace:save', (_event, settings: TrafficCaptureSettings) => traceSettingsStore.save(settings))

  ipcMain.handle('proxy:start', (_event, port: number) => {
    proxyController.start(rulesStore.getFilePath(), traceSettingsStore.getFilePath(), port)
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

  proxyController.on('log', (event) => {
    broadcast('proxy:log', event)
  })

  proxyController.on('stderr', (text: string) => {
    broadcast('proxy:stderr', text)
  })
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload)
  }
}
