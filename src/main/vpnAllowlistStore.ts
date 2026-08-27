import { join } from 'path'
import { app } from 'electron'
import { readJsonFile, writeJsonFile } from './jsonFile'

interface AllowlistFile {
  allowedServices: string[]
}

/** Хранит имена VPN network services, для которых пользователь разрешил настраивать системный прокси. */
export class VpnAllowlistStore {
  private readonly filePath: string

  constructor(filePath: string = join(app.getPath('userData'), 'vpn-allowlist.json')) {
    this.filePath = filePath
  }

  getAll(): string[] {
    return readJsonFile<AllowlistFile>(this.filePath, { allowedServices: [] }).allowedServices ?? []
  }

  isAllowed(serviceName: string): boolean {
    return this.getAll().includes(serviceName)
  }

  setAllowed(serviceName: string, allowed: boolean): void {
    const current = new Set(this.getAll())
    if (allowed) {
      current.add(serviceName)
    } else {
      current.delete(serviceName)
    }
    writeJsonFile(this.filePath, { allowedServices: [...current] })
  }
}

export const vpnAllowlistStore = new VpnAllowlistStore()
