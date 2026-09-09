import { useEffect, useRef, useState } from 'react'
import { DEFAULT_PROXY_PORT } from '../../shared/constants'
import type { ProxyState, LogEntryMeta } from '../../shared/types'

// потолок отображения списка в UI — весь лог сессии лежит на диске (см. main/logStore.ts),
// в памяти renderer держим только хвост для показа
const DISPLAY_LIMIT = 2000

/** Подписывается на статус прокси и на поток лёгких записей лога через IPC. Тела и заголовки
 * событий в памяти не хранятся — они на диске, грузятся через window.api.log.getEvent при
 * открытии деталей. Кнопка «очистить» чистит только отображение, файл лога остаётся. */
export function useProxyState(onStderr?: (text: string) => void): {
  status: ProxyState
  logs: LogEntryMeta[]
  /** очищает отображение лога: без аргумента — весь, с keep — оставляет записи, для которых он вернул true */
  clearLogs: (keep?: (event: LogEntryMeta) => boolean) => void
  /** добавляет запись в отображение из renderer (например результат повторной отправки запроса) */
  appendLog: (event: LogEntryMeta) => void
} {
  const [status, setStatus] = useState<ProxyState>({ status: 'stopped', port: DEFAULT_PROXY_PORT })
  const [logs, setLogs] = useState<LogEntryMeta[]>([])
  const mounted = useRef(true)
  const onStderrRef = useRef(onStderr)
  onStderrRef.current = onStderr

  useEffect(() => {
    mounted.current = true

    window.api.proxy.status().then((state) => {
      if (mounted.current) setStatus(state)
    })
    window.api.log.getRecent().then((recent) => {
      if (mounted.current) setLogs(recent)
    })

    const offStatus = window.api.proxy.onStatus((state) => {
      setStatus(state)
    })
    const offLog = window.api.proxy.onLogBatch((batch) => {
      setLogs((prev) => [...prev, ...batch].slice(-DISPLAY_LIMIT))
    })
    const offStderr = window.api.proxy.onStderr((text) => {
      onStderrRef.current?.(text)
    })

    return () => {
      mounted.current = false
      offStatus()
      offLog()
      offStderr()
    }
  }, [])

  return {
    status,
    logs,
    clearLogs: (keep) => setLogs((prev) => (keep ? prev.filter(keep) : [])),
    appendLog: (event) => setLogs((prev) => [...prev, event].slice(-DISPLAY_LIMIT))
  }
}
