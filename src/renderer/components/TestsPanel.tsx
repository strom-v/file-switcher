import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Empty, Flex, Space, Spin, Tag, Tooltip, Typography } from 'antd'
import { PlayCircleOutlined, ReloadOutlined, SyncOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import IconButton from './IconButton'
import { COLOR_SUCCESS } from '../theme'
import type { TestCase, TestResult, TestRunSummary } from '../../shared/types'

const STATUS_COLOR: Record<TestResult['status'], string> = {
  passed: 'success',
  failed: 'error',
  skipped: 'default'
}

/** Панель «Тесты»: список тестов проекта и запуск их через vitest (через main-процесс) */
export default function TestsPanel(): React.ReactElement {
  const { t } = useTranslation()
  const [tests, setTests] = useState<TestCase[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  // id запущенного теста; null — запущены все тесты разом
  const [runningId, setRunningId] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, TestResult>>({})
  const [summary, setSummary] = useState<TestRunSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      setTests(await window.api.tests.list())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const run = async (test?: TestCase): Promise<void> => {
    setRunning(true)
    setRunningId(test ? test.id : null)
    setError(null)
    try {
      const res = await window.api.tests.run(test ? { file: test.file, testName: test.fullName } : undefined)
      setSummary(res)
      const byId: Record<string, TestResult> = {}
      for (const r of res.results) {
        byId[r.id] = r
      }
      setResults(byId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
      setRunningId(null)
    }
  }

  // тесты, сгруппированные по файлу, в порядке появления
  const grouped = useMemo(() => {
    const map = new Map<string, TestCase[]>()
    for (const test of tests) {
      const list = map.get(test.file) ?? []
      list.push(test)
      map.set(test.file, list)
    }
    return [...map.entries()]
  }, [tests])

  return (
    <div className="panel-column" style={{ flex: 1, minHeight: 0 }}>
      <Flex justify="space-between" align="center" className="panel-toolbar">
        <Space>
          <Typography.Text strong>{t('tests.title')}</Typography.Text>
          {summary && (
            <Tag color={summary.failed === 0 ? 'success' : 'error'}>
              {summary.failed === 0
                ? t('tests.allPassed')
                : t('tests.summary', { passed: summary.passed, total: summary.total })}
            </Tag>
          )}
        </Space>
        <Space>
          <IconButton tooltip={t('tests.refresh')} icon={<ReloadOutlined />} onClick={load} />
          <IconButton
            tooltip={t('tests.runAll')}
            icon={running && runningId === null ? <SyncOutlined spin /> : <PlayCircleOutlined />}
            onClick={() => run()}
            disabled={running || tests.length === 0}
            style={{ color: COLOR_SUCCESS, borderColor: COLOR_SUCCESS }}
          />
        </Space>
      </Flex>

      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 8 }} />}

      <div className="scroll-panel scroll-panel--visible scroll-panel--panel-bg" style={{ flex: 1, minHeight: 0 }}>
        {loading ? (
          <Flex align="center" justify="center" style={{ height: '100%' }}>
            <Spin />
          </Flex>
        ) : tests.length === 0 ? (
          <Empty description={t('tests.empty')} />
        ) : (
          grouped.map(([file, fileTests]) => (
            <div key={file} style={{ marginBottom: 12 }}>
              <Typography.Text
                type="secondary"
                style={{ fontSize: 'var(--app-font-size-sm)', display: 'block', marginBottom: 4 }}
              >
                {file}
              </Typography.Text>

              {fileTests.map((test) => {
                const result = results[test.id]
                const isRunning = running && runningId === test.id

                return (
                  <div key={test.id}>
                    <Flex align="center" justify="space-between" style={{ padding: '3px 0' }}>
                      <Space size={6} style={{ minWidth: 0 }}>
                        <Typography.Text style={{ fontSize: 'var(--app-font-size-sm)' }}>{test.title}</Typography.Text>
                        {result && (
                          <Tag color={STATUS_COLOR[result.status]} style={{ marginRight: 0 }}>
                            {t(`tests.${result.status}`)}
                          </Tag>
                        )}
                      </Space>
                      <Space size={6}>
                        {result && (
                          <Typography.Text type="secondary" style={{ fontSize: 'var(--app-font-size-sm)' }}>
                            {Math.round(result.duration)} ms
                          </Typography.Text>
                        )}
                        <Tooltip title={t('tests.run')}>
                          <Button
                            size="small"
                            type="text"
                            icon={isRunning ? <SyncOutlined spin /> : <PlayCircleOutlined />}
                            onClick={() => run(test)}
                            disabled={running}
                          />
                        </Tooltip>
                      </Space>
                    </Flex>
                    {result?.error && (
                      <Typography.Text
                        type="danger"
                        style={{ fontSize: 'var(--app-font-size-sm)', whiteSpace: 'pre-wrap' }}
                      >
                        {result.error}
                      </Typography.Text>
                    )}
                  </div>
                )
              })}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
