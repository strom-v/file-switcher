import { useEffect, useRef, useState } from 'react'
import type { ProxyState, ProxyLogEvent } from '../../shared/types'

export const LOG_LIMIT_OPTIONS = [50, 100, 150, 300, 500, 1000] as const
export type LogLimit = (typeof LOG_LIMIT_OPTIONS)[number]

// буфер живёт на window, а не в useState: в dev-режиме Vite HMR при live-редактировании
// этого хука/LogPanel может пересоздать компонент с чистым состоянием — window переживает
// такую пересборку модуля, так что накопленные логи не пропадают на лету во время правок
function getLogBuffer(): ProxyLogEvent[] {
  if (!window.__fileSwitcherLogBuffer) window.__fileSwitcherLogBuffer = []
  return window.__fileSwitcherLogBuffer
}

/** Подписывается на статус и лог прокси через IPC; в памяти хранится не больше maxLogEntries последних записей */
export function useProxyState(
  maxLogEntries: LogLimit,
  onStderr?: (text: string) => void
): {
  status: ProxyState
  logs: ProxyLogEvent[]
  clearLogs: () => void
} {
  const [status, setStatus] = useState<ProxyState>({ status: 'stopped', port: 8080 })
  const [logs, setLogs] = useState<ProxyLogEvent[]>(getLogBuffer)
  const mounted = useRef(true)
  const onStderrRef = useRef(onStderr)
  onStderrRef.current = onStderr
  const maxLogEntriesRef = useRef(maxLogEntries)
  maxLogEntriesRef.current = maxLogEntries

  // пишет и в window-буфер (переживает HMR), и в React state (вызывает ре-рендер)
  const updateLogs = (updater: (prev: ProxyLogEvent[]) => ProxyLogEvent[]): void => {
    const next = updater(getLogBuffer())
    window.__fileSwitcherLogBuffer = next
    setLogs(next)
  }

  // при уменьшении лимита обрезаем уже накопленные записи сразу, не дожидаясь следующего события лога
  useEffect(() => {
    updateLogs((prev) => (prev.length > maxLogEntries ? prev.slice(prev.length - maxLogEntries) : prev))
  }, [maxLogEntries])

  useEffect(() => {
    mounted.current = true

    window.api.proxy.status().then((state) => {
      if (mounted.current) setStatus(state)
    })

    const offStatus = window.api.proxy.onStatus((state) => {
      setStatus(state)
    })

    const offLog = window.api.proxy.onLog((event) => {
      updateLogs((prev) => {
        const next = [...prev, event]
        const max = maxLogEntriesRef.current
        return next.length > max ? next.slice(next.length - max) : next
      })
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

  return { status, logs, clearLogs: () => updateLogs(() => []) }
}
