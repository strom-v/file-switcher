import { useState } from 'react'

export const PORT_DEFAULT = 38765
const PORT_STORAGE_KEY = 'file-switcher:port'
const AUTO_START_STORAGE_KEY = 'file-switcher:auto-start-proxy'

function readStoredPort(): number {
  const stored = Number(localStorage.getItem(PORT_STORAGE_KEY))
  if (Number.isInteger(stored) && stored >= 1 && stored <= 65535) {
    return stored
  }
  return PORT_DEFAULT
}

function readStoredAutoStart(): boolean {
  return localStorage.getItem(AUTO_START_STORAGE_KEY) === 'true'
}

/** Порт прокси и признак автозапуска при старте приложения — оба с персистентностью */
export function useProxySettings(): {
  port: number
  setPort: (port: number) => void
  autoStart: boolean
  setAutoStart: (autoStart: boolean) => void
} {
  const [port, setPortState] = useState<number>(readStoredPort)
  const [autoStart, setAutoStartState] = useState<boolean>(readStoredAutoStart)

  const setPort = (next: number): void => {
    localStorage.setItem(PORT_STORAGE_KEY, String(next))
    setPortState(next)
  }

  const setAutoStart = (next: boolean): void => {
    localStorage.setItem(AUTO_START_STORAGE_KEY, String(next))
    setAutoStartState(next)
  }

  return { port, setPort, autoStart, setAutoStart }
}
