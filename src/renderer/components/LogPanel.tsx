import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Dropdown, Empty, Flex, Input, Listy, message, Popconfirm, Space, Tooltip, Typography } from 'antd'
import type { MenuProps } from 'antd'
import {
  ClearOutlined,
  ColumnHeightOutlined,
  CopyOutlined,
  FileSearchOutlined,
  PlusOutlined,
  RedoOutlined,
  UnorderedListOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import LogDetailModal from './LogDetailModal'
import IconButton from './IconButton'
import { COLOR_SUCCESS, httpStatusColor } from '../theme'
import { tsToDate } from '../formatters'
import { EVENT_FILTER_ALL, useLogFilters } from '../hooks/useLogFilters'
import { buildRequest, REQUEST_FORMAT_LABELS, type RequestFormat } from '../requestExport'
import type { LogEntryMeta, ProxyLogEvent } from '../../shared/types'

const REQUEST_FORMATS: RequestFormat[] = ['curl', 'fetch', 'powershell']

interface LogPanelProps {
  logs: LogEntryMeta[]
  /** очищает отображение лога: без аргумента — весь, с keep — оставляет записи, для которых он вернул true */
  onClear: (keep?: (event: LogEntryMeta) => boolean) => void
  /** создать черновик правила подмены из полного события лога */
  onAddRule: (log: ProxyLogEvent) => void
  /** добавить в отображение запись о повторной отправке запроса (отмечается отдельным фоном) */
  onReplayLogged: (event: LogEntryMeta) => void
}

/** Живой лог всего трафика через прокси (сработавшие подмены выделены), с поиском по URL/файлу подмены
 * (опционально и по телу запроса/ответа), фильтром по событию и счётчиками всего/подмена. Тела и
 * заголовки событий на диске (см. main/logStore.ts) — грузятся по ts при открытии деталей или
 * действии из контекстного меню. Клик по строке открывает детали. */
export default function LogPanel({ logs, onClear, onAddRule, onReplayLogged }: LogPanelProps): React.ReactElement {
  const { t } = useTranslation()
  const [selectedTs, setSelectedTs] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [searchInBody, setSearchInBody] = useState(false)
  // ts записей, найденных поиском по телу (async через IPC); null — поиск по телу не активен
  const [bodyMatchTs, setBodyMatchTs] = useState<Set<number> | null>(null)
  const { eventFilter, setEventFilter } = useLogFilters()

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

  // поиск по телу идёт в main (тела на диске) — дёргаем IPC при изменении запроса/флага,
  // с небольшим debounce, чтобы не гонять чтение файла на каждый символ
  useEffect(() => {
    if (!searchInBody || !search.trim()) {
      setBodyMatchTs(null)
      return
    }
    const timer = setTimeout(() => {
      window.api.log.search(search, true).then((metas) => {
        setBodyMatchTs(new Set(metas.map((m) => m.ts)))
      })
    }, 250)
    return () => clearTimeout(timer)
  }, [search, searchInBody])

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    return logs
      .filter((item) => {
        // повтор запроса — результат явного действия пользователя, показываем при любом фильтре события
        if (eventFilter !== EVENT_FILTER_ALL && item.event !== eventFilter && item.event !== 'replay') return false
        if (query) {
          const matchesUrl = item.url.toLowerCase().includes(query)
          const matchesFile = item.event === 'matched' && item.file.toLowerCase().includes(query)
          const matchesBody = bodyMatchTs?.has(item.ts) ?? false
          if (!matchesUrl && !matchesFile && !matchesBody) return false
        }
        return true
      })
      .reverse()
  }, [logs, search, bodyMatchTs, eventFilter])

  // счётчик по всему отображению (не по visible) — общая картина трафика независимо от фильтра
  const matchedCount = useMemo(() => logs.filter((item) => item.event === 'matched').length, [logs])

  // при фильтре "только подмена" кнопка очистки убирает из отображения лишь matched-записи, иначе — весь лог
  const onlyMatched = eventFilter === 'matched'
  const clearKeep = onlyMatched ? (event: LogEntryMeta): boolean => event.event !== 'matched' : undefined
  const clearDisabled = onlyMatched ? matchedCount === 0 : logs.length === 0

  const copyToClipboard = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      message.success(t('log.copied'))
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err))
    }
  }

  // грузит полное событие по ts из файла лога — для действий, которым нужны тела/заголовки
  const loadFull = async (ts: number): Promise<ProxyLogEvent | null> => {
    const full = await window.api.log.getEvent(ts)
    if (!full) message.error(t('log.eventUnavailable'))
    return full
  }

  const copyAs = async (ts: number, format: RequestFormat): Promise<void> => {
    const full = await loadFull(ts)
    if (full) copyToClipboard(buildRequest(full, format))
  }

  const addRule = async (ts: number): Promise<void> => {
    const full = await loadFull(ts)
    if (full) onAddRule(full)
  }

  // повтор запроса напрямую на реальный сервер (не через прокси); main возвращает лёгкую запись
  // лога event: 'replay', её LogPanel красит своим фоном, тело смотреть в модалке
  const replay = async (ts: number): Promise<void> => {
    const full = await loadFull(ts)
    if (!full) return
    const hide = message.loading(t('log.replayInProgress'), 0)
    try {
      const logged = await window.api.proxy.replayRequest(full)
      hide()
      onReplayLogged(logged)
      message.info(`${t('log.replayResultLabel')} ${logged.statusCode}`)
    } catch (err) {
      hide()
      message.error(err instanceof Error ? err.message : String(err))
    }
  }

  // пункты контекстного меню строки лога — действия над конкретным запросом
  const rowMenuItems = (item: LogEntryMeta): MenuProps['items'] => [
    { key: 'add-rule', label: t('log.contextAddRule'), icon: <PlusOutlined />, onClick: () => addRule(item.ts) },
    {
      key: 'copy',
      label: t('log.contextCopy'),
      icon: <CopyOutlined />,
      children: [
        { key: 'copy-url', label: t('log.contextCopyUrl'), onClick: () => copyToClipboard(item.url) },
        ...REQUEST_FORMATS.map((format) => ({
          key: `copy-as-${format}`,
          label: REQUEST_FORMAT_LABELS[format],
          onClick: () => copyAs(item.ts, format)
        }))
      ]
    },
    {
      key: 'replay',
      label: t('log.replayButton'),
      icon: <RedoOutlined />,
      // бинарное тело запроса испорчено errors="replace" при декодировании (см. addon.py) —
      // повторная отправка передаст мусор, поэтому повтор для таких запросов недоступен
      disabled: item.requestBodyIsBinary,
      onClick: () => replay(item.ts)
    }
  ]

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
        <Popconfirm
          title={t(onlyMatched ? 'log.clearMatchedConfirm' : 'log.clearConfirm')}
          onConfirm={() => onClear(clearKeep)}
          disabled={clearDisabled}
        >
          <IconButton
            tooltip={t('log.clear')}
            icon={<ClearOutlined />}
            disabled={clearDisabled}
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
            <Listy<LogEntryMeta>
              items={visible}
              virtual
              height={listHeight}
              rowKey={(item) => `${item.ts}-${item.url}`}
              // Listy кладёт padding на саму строку-обёртку (design-токены), а не на itemRender-контент —
              // клик по этому паддингу (края строки) не долетал бы до onClick на моём внутреннем div,
              // потому что там физически нет элемента. Обнуляем паддинг здесь и переносим тот же
              // отступ на .log-item--compact (global.css) — кликабельная область совпадает с видимой
              styles={{ item: { padding: 0 } }}
              itemRender={(item) => {
                const isMatched = item.event === 'matched'
                // одна строка на запись — Listy вычисляет высоту строки из design-токенов и не
                // поддерживает произвольную многострочную высоту; для matched URL и путь к файлу
                // сведены в одну строку через разделитель, а не выведены отдельной строкой под URL.
                // file пустой — подмена инлайновым телом или только заголовками, показываем один URL
                const urlText = isMatched && item.file ? `${item.url} • ${item.file}` : item.url
                // фон строки: зелёный для сработавшей подмены, жёлтый для повторного запроса
                const rowClass = `log-item--compact log-item--${item.event}`
                return (
                  <Dropdown menu={{ items: rowMenuItems(item) }} trigger={['contextMenu']}>
                    <div className={rowClass} style={{ cursor: 'pointer' }} onClick={() => setSelectedTs(item.ts)}>
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
                        <Typography.Text className="ellipsis-text text-sm" ellipsis style={{ flex: 1, minWidth: 0 }}>
                          {urlText}
                        </Typography.Text>
                      </Flex>
                    </div>
                  </Dropdown>
                )
              }}
            />
          )
        )}
      </div>
      <LogDetailModal ts={selectedTs} onClose={() => setSelectedTs(null)} />
    </div>
  )
}
