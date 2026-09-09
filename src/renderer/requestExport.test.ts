import { describe, expect, it } from 'vitest'
import { buildRequest } from './requestExport'
import type { ProxyLogEvent } from '../shared/types'

function event(patch: Partial<ProxyLogEvent>): ProxyLogEvent {
  return {
    event: 'passed',
    url: 'https://api.example.com/v1/items',
    file: '',
    method: 'GET',
    statusCode: 200,
    responseSize: 0,
    ts: 1_700_000_000,
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

describe('buildRequest curl', () => {
  it('GET без тела — только URL', () => {
    const out = buildRequest(event({}), 'curl')
    expect(out).toBe("curl 'https://api.example.com/v1/items'")
  })
  it('POST с телом и заголовками, соединенческие заголовки отброшены', () => {
    const out = buildRequest(
      event({
        method: 'POST',
        requestBody: '{"a":1}',
        requestHeaders: { 'Content-Type': 'application/json', Host: 'api.example.com', 'Content-Length': '7' }
      }),
      'curl'
    )
    expect(out).toContain('-X POST')
    expect(out).toContain("-H 'Content-Type: application/json'")
    expect(out).not.toContain('Host:')
    expect(out).not.toContain('Content-Length:')
    expect(out).toContain('--data-raw \'{"a":1}\'')
  })
  it('экранирует одинарные кавычки в URL', () => {
    const out = buildRequest(event({ url: "https://x/a'b" }), 'curl')
    expect(out).toBe("curl 'https://x/a'\\''b'")
  })
})

describe('buildRequest fetch', () => {
  it('валидный JS: fetch(url, init)', () => {
    const out = buildRequest(event({ method: 'POST', requestBody: 'body', requestHeaders: { 'X-Id': '1' } }), 'fetch')
    expect(out).toMatch(/^fetch\("https:\/\/api\.example\.com\/v1\/items", \{/)
    expect(out).toContain('"method": "POST"')
    expect(out).toContain('"body": "body"')
  })
})

describe('buildRequest powershell', () => {
  it('Invoke-WebRequest с $headers', () => {
    const out = buildRequest(event({ requestHeaders: { 'X-Id': '1' } }), 'powershell')
    expect(out).toContain('$headers = @{')
    expect(out).toContain('Invoke-WebRequest -Uri ')
    expect(out).toContain('-Method GET')
  })
})
