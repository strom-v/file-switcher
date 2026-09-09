import { useState } from 'react'

export const PORT_DEFAULT = 38765
const PORT_STORAGE_KEY = 'file-switcher:port'

function readStoredPort(): number {
  const stored = Number(localStorage.getItem(PORT_STORAGE_KEY))
  if (Number.isInteger(stored) && stored >= 1 && stored <= 65535) {
    return stored
  }
  return PORT_DEFAULT
}

/** Порт прокси с персистентностью */
export function useProxySettings(): {
  port: number
  setPort: (port: number) => void
} {
  const [port, setPortState] = useState<number>(readStoredPort)

  const setPort = (next: number): void => {
    localStorage.setItem(PORT_STORAGE_KEY, String(next))
    setPortState(next)
  }

  return { port, setPort }
}
