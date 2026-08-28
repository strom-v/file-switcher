import React, { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Empty, Flex, Input, Listy, Popconfirm, Space, Tooltip, Typography } from 'antd'
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  ClearOutlined,
  ColumnHeightOutlined,
  FileSearchOutlined,
  UnorderedListOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import LogDetailModal from './LogDetailModal'
import IconButton from './IconButton'
import { COLOR_INFO, COLOR_SUCCESS, httpStatusColor } from '../theme'
import { tsToDate } from '../formatters'
import { EVENT_FILTER_ALL, useLogFilters } from '../hooks/useLogFilters'
import type { ProxyLogEvent } from '../../shared/types'

interface LogPanelProps {
  logs: ProxyLogEvent[]
  onClear: () => void
}

/** Живой лог всего трафика через прокси (сработавшие подмены выделены), с поиском по URL/файлу подмены
 * (опционально и по телу запроса/ответа — переключатель в тулбаре), фильтром по событию, фильтром
 * по наличию тела запроса/ответа и счётчиками всего/подмена. Клик по всей строке открывает детали
 * запроса. Сколько записей на категорию хранится в памяти — настраивается в панели настроек
 * (см. useLogStorageLimit, useProxyState). */
export default function LogPanel({ logs, onClear }: LogPanelProps): React.ReactElement {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<ProxyLogEvent | null>(null)
  const [search, setSearch] = useState('')
  const [searchInBody, setSearchInBody] = useState(false)
  const { eventFilter, setEventFilter, bodyFilter, toggleBodyFilter } = useLogFilters()

  // Listy требует высоту контейнера в пикселях (не проценты) для виртуализации — измеряем
  // фактическую высоту обёртки через ResizeObserver, а не жёстко фиксируем в CSS, так как
  // панель растягивается вместе со Splitter/окном
  const scrollPanelRef = useRef<HTMLDivElement>(null)
  const [listHeight, setListHeight] = useState(0)

  useLayoutEffect(() => {
    const el = scrollPanelRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      setListHeight(entries[0].contentRect.height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

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
          const matchesBody =
            searchInBody &&
            (item.requestBody.toLowerCase().includes(query) || item.responseBody.toLowerCase().includes(query))
          if (!matchesUrl && !matchesFile && !matchesBody) return false
        }
        return true
      })
      .reverse()
  }, [logs, search, searchInBody, eventFilter, bodyFilter])

  // счётчик по полному буферу (не по visible) — показывает общую картину трафика независимо
  // от того, что сейчас отфильтровано в списке, как счётчик "matched" в SBIS LOGS
  const matchedCount = useMemo(() => logs.filter((item) => item.event === 'matched').length, [logs])

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
        <IconButton
          tooltip={t('log.searchInBody')}
          type={searchInBody ? 'primary' : 'default'}
          icon={<FileSearchOutlined />}
          onClick={() => setSearchInBody((prev) => !prev)}
          style={{ flexShrink: 0 }}
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
        <Space size={10} style={{ flexShrink: 0 }} className="text-sm">
          <Tooltip title={t('log.totalCount', { count: logs.length })}>
            <Space size={3}>
              <UnorderedListOutlined />
              <Typography.Text type="secondary">{logs.length}</Typography.Text>
            </Space>
          </Tooltip>
          <Tooltip title={t('log.matchedCount', { count: matchedCount })}>
            <Space size={3}>
              <ColumnHeightOutlined style={{ color: COLOR_SUCCESS }} />
              <Typography.Text style={{ color: COLOR_SUCCESS }}>{matchedCount}</Typography.Text>
            </Space>
          </Tooltip>
        </Space>
        <Popconfirm title={t('log.clearConfirm')} onConfirm={onClear} disabled={logs.length === 0}>
          <IconButton
            tooltip={t('log.clear')}
            icon={<ClearOutlined />}
            disabled={logs.length === 0}
            style={{ flexShrink: 0 }}
          />
        </Popconfirm>
      </Flex>
      <div ref={scrollPanelRef} className="scroll-panel scroll-panel--visible scroll-panel--panel-bg">
        {visible.length === 0 ? (
          <Flex justify="center" align="center" style={{ height: '100%' }}>
            <Empty description={t(logs.length === 0 ? 'log.empty' : 'log.noMatches')} />
          </Flex>
        ) : (
          listHeight > 0 && (
            <Listy<ProxyLogEvent>
              items={visible}
              virtual
              height={listHeight}
              rowKey={(item) => `${item.ts}-${item.url}`}
              itemRender={(item) => {
                const isMatched = item.event === 'matched'
                // одна строка на запись — Listy вычисляет высоту строки из design-токенов и не
                // поддерживает произвольную многострочную высоту; для matched URL и путь к файлу
                // сведены в одну строку через разделитель, а не выведены отдельной строкой под URL
                const urlText = isMatched ? item.url + ' • ' + item.file : item.url
                return (
                  <div
                    className={isMatched ? 'log-item--matched log-item--compact' : 'log-item--compact'}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelected(item)}
                  >
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
                        ellipsis={{ tooltip: urlText }}
                        style={{ flex: 1, minWidth: 0 }}
                      >
                        {urlText}
                      </Typography.Text>
                    </Flex>
                  </div>
                )
              }}
            />
          )
        )}
      </div>
      <LogDetailModal event={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
