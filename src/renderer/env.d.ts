/// <reference types="vite/client" />

import type { Api } from '../preload/preload'
import type { ProxyLogEvent } from '../shared/types'

declare global {
  interface Window {
    api: Api
    // буфер лога прокси, живущий вне React state — см. useProxyState.ts
    __fileSwitcherLogBuffer?: ProxyLogEvent[]
  }
}
