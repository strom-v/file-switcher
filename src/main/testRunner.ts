import { execFile } from 'child_process'
import { readFile, rm } from 'fs/promises'
import { join } from 'path'

import type { TestCase, TestResult, TestResultStatus, TestRunSummary } from '../shared/types'

// main-процесс собирается electron-vite в out/main, поэтому корень проекта — два уровня вверх.
// В dev-режиме там лежат node_modules с vitest; в собранном приложении тесты недоступны (нет node_modules).
const PROJECT_ROOT = join(__dirname, '..', '..')

// vitest --reporter=json пишет отчёт в файл относительно cwd (а не в stdout)
const JSON_REPORT_PATH = join('.vitest', 'json', 'output.json')

/** Разделитель между describe/названием теста в полном имени (vitest использует " > ") */
const NAME_SEPARATOR = ' > '

interface VitestAssertion {
  ancestorTitles: string[]
  fullName: string
  status: string
  title: string
  duration: number
  failureMessages: string[]
}

interface VitestFileResult {
  name: string
  status: string
  assertionResults: VitestAssertion[]
}

interface VitestReport {
  testResults: VitestFileResult[]
}

function testId(file: string, fullName: string): string {
  return `${file}::${fullName}`
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Запускает vitest через локальный entry-point напрямую node'ом (без npx и шелла) */
function execVitest(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'node',
      [join(PROJECT_ROOT, 'node_modules', 'vitest', 'vitest.mjs'), ...args],
      { cwd: PROJECT_ROOT, maxBuffer: 20 * 1024 * 1024 },
      (error, stdout) => {
        // ENOENT — нет node/vitest (запуск вообще не удался); ненулевой код выхода — упавшие
        // тесты, это штатно (отчёт всё равно записан), поэтому такой код не reject'им
        if (error && (error as { code?: string }).code === 'ENOENT') {
          reject(new Error('Не удалось запустить vitest — проверьте, что node и node_modules установлены'))
          return
        }
        resolve(stdout ?? '')
      }
    )
  })
}

/** Разбирает stdout `vitest list` — строки вида "src/foo.test.ts > describe > тест" */
export function parseVitestList(stdout: string): TestCase[] {
  const cases: TestCase[] = []

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || !trimmed.includes(NAME_SEPARATOR)) {
      continue
    }

    const parts = trimmed.split(NAME_SEPARATOR)
    const [file, ...rest] = parts

    if (rest.length === 0 || !/\.(test|spec)\./.test(file)) {
      continue
    }

    cases.push({
      id: testId(file, rest.join(NAME_SEPARATOR)),
      file,
      fullName: rest.join(NAME_SEPARATOR),
      title: rest[rest.length - 1]
    })
  }

  return cases
}

/** Список всех тестов проекта через `vitest list` */
export async function listTests(): Promise<TestCase[]> {
  const stdout = await execVitest(['list'])
  return parseVitestList(stdout)
}

function mapStatus(status: string): TestResultStatus {
  if (status === 'passed') {
    return 'passed'
  }
  if (status === 'failed') {
    return 'failed'
  }
  return 'skipped'
}

/** Запускает тест(ы) через vitest и возвращает сводку, собранную из JSON-отчёта */
export async function runTests(filter?: { file?: string; testName?: string }): Promise<TestRunSummary> {
  const args = ['run', '--reporter=json']

  if (filter?.file) {
    args.push(filter.file)
  }

  if (filter?.testName) {
    // -t матчит полное имя теста (describe > тест) как regexp — экранируем и якорим,
    // чтобы запустить ровно один тест, а не все с похожим именем
    args.push('-t', `^${escapeRegExp(filter.testName)}$`)
  }

  // чистим прошлый отчёт, чтобы не прочитать устаревшие результаты, если запуск упадёт до записи
  await rm(join(PROJECT_ROOT, JSON_REPORT_PATH), { force: true }).catch(() => undefined)

  await execVitest(args)

  const raw = await readFile(join(PROJECT_ROOT, JSON_REPORT_PATH), 'utf-8')
  const report = JSON.parse(raw) as VitestReport

  const results: TestResult[] = []

  for (const fileResult of report.testResults ?? []) {
    for (const assertion of fileResult.assertionResults ?? []) {
      // в JSON-отчёте fullName склеен пробелами, а в `vitest list` — " > "; собираем полное имя
      // сами, чтобы id совпадал с id из listTests() и результат корректно лёг на список
      const fullName = [...assertion.ancestorTitles, assertion.title].join(NAME_SEPARATOR)
      const status = mapStatus(assertion.status)

      results.push({
        id: testId(fileResult.name, fullName),
        status,
        title: assertion.title,
        duration: assertion.duration ?? 0,
        error: assertion.failureMessages?.length ? assertion.failureMessages.join('\n') : undefined
      })
    }
  }

  const passed = results.filter((r) => r.status === 'passed').length
  const failed = results.filter((r) => r.status === 'failed').length
  const skipped = results.filter((r) => r.status === 'skipped').length

  return {
    total: passed + failed + skipped,
    passed,
    failed,
    skipped,
    results
  }
}
