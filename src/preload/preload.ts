import { contextBridge, ipcRenderer } from 'electron'
import type { Rule, ProxyState, ProxyLogEvent, CertStatus, CertInfo, TrafficCaptureSettings } from '../shared/types'

const api = {
  rules: {
    get: (): Promise<Rule[]> => ipcRenderer.invoke('rules:get'),
    save: (rules: Rule[]): Promise<Rule[]> => ipcRenderer.invoke('rules:save', rules)
  },
  trace: {
    get: (): Promise<TrafficCaptureSettings> => ipcRenderer.invoke('trace:get'),
    save: (settings: TrafficCaptureSettings): Promise<TrafficCaptureSettings> =>
      ipcRenderer.invoke('trace:save', settings)
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
    onLog: (callback: (event: ProxyLogEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, log: ProxyLogEvent): void => callback(log)
      ipcRenderer.on('proxy:log', listener)
      return () => ipcRenderer.removeListener('proxy:log', listener)
    },
    onStderr: (callback: (text: string) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, text: string): void => callback(text)
      ipcRenderer.on('proxy:stderr', listener)
      return () => ipcRenderer.removeListener('proxy:stderr', listener)
    }
  },
  cert: {
    status: (): Promise<CertStatus> => ipcRenderer.invoke('cert:status'),
    install: (): Promise<CertStatus> => ipcRenderer.invoke('cert:install'),
    remove: (): Promise<CertStatus> => ipcRenderer.invoke('cert:remove'),
    list: (): Promise<CertInfo[]> => ipcRenderer.invoke('cert:list')
  },
  dialog: {
    saveTextFile: (defaultFileName: string, content: string): Promise<string | null> =>
      ipcRenderer.invoke('dialog:saveTextFile', defaultFileName, content),
    openTextFile: (extensions?: string[]): Promise<string | null> =>
      ipcRenderer.invoke('dialog:openTextFile', extensions)
  },
  system: {
    sudoersInstalled: (): Promise<boolean> => ipcRenderer.invoke('system:sudoersInstalled'),
    installSudoersRule: (): Promise<void> => ipcRenderer.invoke('system:installSudoersRule')
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
