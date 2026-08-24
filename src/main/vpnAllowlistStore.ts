import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

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
    if (!existsSync(this.filePath)) return []
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf-8')) as AllowlistFile
      return parsed.allowedServices ?? []
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`vpn-allowlist.json повреждён или недоступен (${this.filePath}): ${message}`)
      return []
    }
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
    writeFileSync(this.filePath, JSON.stringify({ allowedServices: [...current] }, null, 2), 'utf-8')
  }
}

export const vpnAllowlistStore = new VpnAllowlistStore()
