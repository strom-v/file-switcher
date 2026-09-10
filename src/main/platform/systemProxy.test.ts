import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  writeFileSync: vi.fn(),
  execAsync: vi.fn(),
  readJsonFile: vi.fn(),
  writeJsonFile: vi.fn()
}))

vi.mock('fs', () => ({
  existsSync: mocks.existsSync,
  readFileSync: mocks.readFileSync,
  unlinkSync: mocks.unlinkSync,
  writeFileSync: mocks.writeFileSync
}))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/file-switcher-test' } }))
vi.mock('../execAsync', () => ({ execAsync: mocks.execAsync }))
vi.mock('../jsonFile', () => ({
  readJsonFile: mocks.readJsonFile,
  writeJsonFile: mocks.writeJsonFile
}))

import { darwinSystemProxy } from './systemProxy.darwin'
import { win32SystemProxy } from './systemProxy.win32'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.existsSync.mockReturnValue(true)
  mocks.execAsync.mockResolvedValue('')
})

describe('DarwinSystemProxyManager', () => {
  it('создаёт проверяемый sudoers-файл только внутри привилегированного процесса', async () => {
    await darwinSystemProxy.setUpPasswordless()

    expect(mocks.writeFileSync).not.toHaveBeenCalled()
    expect(mocks.unlinkSync).not.toHaveBeenCalled()
    const osascriptCall = mocks.execAsync.mock.calls.find(([command]) => command === 'osascript')
    expect(osascriptCall?.[1][1]).toContain('mktemp')
    expect(osascriptCall?.[1][1]).toContain('base64')
  })

  it('не удаляет сохранённое состояние, если восстановление завершилось ошибкой', async () => {
    mocks.readJsonFile.mockReturnValue({
      'Wi-Fi': {
        webEnabled: true,
        webServer: 'proxy.example',
        webPort: '8080',
        secureWebEnabled: false,
        secureWebServer: '',
        secureWebPort: ''
      }
    })
    mocks.execAsync.mockRejectedValue(new Error('networksetup failed'))

    await expect(darwinSystemProxy.disable()).rejects.toThrow('networksetup failed')
    expect(mocks.unlinkSync).not.toHaveBeenCalled()
  })

  it('не перезаписывает состояние, которое ещё не удалось восстановить', async () => {
    mocks.readJsonFile.mockReturnValue({
      'Wi-Fi': {
        webEnabled: true,
        webServer: 'proxy.example',
        webPort: '8080',
        secureWebEnabled: false,
        secureWebServer: '',
        secureWebPort: ''
      }
    })

    await expect(darwinSystemProxy.enable('127.0.0.1', 38765)).rejects.toThrow('сначала восстановить')
    expect(mocks.writeJsonFile).not.toHaveBeenCalled()
  })
})

describe('Win32SystemProxyManager', () => {
  it('не удаляет сохранённое состояние, если восстановление завершилось ошибкой', async () => {
    mocks.readJsonFile.mockReturnValue({
      proxyEnable: 1,
      proxyServer: 'proxy.example:8080',
      proxyOverride: '<local>'
    })
    mocks.execAsync.mockRejectedValue(new Error('reg failed'))

    await expect(win32SystemProxy.disable()).rejects.toThrow('reg failed')
    expect(mocks.unlinkSync).not.toHaveBeenCalled()
  })

  it('не меняет реестр при disable без сохранённого состояния', async () => {
    mocks.readJsonFile.mockReturnValue(null)

    await win32SystemProxy.disable()
    expect(mocks.execAsync).not.toHaveBeenCalled()
  })

  it('не перезаписывает состояние, которое ещё не удалось восстановить', async () => {
    mocks.readJsonFile.mockReturnValue({
      proxyEnable: 1,
      proxyServer: 'proxy.example:8080',
      proxyOverride: '<local>'
    })

    await expect(win32SystemProxy.enable('127.0.0.1', 38765)).rejects.toThrow('сначала восстановить')
    expect(mocks.writeJsonFile).not.toHaveBeenCalled()
  })
})
