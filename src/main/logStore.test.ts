import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProxyLogEvent } from '../shared/types'

// logStore берёт папку из app.getPath('userData') — подменяем на временную директорию теста
let userDataDir: string
vi.mock('electron', () => ({
  app: { getPath: () => userDataDir }
}))

function event(ts: number, patch: Partial<ProxyLogEvent> = {}): ProxyLogEvent {
  return {
    event: 'passed',
    url: `https://example.com/${ts}`,
    file: '',
    method: 'GET',
    statusCode: 200,
    responseSize: 0,
    ts,
    requestBodyIsBinary: false,
    requestBodySize: 0,
    responseBodyIsBinary: false,
    requestHeaders: {},
    responseHeaders: {},
    requestBody: '',
    responseBody: '',
    ...patch
  }
}

/** свежий модуль logStore на каждый тест — singleton создаётся при импорте, папка фиксируется в конструкторе */
async function freshStore(): Promise<(typeof import('./logStore'))['logStore']> {
  vi.resetModules()
  return (await import('./logStore')).logStore
}

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'logstore-test-'))
})
afterEach(() => {
  rmSync(userDataDir, { recursive: true, force: true })
})

describe('logStore.appendBatch + getEvent', () => {
  it('getEvent читает правильную строку по смещению (в т.ч. с UTF-8 в URL)', async () => {
    const store = await freshStore()
    store.appendBatch([
      event(1),
      event(2, { url: 'https://пример.рф/путь' }),
      event(3, { requestBody: 'x'.repeat(5000) })
    ])

    expect(store.getEvent(1)?.url).toBe('https://example.com/1')
    expect(store.getEvent(2)?.url).toBe('https://пример.рф/путь')
    expect(store.getEvent(3)?.requestBody).toHaveLength(5000)
    expect(store.getEvent(999)).toBeNull()
  })

  it('getRecent возвращает лёгкие метаданные без тел', async () => {
    const store = await freshStore()
    store.appendBatch([event(1, { requestBody: 'secret-body' })])
    const [meta] = store.getRecent()
    expect(meta.url).toBe('https://example.com/1')
    expect(meta).not.toHaveProperty('requestBody')
    expect(meta).not.toHaveProperty('byteOffset')
  })

  it('файл на диске — валидный JSONL', async () => {
    const store = await freshStore()
    store.appendBatch([event(1), event(2)])
    const dir = join(userDataDir, 'traffic-logs')
    const file = readdirSync(dir).find((n) => n.endsWith('.jsonl'))!
    const lines = readFileSync(join(dir, file), 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]).ts).toBe(1)
  })

  it('ошибка открытия файла не прерывает поток метаданных и предупреждается один раз', async () => {
    writeFileSync(join(userDataDir, 'traffic-logs'), 'not-a-directory')
    const store = await freshStore()

    expect(() => store.appendBatch([event(1)])).not.toThrow()
    expect(store.appendBatch([event(2)]).map((meta) => meta.ts)).toEqual([2])
    expect(store.getRecent().map((meta) => meta.ts)).toEqual([1, 2])
    expect(store.consumeDiskLoggingWarning()).toMatch(/traffic-log/)
    expect(store.consumeDiskLoggingWarning()).toBeNull()
  })

  it('ошибка записи отключает дальнейшие попытки и не прерывает поток метаданных', async () => {
    const writeSyncMock = vi.fn(() => {
      throw new Error('disk full')
    })
    vi.doMock('fs', async () => ({ ...(await vi.importActual<typeof import('fs')>('fs')), writeSync: writeSyncMock }))

    try {
      const store = await freshStore()
      expect(store.appendBatch([event(1)]).map((meta) => meta.ts)).toEqual([1])
      expect(store.appendBatch([event(2)]).map((meta) => meta.ts)).toEqual([2])
      expect(store.consumeDiskLoggingWarning()).toContain('disk full')
      expect(writeSyncMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.doUnmock('fs')
      vi.resetModules()
    }
  })
})

describe('logStore.search', () => {
  it('по url', async () => {
    const store = await freshStore()
    store.appendBatch([event(1, { url: 'https://a.com/foo' }), event(2, { url: 'https://b.com/bar' })])
    expect((await store.search('foo', false)).map((m) => m.ts)).toEqual([1])
  })
  it('по телу только с searchInBody', async () => {
    const store = await freshStore()
    store.appendBatch([event(1, { responseBody: 'needle here' }), event(2)])
    expect(await store.search('needle', false)).toHaveLength(0)
    expect((await store.search('needle', true)).map((m) => m.ts)).toEqual([1])
  })

  it('поиск по телу асинхронный и ограничен окном renderer', async () => {
    const store = await freshStore()
    const events = Array.from({ length: 2001 }, (_, index) =>
      event(index + 1, { responseBody: index === 0 || index === 2000 ? 'needle' : '' })
    )
    store.appendBatch(events)

    const search = store.search('needle', true)
    expect(search).toBeInstanceOf(Promise)
    expect((await search).map((meta) => meta.ts)).toEqual([2001])
  })
})

describe('logStore.pruneOldSessionFiles', () => {
  it('при старте удаляет всё, кроме 20 последних traffic-*.jsonl, чужие файлы не трогает', async () => {
    const dir = join(userDataDir, 'traffic-logs')
    mkdirSync(dir, { recursive: true })
    for (let i = 1; i <= 25; i++) {
      writeFileSync(join(dir, `traffic-${1_700_000_000_000 + i}.jsonl`), '')
    }
    writeFileSync(join(dir, 'keep-me.txt'), 'x')

    await freshStore() // конструктор зовёт pruneOldSessionFiles; файл текущей сессии создаётся только при первом appendBatch

    const remaining = readdirSync(dir)
      .filter((n) => n.startsWith('traffic-'))
      .sort()
    expect(remaining.length).toBe(20)
    expect(remaining).not.toContain('traffic-1700000000001.jsonl')
    expect(remaining).toContain('traffic-1700000000025.jsonl')
    expect(readdirSync(dir)).toContain('keep-me.txt')
  })
})
