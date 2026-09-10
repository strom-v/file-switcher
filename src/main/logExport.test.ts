import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildLogExport, streamLogExport } from './logExport'
import type { ProxyLogEvent } from '../shared/types'

function event(patch: Partial<ProxyLogEvent>): ProxyLogEvent {
  return {
    event: 'matched',
    url: 'https://api.example.com/a',
    file: '/tmp/mock.json',
    method: 'GET',
    statusCode: 200,
    responseSize: 12,
    ts: 1_700_000_000,
    requestBodyIsBinary: false,
    requestBodySize: 0,
    responseBodyIsBinary: false,
    requestHeaders: { Accept: 'application/json' },
    responseHeaders: { 'Content-Type': 'application/json' },
    requestBody: '',
    responseBody: '{"ok":true}',
    ...patch
  }
}

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

async function streamExport(format: 'har' | 'json' | 'csv'): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'log-export-test-'))
  tempDirs.push(dir)
  const sourcePath = join(dir, 'traffic.jsonl')
  const destinationPath = join(dir, `traffic.${format}`)
  writeFileSync(
    sourcePath,
    `${JSON.stringify(event({}))}\ninvalid-json\n${JSON.stringify(event({ ts: 1_700_000_001 }))}\n`
  )

  await streamLogExport(sourcePath, destinationPath, format)
  return readFileSync(destinationPath, 'utf-8')
}

describe('buildLogExport json', () => {
  it('возвращает массив событий как есть', () => {
    const parsed = JSON.parse(buildLogExport([event({})], 'json'))
    expect(parsed).toHaveLength(1)
    expect(parsed[0].url).toBe('https://api.example.com/a')
  })
})

describe('buildLogExport har', () => {
  it('валидный HAR 1.2 с entries', () => {
    const har = JSON.parse(buildLogExport([event({})], 'har'))
    expect(har.log.version).toBe('1.2')
    expect(har.log.entries).toHaveLength(1)
    const entry = har.log.entries[0]
    expect(entry.request.method).toBe('GET')
    expect(entry.request.headers).toContainEqual({ name: 'Accept', value: 'application/json' })
    expect(entry.response.status).toBe(200)
    expect(entry._fileSwitcherEvent).toBe('matched')
    expect(entry._fileSwitcherSubstitutedFile).toBe('/tmp/mock.json')
  })
  it('бинарное тело ответа не кладётся как text', () => {
    const har = JSON.parse(buildLogExport([event({ responseBody: '�bin', responseBodyIsBinary: true })], 'har'))
    expect(har.log.entries[0].response.content.text).toBeUndefined()
  })
})

describe('buildLogExport csv', () => {
  it('заголовок + строка, поля с запятой/кавычкой экранированы', () => {
    const csv = buildLogExport([event({ url: 'https://x/a,b', file: 'he said "hi"' })], 'csv')
    const [header, row] = csv.split('\n')
    expect(header).toBe('time,method,url,status,event,file,responseSize')
    expect(row).toContain('"https://x/a,b"')
    expect(row).toContain('"he said ""hi"""')
  })
})

describe('streamLogExport', () => {
  it('потоково создаёт JSON и пропускает повреждённые строки', async () => {
    const parsed = JSON.parse(await streamExport('json'))
    expect(parsed.map((item: ProxyLogEvent) => item.ts)).toEqual([1_700_000_000, 1_700_000_001])
  })

  it('потоково создаёт валидный HAR', async () => {
    const parsed = JSON.parse(await streamExport('har'))
    expect(parsed.log.entries).toHaveLength(2)
    expect(parsed.log.entries[0].request.url).toBe('https://api.example.com/a')
  })

  it('потоково создаёт CSV', async () => {
    const rows = (await streamExport('csv')).trim().split('\n')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toBe('time,method,url,status,event,file,responseSize')
  })

  it('создаёт пустой экспорт, если файл сессии ещё не появился', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'log-export-test-'))
    tempDirs.push(dir)
    const destinationPath = join(dir, 'traffic.json')

    await streamLogExport(join(dir, 'missing.jsonl'), destinationPath, 'json')
    expect(JSON.parse(readFileSync(destinationPath, 'utf-8'))).toEqual([])
  })
})
