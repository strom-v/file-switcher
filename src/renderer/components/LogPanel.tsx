import React, { useMemo, useState } from 'react'
import { ConfigProvider, Empty, Flex, Input, List, Popconfirm, Space, Tooltip, Typography } from 'antd'
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  ClearOutlined,
  ColumnHeightOutlined,
  InfoCircleOutlined,
  UnorderedListOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import LogDetailModal from './LogDetailModal'
import IconButton from './IconButton'
import { COLOR_INFO, COLOR_SUCCESS, httpStatusColor } from '../theme'
import { tsToDate } from '../formatters'
import { EVENT_FILTER_ALL, useLogFilters } from '../hooks/useLogFilters'
import type { ProxyLogEvent } from '../../shared/types'

// вынесено из компонента: список логов рендерится на каждое новое событие трафика,
// пересоздание объекта темы на каждый такой рендер лишний раз нагружает ConfigProvider
const LOG_LIST_THEME = { components: { List: { itemPaddingSM: '0 4px' } } }

interface LogPanelProps {
  logs: ProxyLogEvent[]
  onClear: () => void
}

/** Живой лог всего трафика через прокси (сработавшие подмены выделены), с поиском по URL, фильтром по событию
 * и фильтром по наличию тела запроса/ответа. Сколько записей на категорию ("подмена" / "без подмены")
 * хранится в памяти — настраивается в панели настроек (см. useLogStorageLimit, useProxyState). */
export default function LogPanel({ logs, onClear }: LogPanelProps): React.ReactElement {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<ProxyLogEvent | null>(null)
  const [search, setSearch] = useState('')
  const { eventFilter, setEventFilter, bodyFilter, toggleBodyFilter } = useLogFilters()

  // фильтруем сначала (обычно отсекает большую часть буфера), разворачиваем уже отфильтрованный
  // результат — дешевле, чем сначала копировать и разворачивать весь буфер (до 10000 записей),
  // а уже потом фильтровать
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    return logs
      .filter((item) => {
        if (eventFilter !== EVENT_FILTER_ALL && item.event !== eventFilter) return false
        if (bodyFilter === 'request' && !item.requestBody) return false
        if (bodyFilter === 'response' && !item.responseBody) return false
        if (query) {
          const matchesUrl = item.url.toLowerCase().includes(query)
          const matchesFile = item.event === 'matched' && item.file.toLowerCase().includes(query)
          if (!matchesUrl && !matchesFile) return false
        }
        return true
      })
      .reverse()
  }, [logs, search, eventFilter, bodyFilter])

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
          <IconButton
            tooltip={t('log.filterAll')}
            type={eventFilter === EVENT_FILTER_ALL ? 'primary' : 'default'}
            icon={<UnorderedListOutlined />}
            onClick={() => setEventFilter(EVENT_FILTER_ALL)}
          />
          <IconButton
            tooltip={t('log.matched')}
            type={eventFilter === 'matched' ? 'primary' : 'default'}
            icon={<ColumnHeightOutlined />}
            onClick={() => setEventFilter('matched')}
          />
        </Space.Compact>
        <Space.Compact size="small" style={{ flexShrink: 0 }}>
          <IconButton
            tooltip={t('log.filterHasRequestBody')}
            type={bodyFilter === 'request' ? 'primary' : 'default'}
            icon={<ArrowUpOutlined />}
            onClick={() => toggleBodyFilter('request')}
            style={bodyFilter === 'request' ? { backgroundColor: COLOR_INFO, borderColor: COLOR_INFO } : undefined}
          />
          <IconButton
            tooltip={t('log.filterHasResponseBody')}
            type={bodyFilter === 'response' ? 'primary' : 'default'}
            icon={<ArrowDownOutlined />}
            onClick={() => toggleBodyFilter('response')}
            style={
              bodyFilter === 'response' ? { backgroundColor: COLOR_SUCCESS, borderColor: COLOR_SUCCESS } : undefined
            }
          />
        </Space.Compact>
        <Popconfirm title={t('log.clearConfirm')} onConfirm={onClear} disabled={logs.length === 0}>
          <IconButton
            tooltip={t('log.clear')}
            icon={<ClearOutlined />}
            disabled={logs.length === 0}
            style={{ flexShrink: 0 }}
          />
        </Popconfirm>
      </Flex>
      <div className="scroll-panel scroll-panel--visible scroll-panel--panel-bg">
        {visible.length === 0 ? (
          <Flex justify="center" align="center" style={{ height: '100%' }}>
            <Empty description={t(logs.length === 0 ? 'log.empty' : 'log.noMatches')} />
          </Flex>
        ) : (
          <ConfigProvider theme={LOG_LIST_THEME}>
            <List
              size="small"
              dataSource={visible}
              rowKey={(item) => `${item.ts}-${item.url}`}
              renderItem={(item) => {
                const isMatched = item.event === 'matched'
                return (
                  <List.Item className={isMatched ? 'log-item--matched log-item--compact' : 'log-item--compact'}>
                    <Flex vertical gap={0} style={{ width: '100%', minWidth: 0 }}>
                      <Flex gap={4} align="center" style={{ width: '100%', minWidth: 0 }}>
                        <Space size={2} style={{ flexShrink: 0, width: 28 }}>
                          {item.requestBody ? (
                            <ArrowUpOutlined style={{ color: COLOR_INFO }} title={t('log.detailRequestBody')} />
                          ) : null}
                          {item.responseBody ? (
                            <ArrowDownOutlined style={{ color: COLOR_SUCCESS }} title={t('log.detailResponseBody')} />
                          ) : null}
                        </Space>
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
                      {isMatched && (
                        <Typography.Text
                          className="ellipsis-text text-sm"
                          type="secondary"
                          ellipsis={{ tooltip: item.file }}
                        >
                          {item.file}
                        </Typography.Text>
                      )}
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
