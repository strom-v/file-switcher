import { useState } from 'react'

export const SPLITTER_SIZE_MIN = 20
export const SPLITTER_SIZE_MAX = 80
export const SPLITTER_SIZE_DEFAULT = 50
const SPLITTER_SIZE_STORAGE_KEY = 'file-switcher:splitter-size'

function readStoredSplitterSize(): number {
  const stored = Number(localStorage.getItem(SPLITTER_SIZE_STORAGE_KEY))
  if (Number.isFinite(stored) && stored >= SPLITTER_SIZE_MIN && stored <= SPLITTER_SIZE_MAX) {
    return stored
  }
  return SPLITTER_SIZE_DEFAULT
}

/** Доля ширины левой панели (лог) в процентах — управляется перетаскиванием Splitter */
export function useSplitterSize(): { splitterSize: number; setSplitterSize: (size: number) => void } {
  const [splitterSize, setSplitterSizeState] = useState<number>(readStoredSplitterSize)

  const setSplitterSize = (next: number): void => {
    const clamped = Math.min(SPLITTER_SIZE_MAX, Math.max(SPLITTER_SIZE_MIN, next))
    localStorage.setItem(SPLITTER_SIZE_STORAGE_KEY, String(clamped))
    setSplitterSizeState(clamped)
  }

  return { splitterSize, setSplitterSize }
}
