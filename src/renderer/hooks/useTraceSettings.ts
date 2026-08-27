import { useEffect, useState } from 'react'
import type { TrafficCaptureSettings } from '../../shared/types'

const DEFAULT_SETTINGS: TrafficCaptureSettings = {
  captureRequestBody: false,
  captureResponseBody: false
}

/** Включение/отключение записи тела запросов и ответов в лог трафика. Источник истины — main-процесс
 * (trace-settings.json в userData), который addon.py перечитывает вживую, аналогично rules.json —
 * поэтому состояние подгружается асинхронно, а не читается из localStorage синхронно как остальные настройки */
export function useTraceSettings(): {
  captureRequestBody: boolean
  captureResponseBody: boolean
  setCaptureRequestBody: (value: boolean) => void
  setCaptureResponseBody: (value: boolean) => void
} {
  const [settings, setSettings] = useState<TrafficCaptureSettings>(DEFAULT_SETTINGS)

  useEffect(() => {
    window.api.trace.get().then(setSettings)
  }, [])

  const persist = (next: TrafficCaptureSettings): void => {
    setSettings(next)
    window.api.trace.save(next)
  }

  return {
    captureRequestBody: settings.captureRequestBody,
    captureResponseBody: settings.captureResponseBody,
    setCaptureRequestBody: (value) => persist({ ...settings, captureRequestBody: value }),
    setCaptureResponseBody: (value) => persist({ ...settings, captureResponseBody: value })
  }
}
