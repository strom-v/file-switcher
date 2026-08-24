import { useEffect, useState } from 'react'

export type ThemeMode = 'light' | 'dark'

const THEME_STORAGE_KEY = 'file-switcher:theme'

function readStoredTheme(): ThemeMode {
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') {
    return stored
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Управляет режимом темы (light/dark) с персистентностью */
export function useThemeMode(): {
  mode: ThemeMode
  isDark: boolean
  setMode: (mode: ThemeMode) => void
} {
  const [mode, setModeState] = useState<ThemeMode>(readStoredTheme)

  const setMode = (next: ThemeMode): void => {
    localStorage.setItem(THEME_STORAGE_KEY, next)
    setModeState(next)
  }

  const isDark = mode === 'dark'

  useEffect(() => {
    document.documentElement.classList.toggle('dark-scrollbars', isDark)
  }, [isDark])

  return { mode, isDark, setMode }
}
