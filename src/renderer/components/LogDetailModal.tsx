import React, { useState } from 'react'
import { Button, Descriptions, Modal, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { formatHeaders, formatSize, tryFormatJson, tsToDate } from '../formatters'
import type { ProxyLogEvent } from '../../shared/types'

interface LogDetailModalProps {
  event: ProxyLogEvent | null
  onClose: () => void
}

interface BodySectionProps {
  title: React.ReactNode
  body: string
  isBinary: boolean
  size: number
}

/** Секция тела запроса/ответа: сырой текст по умолчанию, с кнопкой ручного форматирования под JSON;
 * для бинарных данных (картинка, шрифт и т.п.) — явная пометка вместо нечитаемой каши символов */
function BodySection({ title, body, isBinary, size }: BodySectionProps): React.ReactElement {
  const { t } = useTranslation()
  const [formatted, setFormatted] = useState(false)

  const pretty = !isBinary && formatted ? tryFormatJson(body) : null
  const displayed = pretty ?? body
  // кнопка нажата, но текст не изменился — либо это не JSON, либо тело слишком большое для
  // форматирования (см. FORMAT_JSON_MAX_LENGTH); пользователю нужно явное объяснение, а не молчание
  const formatDidNothing = formatted && pretty === null

  return (
    <>
      <Typography.Text strong copyable={!isBinary && { text: displayed }} className="text-sm">
        {title}
      </Typography.Text>{' '}
      {!isBinary && (
        <Button size="small" type="link" onClick={() => setFormatted((prev) => !prev)}>
          {t(formatted ? 'log.formatRawButton' : 'log.formatButton')}
        </Button>
      )}
      {!isBinary && formatDidNothing && (
        <Typography.Text type="secondary" className="text-sm">
          {' '}
          {t('log.formatNotApplicable')}
        </Typography.Text>
      )}
      <div className="headers-panel">
        {isBinary ? (
          <Typography.Text type="secondary" className="text-sm">
            {t('log.bodyIsBinary', { size: formatSize(size) })}
          </Typography.Text>
        ) : (
          <Typography.Paragraph className="pre-wrap text-sm">{displayed || '—'}</Typography.Paragraph>
        )}
      </div>
    </>
  )
}

/** Детальный просмотр одного запроса из лога: метод, статус, заголовки запроса и ответа */
export default function LogDetailModal({ event, onClose }: LogDetailModalProps): React.ReactElement {
  const { t } = useTranslation()
  const formattedTime = event ? tsToDate(event.ts).toLocaleString() : ''

  return (
    <Modal
      open={event !== null}
      onCancel={onClose}
      footer={null}
      width={640}
      closeIcon={false}
      centered
      styles={{ body: { maxHeight: '80vh', overflowY: 'auto' } }}
    >
      {event && (
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
            {event.event === 'matched' && (
              <Descriptions.Item label={t('log.detailFile')}>
                <Typography.Text copyable className="break-all text-sm">
                  {event.file}
                </Typography.Text>
              </Descriptions.Item>
            )}
          </Descriptions>

          <Typography.Text strong copyable={{ text: formatHeaders(event.requestHeaders) }} className="text-sm">
            {t('log.detailRequestHeaders')}
          </Typography.Text>
          <div className="headers-panel">
            <Typography.Paragraph className="pre-wrap text-sm">
              {formatHeaders(event.requestHeaders)}
            </Typography.Paragraph>
          </div>

          <Typography.Text strong copyable={{ text: formatHeaders(event.responseHeaders) }} className="text-sm">
            {t('log.detailResponseHeaders')}
          </Typography.Text>
          <div className="headers-panel">
            <Typography.Paragraph className="pre-wrap text-sm">
              {formatHeaders(event.responseHeaders)}
            </Typography.Paragraph>
          </div>

          <BodySection
            title={t('log.detailRequestBody')}
            body={event.requestBody}
            isBinary={event.requestBodyIsBinary}
            size={event.requestBodySize}
          />
          <BodySection
            title={t('log.detailResponseBody')}
            body={event.responseBody}
            isBinary={event.responseBodyIsBinary}
            size={event.responseSize}
          />
        </>
      )}
    </Modal>
  )
}
