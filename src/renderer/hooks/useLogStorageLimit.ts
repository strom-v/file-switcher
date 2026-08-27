import { useState } from 'react'

export const LOG_STORAGE_LIMIT_MIN = 100
export const LOG_STORAGE_LIMIT_MAX = 10000
export const LOG_STORAGE_LIMIT_DEFAULT = 1000
const LOG_STORAGE_LIMIT_STORAGE_KEY = 'file-switcher:log-storage-limit'

function readStoredLogStorageLimit(): number {
  const stored = Number(localStorage.getItem(LOG_STORAGE_LIMIT_STORAGE_KEY))
  if (Number.isInteger(stored) && stored >= LOG_STORAGE_LIMIT_MIN && stored <= LOG_STORAGE_LIMIT_MAX) {
    return stored
  }
  return LOG_STORAGE_LIMIT_DEFAULT
}

/** Сколько записей лога на категорию (подмена / без подмены) хранится в памяти — настраивается, с персистентностью */
export function useLogStorageLimit(): { logStorageLimit: number; setLogStorageLimit: (limit: number) => void } {
  const [logStorageLimit, setLogStorageLimitState] = useState<number>(readStoredLogStorageLimit)

  const setLogStorageLimit = (next: number): void => {
    const clamped = Math.min(LOG_STORAGE_LIMIT_MAX, Math.max(LOG_STORAGE_LIMIT_MIN, Math.round(next)))
    localStorage.setItem(LOG_STORAGE_LIMIT_STORAGE_KEY, String(clamped))
    setLogStorageLimitState(clamped)
  }

  return { logStorageLimit, setLogStorageLimit }
}
