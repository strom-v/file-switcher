import { contextBridge, ipcRenderer } from 'electron'
import type { Rule, ProxyState, ProxyLogEvent, LogEntryMeta, CertStatus, VpnStatus } from '../shared/types'

const api = {
  // домашняя папка текущего пользователя — renderer сам её получить не может (contextIsolation);
  // нужна только для сокращённого показа путей подмены в списке правил. Берём из process.env
  // (доступен и в sandboxed-preload), а не из os.homedir() — чтобы не тянуть в preload модуль 'os'
  // и держать sandbox:true у окна
  homeDir: process.env.HOME || process.env.USERPROFILE || '',
  // платформа — для UI-веток, которые имеют смысл только на части ОС (напр. sudoers-настройка на macOS)
  platform: process.platform,
  rules: {
    get: (): Promise<Rule[]> => ipcRenderer.invoke('rules:get'),
    save: (rules: Rule[]): Promise<Rule[]> => ipcRenderer.invoke('rules:save', rules)
  },
  proxy: {
    start: (port: number): Promise<ProxyState> => ipcRenderer.invoke('proxy:start', port),
    stop: (): Promise<ProxyState> => ipcRenderer.invoke('proxy:stop'),
    status: (): Promise<ProxyState> => ipcRenderer.invoke('proxy:status'),
    onStatus: (callback: (state: ProxyState) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: ProxyState): void => callback(state)
      ipcRenderer.on('proxy:status', listener)
      return () => ipcRenderer.removeListener('proxy:status', listener)
    },
    // события лога приходят пачками (см. proxyController: LOG_BATCH_INTERVAL_MS) и только лёгкими
    // метаданными — тела/заголовки лежат на диске, грузятся через log.getEvent
    onLogBatch: (callback: (events: LogEntryMeta[]) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, batch: LogEntryMeta[]): void => callback(batch)
      ipcRenderer.on('proxy:logBatch', listener)
      return () => ipcRenderer.removeListener('proxy:logBatch', listener)
    },
    onStderr: (callback: (text: string) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, text: string): void => callback(text)
      ipcRenderer.on('proxy:stderr', listener)
      return () => ipcRenderer.removeListener('proxy:stderr', listener)
    },
    // повторяет запрос из лога напрямую на реальный сервер (не через прокси); передаём только ts,
    // main сам берёт исходное событие из лога; возвращает лёгкую запись event: 'replay'
    replayRequest: (ts: number): Promise<LogEntryMeta> => ipcRenderer.invoke('proxy:replayRequest', ts)
  },
  log: {
    // последние записи лога сессии для первичной отрисовки списка
    getRecent: (): Promise<LogEntryMeta[]> => ipcRenderer.invoke('log:getRecent'),
    // полное событие (с телами и заголовками) по ts — для окна деталей
    getEvent: (ts: number): Promise<ProxyLogEvent | null> => ipcRenderer.invoke('log:getEvent', ts),
    // поиск по url/файлу подмены; searchInBody — дополнительно по телу запроса/ответа
    search: (query: string, searchInBody: boolean): Promise<LogEntryMeta[]> =>
      ipcRenderer.invoke('log:search', query, searchInBody),
    // main сам выбирает путь через системный диалог и потоково пишет туда весь лог сессии
    exportAs: (format: 'har' | 'json' | 'csv', defaultFileName: string): Promise<string | null> =>
      ipcRenderer.invoke('log:export', format, defaultFileName),
    // есть ли на диске записи сессии — для доступности кнопки экспорта (renderer-список чистится отдельно)
    hasExportableEvents: (): Promise<boolean> => ipcRenderer.invoke('log:hasExportableEvents')
  },
  cert: {
    status: (): Promise<CertStatus> => ipcRenderer.invoke('cert:status'),
    install: (): Promise<CertStatus> => ipcRenderer.invoke('cert:install'),
    remove: (): Promise<CertStatus> => ipcRenderer.invoke('cert:remove')
  },
  dialog: {
    saveTextFile: (defaultFileName: string, content: string): Promise<string | null> =>
      ipcRenderer.invoke('dialog:saveTextFile', defaultFileName, content),
    openTextFile: (extensions?: string[]): Promise<string | null> =>
      ipcRenderer.invoke('dialog:openTextFile', extensions)
  },
  system: {
    sudoersInstalled: (): Promise<boolean> => ipcRenderer.invoke('system:sudoersInstalled'),
    installSudoersRule: (): Promise<void> => ipcRenderer.invoke('system:installSudoersRule'),
    removeSudoersRule: (): Promise<void> => ipcRenderer.invoke('system:removeSudoersRule'),
    vpnStatus: (): Promise<VpnStatus> => ipcRenderer.invoke('system:vpnStatus')
  },
  app: {
    // останавливает прокси/откатывает системный прокси (через 'before-quit' в main.ts) и
    // перезапускает приложение целиком — не просто перезагружает окно
    relaunch: (): Promise<void> => ipcRenderer.invoke('app:relaunch')
  },
  window: {
    // открывает/закрывает инструменты разработчика текущего окна
    toggleDevTools: (): Promise<void> => ipcRenderer.invoke('window:toggleDevTools'),
    isDevToolsOpened: (): Promise<boolean> => ipcRenderer.invoke('window:isDevToolsOpened'),
    onDevToolsChanged: (callback: (opened: boolean) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, opened: boolean): void => callback(opened)
      ipcRenderer.on('window:devToolsChanged', listener)
      return () => ipcRenderer.removeListener('window:devToolsChanged', listener)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
