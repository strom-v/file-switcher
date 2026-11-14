import { useEffect } from 'react'

/** Тема следует системной настройке (тёмная/светлая); ручное переключение убрано */
export function useThemeMode(): { isDark: boolean } {
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches

  useEffect(() => {
    document.documentElement.classList.toggle('dark-scrollbars', isDark)
  }, [isDark])

  return { isDark }
}
