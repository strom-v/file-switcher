import React, { useMemo, useState } from 'react'
import { Button, Empty, Flex, Input, List, Segmented, Space, Typography } from 'antd'
import { ClearOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import LogDetailModal from './LogDetailModal'
import IconButton from './IconButton'
import { httpStatusColor } from '../theme'
import { tsToDate } from '../formatters'
import type { ProxyLogEvent, ProxyLogEventType } from '../../shared/types'

const VISIBLE_COUNT_OPTIONS = [50, 100, 150] as const
const EVENT_FILTER_ALL = 'all' as const
type EventFilter = ProxyLogEventType | typeof EVENT_FILTER_ALL

interface LogPanelProps {
  logs: ProxyLogEvent[]
  onClear: () => void
}

/** Живой лог всего трафика через прокси (сработавшие подмены выделены), с поиском по URL и фильтром по событию */
export default function LogPanel({ logs, onClear }: LogPanelProps): React.ReactElement {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<ProxyLogEvent | null>(null)
  const [visibleCount, setVisibleCount] = useState<(typeof VISIBLE_COUNT_OPTIONS)[number]>(50)
  const [search, setSearch] = useState('')
  const [eventFilter, setEventFilter] = useState<EventFilter>(EVENT_FILTER_ALL)

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return [...logs].reverse().filter((item) => {
      if (eventFilter !== EVENT_FILTER_ALL && item.event !== eventFilter) return false
      if (query && !item.url.toLowerCase().includes(query)) return false
      return true
    })
  }, [logs, search, eventFilter])

  const visible = filtered.slice(0, visibleCount)

  return (
    <div>
      <Flex justify="space-between" className="panel-toolbar" gap={8}>
        <Input.Search
          size="small"
          allowClear
          placeholder={t('log.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 240 }}
        />
        <Segmented
          size="small"
          value={eventFilter}
          onChange={(value) => setEventFilter(value as EventFilter)}
          options={[
            { label: t('log.filterAll'), value: EVENT_FILTER_ALL },
            { label: t('log.matched'), value: 'matched' },
            { label: t('log.passed'), value: 'passed' }
          ]}
        />
        <Space.Compact size="small">
          {VISIBLE_COUNT_OPTIONS.map((count) => (
            <Button
              key={count}
              type={visibleCount === count ? 'primary' : 'default'}
              onClick={() => setVisibleCount(count)}
            >
              {count}
            </Button>
          ))}
        </Space.Compact>
        <IconButton tooltip={t('log.clear')} icon={<ClearOutlined />} onClick={onClear} disabled={logs.length === 0} />
      </Flex>
      {filtered.length === 0 ? (
        <Empty description={t(logs.length === 0 ? 'log.empty' : 'log.noMatches')} />
      ) : (
        <List
          size="small"
          bordered
          dataSource={visible}
          renderItem={(item) => {
            const isMatched = item.event === 'matched'
            return (
              <List.Item
                className={isMatched ? 'log-item--matched log-item--compact' : 'log-item--compact'}
                style={{ cursor: 'pointer' }}
                onClick={() => setSelected(item)}
              >
                <Flex vertical gap={0}>
                  <Flex gap={6} align="baseline">
                    <Typography.Text strong style={{ minWidth: 42 }}>
                      {item.method}
                    </Typography.Text>
                    <Typography.Text strong style={{ color: httpStatusColor(item.statusCode), minWidth: 28 }}>
                      {item.statusCode ?? '—'}
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ minWidth: 68 }}>
                      {tsToDate(item.ts).toLocaleTimeString()}
                    </Typography.Text>
                    <Typography.Text className="ellipsis-text" ellipsis={{ tooltip: item.url }} copyable={!!item.url}>
                      {item.url}
                    </Typography.Text>
                  </Flex>
                  {isMatched && (
                    <Typography.Text
                      className="ellipsis-text"
                      type="secondary"
                      ellipsis={{ tooltip: item.file }}
                      copyable={!!item.file}
                      style={{ fontSize: 12 }}
                    >
                      {item.file}
                    </Typography.Text>
                  )}
                </Flex>
              </List.Item>
            )
          }}
        />
      )}
      <LogDetailModal event={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
