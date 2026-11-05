import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listen: vi.fn(),
  close: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
  recoverStale: vi.fn()
}))

vi.mock('./proxy/proxyServer', () => ({
  ProxyServer: class {
    listen = mocks.listen
    close = mocks.close
  }
}))
vi.mock('./platform', () => ({
  platform: {
    systemProxy: {
      enable: mocks.enable,
      disable: mocks.disable,
      recoverStale: mocks.recoverStale
    }
  }
}))
vi.mock('./logStore', () => ({
  logStore: {
    appendBatch: vi.fn(() => []),
    consumeSizeLimitWarning: vi.fn(() => false)
  }
}))

import { ProxyController } from './proxyController'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listen.mockResolvedValue(undefined)
  mocks.enable.mockResolvedValue(undefined)
  mocks.disable.mockResolvedValue(undefined)
  mocks.recoverStale.mockResolvedValue(undefined)
})

describe('ProxyController system proxy lifecycle', () => {
  it('отменяет ожидающее включение, если Stop вызван во время восстановления при старте', async () => {
    const recoveryGate = deferred()
    mocks.recoverStale.mockReturnValue(recoveryGate.promise)
    const controller = new ProxyController()

    const recovery = controller.recoverStaleSystemProxy('127.0.0.1')
    controller.start('/tmp/rules.json')
    await Promise.resolve()
    const stopping = controller.stop()
    recoveryGate.resolve()

    await recovery
    await stopping
    expect(mocks.enable).not.toHaveBeenCalled()
    expect(mocks.disable).toHaveBeenCalledOnce()
  })

  it('не запускает disable параллельно с уже начавшимся enable', async () => {
    const enableGate = deferred()
    mocks.enable.mockReturnValue(enableGate.promise)
    const controller = new ProxyController()

    controller.start('/tmp/rules.json')
    await vi.waitFor(() => expect(mocks.enable).toHaveBeenCalledOnce())
    expect(mocks.enable).toHaveBeenCalledOnce()

    const stopping = controller.stop()
    expect(mocks.disable).not.toHaveBeenCalled()
    enableGate.resolve()
    await stopping

    expect(mocks.disable).toHaveBeenCalledOnce()
  })

  it('сообщает о занятом порте', async () => {
    mocks.listen.mockRejectedValue(Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' }))
    const controller = new ProxyController()

    controller.start('/tmp/rules.json', 38765)

    await vi.waitFor(() => expect(controller.getState().status).toBe('crashed'))
    expect(controller.getState().error).toBe('Порт 38765 уже занят другим процессом')
    expect(mocks.enable).not.toHaveBeenCalled()
  })
})
