import { useState } from 'react'

export const FONT_SIZE_MIN = 10
export const FONT_SIZE_MAX = 16
export const FONT_SIZE_DEFAULT = 13
const FONT_SIZE_STORAGE_KEY = 'file-switcher:font-size'

/** Компактный размер шрифта (списки лога/правил, детали запроса) — на 1px меньше базового antd */
export const COMPACT_FONT_SIZE_OFFSET = 1

function readStoredFontSize(): number {
  const stored = Number(localStorage.getItem(FONT_SIZE_STORAGE_KEY))
  if (Number.isFinite(stored) && stored >= FONT_SIZE_MIN && stored <= FONT_SIZE_MAX) {
    return stored
  }
  return FONT_SIZE_DEFAULT
}

/** Управляет базовым размером шрифта приложения (10–16px) с персистентностью */
export function useFontSize(): { fontSize: number; setFontSize: (size: number) => void } {
  const [fontSize, setFontSizeState] = useState<number>(readStoredFontSize)

  const setFontSize = (next: number): void => {
    const clamped = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, next))
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(clamped))
    setFontSizeState(clamped)
  }

  return { fontSize, setFontSize }
}
