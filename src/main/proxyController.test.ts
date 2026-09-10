import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
  recoverStale: vi.fn()
}))

vi.mock('child_process', () => ({ spawn: mocks.spawn }))
vi.mock('fs', () => ({ existsSync: () => true }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))
vi.mock('./platform', () => ({
  platform: {
    paths: { mitmdumpBinDir: 'mitmdump', mitmdumpBinName: 'mitmdump' },
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

interface FakeChild extends EventEmitter {
  stdout: EventEmitter
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn>
}

function createChild(): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()
  return child
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.enable.mockResolvedValue(undefined)
  mocks.disable.mockResolvedValue(undefined)
  mocks.recoverStale.mockResolvedValue(undefined)
})

describe('ProxyController system proxy lifecycle', () => {
  it('отменяет ожидающее включение, если Stop вызван во время восстановления при старте', async () => {
    const recoveryGate = deferred()
    const child = createChild()
    mocks.spawn.mockReturnValue(child)
    mocks.recoverStale.mockReturnValue(recoveryGate.promise)
    const controller = new ProxyController()

    const recovery = controller.recoverStaleSystemProxy('127.0.0.1')
    controller.start('/tmp/rules.json')
    child.emit('spawn')
    const stopping = controller.stop()
    recoveryGate.resolve()

    await recovery
    await stopping
    expect(mocks.enable).not.toHaveBeenCalled()
    expect(mocks.disable).toHaveBeenCalledOnce()
  })

  it('не запускает disable параллельно с уже начавшимся enable', async () => {
    const enableGate = deferred()
    const child = createChild()
    mocks.spawn.mockReturnValue(child)
    mocks.enable.mockReturnValue(enableGate.promise)
    const controller = new ProxyController()

    controller.start('/tmp/rules.json')
    child.emit('spawn')
    await Promise.resolve()
    expect(mocks.enable).toHaveBeenCalledOnce()

    const stopping = controller.stop()
    expect(mocks.disable).not.toHaveBeenCalled()
    enableGate.resolve()
    await stopping

    expect(mocks.disable).toHaveBeenCalledOnce()
  })
})
