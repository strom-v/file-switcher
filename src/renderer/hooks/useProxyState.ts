import { useEffect, useRef, useState } from 'react'
import type { ProxyState, ProxyLogEvent } from '../../shared/types'

const MAX_LOG_ENTRIES = 1000

/** Подписывается на статус и лог прокси через IPC */
export function useProxyState(onStderr?: (text: string) => void): {
  status: ProxyState
  logs: ProxyLogEvent[]
  clearLogs: () => void
} {
  const [status, setStatus] = useState<ProxyState>({ status: 'stopped', port: 8080 })
  const [logs, setLogs] = useState<ProxyLogEvent[]>([])
  const mounted = useRef(true)
  const onStderrRef = useRef(onStderr)
  onStderrRef.current = onStderr

  useEffect(() => {
    mounted.current = true

    window.api.proxy.status().then((state) => {
      if (mounted.current) setStatus(state)
    })

    const offStatus = window.api.proxy.onStatus((state) => {
      setStatus(state)
    })

    const offLog = window.api.proxy.onLog((event) => {
      setLogs((prev) => {
        const next = [...prev, event]
        return next.length > MAX_LOG_ENTRIES ? next.slice(next.length - MAX_LOG_ENTRIES) : next
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

  return { status, logs, clearLogs: () => setLogs([]) }
}
