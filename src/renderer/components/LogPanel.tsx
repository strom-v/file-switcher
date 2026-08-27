import React, { useMemo, useState } from 'react'
import { Button, ConfigProvider, Empty, Flex, Input, List, Select, Space, Tooltip, Typography } from 'antd'
import { ClearOutlined, InfoCircleOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import LogDetailModal from './LogDetailModal'
import IconButton from './IconButton'
import { httpStatusColor } from '../theme'
import { tsToDate } from '../formatters'
import { LOG_LIMIT_OPTIONS, type LogLimit } from '../hooks/useProxyState'
import type { ProxyLogEvent, ProxyLogEventType } from '../../shared/types'

const EVENT_FILTER_ALL = 'all' as const
type EventFilter = ProxyLogEventType | typeof EVENT_FILTER_ALL

// вынесено из компонента: список логов рендерится на каждое новое событие трафика,
// пересоздание объекта темы на каждый такой рендер лишний раз нагружает ConfigProvider
const LOG_LIST_THEME = { components: { List: { itemPaddingSM: '0 4px' } } }

interface LogPanelProps {
  logs: ProxyLogEvent[]
  onClear: () => void
  logLimit: LogLimit
  onLogLimitChange: (limit: LogLimit) => void
}

/** Живой лог всего трафика через прокси (сработавшие подмены выделены), с поиском по URL и фильтром по событию.
 * logLimit ограничивает не только отображение, но и сколько записей вообще хранится в памяти (см. useProxyState). */
export default function LogPanel({ logs, onClear, logLimit, onLogLimitChange }: LogPanelProps): React.ReactElement {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<ProxyLogEvent | null>(null)
  const [search, setSearch] = useState('')
  const [eventFilter, setEventFilter] = useState<EventFilter>(EVENT_FILTER_ALL)

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    return [...logs].reverse().filter((item) => {
      if (eventFilter !== EVENT_FILTER_ALL && item.event !== eventFilter) return false
      if (query && !item.url.toLowerCase().includes(query)) return false
      return true
    })
  }, [logs, search, eventFilter])

  return (
    <div className="panel-column">
      <Flex justify="space-between" align="center" className="panel-toolbar" gap={8}>
        <Input.Search
          size="small"
          allowClear
          placeholder={t('log.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 0 }}
        />
        <Space.Compact size="small">
          <Button
            type={eventFilter === EVENT_FILTER_ALL ? 'primary' : 'default'}
            onClick={() => setEventFilter(EVENT_FILTER_ALL)}
          >
            {t('log.filterAll')}
          </Button>
          <Button type={eventFilter === 'matched' ? 'primary' : 'default'} onClick={() => setEventFilter('matched')}>
            {t('log.matched')}
          </Button>
        </Space.Compact>
        <Select
          size="small"
          value={logLimit}
          onChange={onLogLimitChange}
          options={LOG_LIMIT_OPTIONS.map((count) => ({ value: count, label: count }))}
          style={{ width: 80, flexShrink: 0 }}
        />
        {logs.length > 0 && (
          <Typography.Text type="secondary" className="text-sm" style={{ flexShrink: 0 }}>
            {t('log.shownCount', { shown: logs.length, limit: logLimit })}
          </Typography.Text>
        )}
        <IconButton
          tooltip={t('log.clear')}
          icon={<ClearOutlined />}
          onClick={onClear}
          disabled={logs.length === 0}
          style={{ flexShrink: 0 }}
        />
      </Flex>
      <div className="scroll-panel scroll-panel--visible scroll-panel--panel-bg">
        {visible.length === 0 ? (
          <Empty description={t(logs.length === 0 ? 'log.empty' : 'log.noMatches')} />
        ) : (
          <ConfigProvider theme={LOG_LIST_THEME}>
            <List
              size="small"
              dataSource={visible}
              renderItem={(item) => {
                const isMatched = item.event === 'matched'
                return (
                  <List.Item className={isMatched ? 'log-item--matched log-item--compact' : 'log-item--compact'}>
                    <Flex gap={4} align="center" style={{ width: '100%', minWidth: 0 }}>
                      <Typography.Text
                        strong
                        className="text-sm"
                        style={{ width: 48, flexShrink: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}
                      >
                        {item.method}
                      </Typography.Text>
                      <Typography.Text
                        strong
                        className="text-sm"
                        style={{ color: httpStatusColor(item.statusCode), flexShrink: 0 }}
                      >
                        {item.statusCode ?? '—'}
                      </Typography.Text>
                      <Typography.Text
                        type="secondary"
                        className="text-sm"
                        style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                      >
                        {tsToDate(item.ts).toLocaleTimeString()}
                      </Typography.Text>
                      <Typography.Text
                        className="ellipsis-text text-sm"
                        ellipsis={{ tooltip: item.url }}
                        style={{ flex: 1, minWidth: 0 }}
                      >
                        {item.url}
                      </Typography.Text>
                      <Tooltip title={t('log.detailButton')}>
                        <InfoCircleOutlined
                          style={{ flexShrink: 0, cursor: 'pointer' }}
                          onClick={() => setSelected(item)}
                        />
                      </Tooltip>
                    </Flex>
                  </List.Item>
                )
              }}
            />
          </ConfigProvider>
        )}
      </div>
      <LogDetailModal event={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
