import { useEffect, useState } from 'react'

const POLL_INTERVAL_MS = 5000

/** Опрашивает главный процесс на предмет активного VPN-соединения для индикатора в шапке */
export function useVpnStatus(): boolean {
  const [active, setActive] = useState(false)

  useEffect(() => {
    let mounted = true

    const check = (): void => {
      window.api.system.vpnActive().then((value) => {
        if (mounted) setActive(value)
      })
    }

    check()
    const interval = setInterval(check, POLL_INTERVAL_MS)

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  return active
}
