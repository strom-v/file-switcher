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
  body: string | undefined
  notCapturedHint: string
}

/** Секция тела запроса/ответа: сырой текст по умолчанию, с кнопкой ручного форматирования под JSON */
function BodySection({ title, body, notCapturedHint }: BodySectionProps): React.ReactElement {
  const { t } = useTranslation()
  const [formatted, setFormatted] = useState(false)

  if (body === undefined) {
    return (
      <>
        <Typography.Text strong className="text-sm">
          {title}
        </Typography.Text>
        <div className="headers-panel">
          <Typography.Paragraph type="secondary" className="pre-wrap text-sm">
            {notCapturedHint}
          </Typography.Paragraph>
        </div>
      </>
    )
  }

  const pretty = formatted ? tryFormatJson(body) : null
  const displayed = pretty ?? body

  return (
    <>
      <Typography.Text strong copyable={{ text: displayed }} className="text-sm">
        {title}
      </Typography.Text>{' '}
      <Button size="small" type="link" onClick={() => setFormatted((prev) => !prev)}>
        {t(formatted ? 'log.formatRawButton' : 'log.formatButton')}
      </Button>
      <div className="headers-panel">
        <Typography.Paragraph className="pre-wrap text-sm">{displayed || '—'}</Typography.Paragraph>
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
            notCapturedHint={t('log.detailBodyNotCaptured')}
          />
          <BodySection
            title={t('log.detailResponseBody')}
            body={event.responseBody}
            notCapturedHint={t('log.detailBodyNotCaptured')}
          />
        </>
      )}
    </Modal>
  )
}
