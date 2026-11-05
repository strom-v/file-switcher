import { app, BrowserWindow, Menu, Tray, nativeImage, session, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc'
import { proxyController } from './proxyController'
import packageJson from '../../package.json'

let mainWindow: BrowserWindow | null = null
// держим ссылку, иначе GC уберёт иконку из menu bar
let tray: Tray | null = null

// CSP для renderer. В проде — только собственные ресурсы (style-src unsafe-inline нужен antd,
// который вставляет <style> в рантайме). В dev дополнительно нужен ws: для HMR electron-vite и
// unsafe-inline/eval для его дев-клиента. Ставим заголовком, а не только meta-тегом в index.html —
// meta не покрывает dev-URL и не даёт заблокировать connect-src.
const CSP_PROD =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
const CSP_DEV =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws:"

function applyCsp(): void {
  const csp = is.dev ? CSP_DEV : CSP_PROD
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    })
  })
}

/** Создаёт главное окно приложения */
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 680,
    show: false,
    autoHideMenuBar: true,
    icon: join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js')
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
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

/** Показывает главное окно, создавая его при необходимости */
function showWindow(): void {
  if (!mainWindow) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/** Создаёт иконку в menu bar */
function createTray(): void {
  const iconPath = is.dev
    ? join(__dirname, '../../resources/trayTemplate.png')
    : join(process.resourcesPath, 'trayTemplate.png')
  tray = new Tray(nativeImage.createFromPath(iconPath))
  tray.setToolTip('FileSwitcher')
  const menu = Menu.buildFromTemplate([
    { label: 'Открыть FileSwitcher', click: showWindow },
    { type: 'separator' },
    { label: 'Выйти', click: () => app.quit() }
  ])
  tray.on('click', showWindow)
  tray.on('right-click', () => tray?.popUpContextMenu(menu))
}

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', showWindow)

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.fileswitcher.app')
    applyCsp()

    // приложение живёт в menu bar; в собранном .app Dock скрыт ещё и через LSUIElement
    app.dock?.hide()

    app.setAboutPanelOptions({
      applicationName: 'FileSwitcher',
      applicationVersion: packageJson.version,
      copyright: 'FileSwitcher — локальный прокси для подмены файлов'
    })

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // страховка: если прошлый запуск завершился аварийно с включённым системным прокси
    // (например приложение упало), возвращаем прокси в исходное состояние сейчас, до того как
    // пользователь успеет запустить новый прокси или столкнётся с потерей сети. На платформах
    // без своей реализации recoverStaleSystemProxy — no-op (см. platform/unsupported.ts)
    await proxyController.recoverStaleSystemProxy('127.0.0.1').catch(() => {
      // best-effort: если не получилось (например пользователь отменил диалог авторизации),
      // ничего страшного — обычный запуск прокси всё равно попробует настроить систему заново
    })

    registerIpcHandlers()
    createTray()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
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
