import React, { useEffect, useMemo, useState } from 'react'
import { Button, Collapse, Descriptions, Flex, message, Modal, Segmented, Spin, Typography } from 'antd'
import { CopyOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import JsonTree from './JsonTree'
import { formatHeaders, formatSize, tryParseJson, tsToDate } from '../formatters'
import type { ProxyLogEvent } from '../../shared/types'

interface LogDetailModalProps {
  /** ts выбранной записи лога; null — окно закрыто. Полное событие грузится из файла по ts */
  ts: number | null
  onClose: () => void
}

type DetailView = 'text' | 'tree'

interface DetailSectionBodyProps {
  /** плоский текст для режима "текст" и для копирования */
  text: string
  /** значение для дерева (заголовки — объект, тело — разобранный JSON); undefined — дерева нет */
  tree?: unknown
  /** бинарное тело — ни текст, ни дерево не показываем, только пометку */
  binaryNote?: string
}

/** Тело одной сворачиваемой панели (заголовки или тело запроса/ответа): переключатель текст/дерево
 * и кнопка копирования в одну строку, блок с растущей до потолка высотой и внутренним скроллом —
 * единый вид для всех секций. Стартует в режиме "текст"; вызывающий пересоздаёт компонент через
 * key при смене записи. */
function DetailSectionBody({ text, tree, binaryNote }: DetailSectionBodyProps): React.ReactElement {
  const { t } = useTranslation()
  const treeAvailable = tree !== undefined
  const [view, setView] = useState<DetailView>('text')
  const showTree = view === 'tree' && treeAvailable

  if (binaryNote) {
    return (
      <div className="headers-panel headers-panel--tall">
        <Typography.Text type="secondary" className="text-sm">
          {binaryNote}
        </Typography.Text>
      </div>
    )
  }

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      message.success(t('log.copied'))
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      <Flex gap={4} justify="flex-end" align="center" style={{ marginBottom: 6 }}>
        {treeAvailable && (
          <Segmented<DetailView>
            size="small"
            value={view}
            onChange={setView}
            options={[
              { label: t('log.viewText'), value: 'text' },
              { label: t('log.viewTree'), value: 'tree' }
            ]}
          />
        )}
        <Button size="small" type="text" icon={<CopyOutlined />} onClick={handleCopy} title={t('log.copyAll')} />
      </Flex>
      <div className="headers-panel headers-panel--tall">
        {showTree ? (
          <JsonTree value={tree} defaultExpandDepth={2} />
        ) : (
          <Typography.Paragraph className="pre-wrap text-sm" style={{ marginBottom: 0 }}>
            {text || '—'}
          </Typography.Paragraph>
        )}
      </div>
    </>
  )
}

/** Разбирает тело в значение для дерева: undefined — бинарное или не JSON (дерево недоступно) */
function bodyTree(body: string, isBinary: boolean): unknown {
  if (isBinary) return undefined
  const parsed = tryParseJson(body)
  return parsed.ok ? parsed.value : undefined
}

/** Детальный просмотр одного запроса из лога: метод, статус, заголовки и тела запроса/ответа —
 * каждая секция сворачивается (Collapse) и умеет показывать данные плоским текстом или деревом.
 * Полное событие (с телами) грузится из файла лога по ts. Действия над запросом (повтор, добавить
 * в правила, копировать) — в контекстном меню строки лога. */
export default function LogDetailModal({ ts, onClose }: LogDetailModalProps): React.ReactElement {
  const { t } = useTranslation()
  const [event, setEvent] = useState<ProxyLogEvent | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (ts === null) {
      setEvent(null)
      return
    }
    setLoading(true)
    let cancelled = false
    window.api.log.getEvent(ts).then((full) => {
      if (cancelled) return
      setEvent(full)
      setLoading(false)
      if (!full) message.error(t('log.eventUnavailable'))
    })
    return () => {
      cancelled = true
    }
  }, [ts, t])

  const formattedTime = event ? tsToDate(event.ts).toLocaleString() : ''

  // key на DetailSectionBody завязан на ts записи — при выборе другой строки лога компонент
  // пересоздаётся и режим просмотра (текст/дерево) сбрасывается на "текст"
  const sections = useMemo(() => {
    if (!event) return []

    // заголовки — всегда; тела — только непустые
    const specs: { key: string; label: string; text: string; tree?: unknown; binaryNote?: string }[] = [
      {
        key: 'requestHeaders',
        label: t('log.detailRequestHeaders'),
        text: formatHeaders(event.requestHeaders),
        tree: event.requestHeaders
      },
      {
        key: 'responseHeaders',
        label: t('log.detailResponseHeaders'),
        text: formatHeaders(event.responseHeaders),
        tree: event.responseHeaders
      }
    ]

    for (const [key, label, body, isBinary, size] of [
      ['requestBody', t('log.detailRequestBody'), event.requestBody, event.requestBodyIsBinary, event.requestBodySize],
      ['responseBody', t('log.detailResponseBody'), event.responseBody, event.responseBodyIsBinary, event.responseSize]
    ] as const) {
      if (body) {
        specs.push({
          key,
          label,
          text: body,
          tree: bodyTree(body, isBinary),
          binaryNote: isBinary ? t('log.bodyIsBinary', { size: formatSize(size) }) : undefined
        })
      }
    }

    return specs.map((spec) => ({
      key: spec.key,
      label: spec.label,
      children: <DetailSectionBody key={event.ts} text={spec.text} tree={spec.tree} binaryNote={spec.binaryNote} />
    }))
  }, [event, t])

  return (
    <Modal
      open={ts !== null}
      onCancel={onClose}
      footer={null}
      width={640}
      closeIcon={false}
      centered
      // без title и его отступа — модалка это просто просмотр, шапка не нужна
      styles={{ header: { display: 'none' }, body: { maxHeight: '80vh', overflowY: 'auto' } }}
    >
      {loading && (
        <Flex justify="center" style={{ padding: 24 }}>
          <Spin />
        </Flex>
      )}
      {!loading && event && (
        <>
          <Descriptions bordered column={1} size="small" className="detail-descriptions" style={{ marginBottom: 8 }}>
            <Descriptions.Item label={t('log.detailUrl')}>
              <Typography.Text copyable className="break-all text-sm">
                {event.url}
              </Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label={t('log.detailMethod')}>{event.method}</Descriptions.Item>
            <Descriptions.Item label={t('log.detailStatus')}>{event.statusCode ?? '—'}</Descriptions.Item>
            <Descriptions.Item label={t('log.detailTime')}>{formattedTime}</Descriptions.Item>
            <Descriptions.Item label={t('log.detailSize')}>{formatSize(event.responseSize)}</Descriptions.Item>
          </Descriptions>

          {/* key на ts — при выборе другой записи Collapse пересоздаётся, все секции сворачиваются */}
          <Collapse key={ts ?? undefined} size="small" style={{ marginBottom: 0 }} items={sections} />
        </>
      )}
    </Modal>
  )
}
