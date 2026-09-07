import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc'
import { proxyController } from './proxyController'
import { recoverStaleSystemProxy } from './proxySystemConfig'
import packageJson from '../../package.json'

let mainWindow: BrowserWindow | null = null

/** Создаёт главное окно приложения */
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 680,
    show: false,
    autoHideMenuBar: true,
    icon: join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // renderer держит стейт "devtools открыты?" для текста кнопки в настройках — уведомляем его об
  // открытии/закрытии, в т.ч. когда пользователь закрыл панель горячей клавишей, а не кнопкой
  const sendDevToolsState = (opened: boolean): void => {
    mainWindow?.webContents.send('window:devToolsChanged', opened)
  }
  mainWindow.webContents.on('devtools-opened', () => sendDevToolsState(true))
  mainWindow.webContents.on('devtools-closed', () => sendDevToolsState(false))

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.fileswitcher.app')

    // в dev-режиме macOS показывает в Dock стандартную иконку Electron —
    // собственная иконка приложения подхватывается только из собранного .app
    if (is.dev && process.platform === 'darwin') {
      app.dock?.setIcon(join(__dirname, '../../build/icon.png'))
    }

    app.setAboutPanelOptions({
      applicationName: 'FileSwitcher',
      applicationVersion: packageJson.version,
      copyright: 'FileSwitcher — локальный прокси для подмены файлов'
    })

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    registerIpcHandlers()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })

    // страховка: если прошлый запуск завершился аварийно с включённым системным прокси
    // (например приложение упало), возвращаем прокси в исходное состояние сейчас, до того как
    // пользователь успеет запустить новый прокси или столкнётся с потерей сети. На платформах
    // без своей реализации recoverStaleSystemProxy — no-op (см. platform/unsupported.ts)
    recoverStaleSystemProxy('127.0.0.1').catch(() => {
      // best-effort: если не получилось (например пользователь отменил диалог авторизации),
      // ничего страшного — обычный запуск прокси всё равно попробует настроить систему заново
    })
  })

  // macOS: закрытие всех окон не выходит из приложения (штатное поведение Dock); прочие платформы — выходят
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  let quitting = false

  // при закрытии приложения (Cmd+Q и т.п.) сбрасываем системный прокси, если он был включён —
  // иначе пользователь остаётся без интернета, пока сам не выключит прокси вручную
  app.on('before-quit', (event) => {
    if (quitting) return
    if (proxyController.getState().status === 'stopped') return

    event.preventDefault()
    quitting = true
    proxyController
      .stop()
      .catch(() => {
        // best-effort: даже если откат не удался, не блокируем выход из приложения навсегда
      })
      .finally(() => app.quit())
  })
}
