import React from 'react'
import { Descriptions, Modal, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { formatHeaders, formatSize, tsToDate } from '../formatters'
import type { ProxyLogEvent } from '../../shared/types'

interface LogDetailModalProps {
  event: ProxyLogEvent | null
  onClose: () => void
}

/** Детальный просмотр одного запроса из лога: метод, статус, заголовки запроса и ответа */
export default function LogDetailModal({ event, onClose }: LogDetailModalProps): React.ReactElement {
  const { t } = useTranslation()
  const formattedTime = event ? tsToDate(event.ts).toLocaleString() : ''

  return (
    <Modal open={event !== null} onCancel={onClose} footer={null} width={640} closeIcon={false} centered>
      {event && (
        <>
          <Descriptions bordered column={1} size="small" className="detail-descriptions" style={{ marginBottom: 8 }}>
            <Descriptions.Item label={t('log.detailUrl')}>
              <Typography.Text copyable className="break-all" style={{ fontSize: 'var(--app-font-size-sm)' }}>
                {event.url}
              </Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label={t('log.detailMethod')}>{event.method}</Descriptions.Item>
            <Descriptions.Item label={t('log.detailStatus')}>{event.statusCode ?? '—'}</Descriptions.Item>
            <Descriptions.Item label={t('log.detailTime')}>{formattedTime}</Descriptions.Item>
            <Descriptions.Item label={t('log.detailSize')}>{formatSize(event.responseSize)}</Descriptions.Item>
            {event.event === 'matched' && (
              <Descriptions.Item label={t('log.detailFile')}>
                <Typography.Text copyable className="break-all" style={{ fontSize: 'var(--app-font-size-sm)' }}>
                  {event.file}
                </Typography.Text>
              </Descriptions.Item>
            )}
          </Descriptions>

          <Typography.Text strong copyable={{ text: formatHeaders(event.requestHeaders) }} style={{ fontSize: 'var(--app-font-size-sm)' }}>
            {t('log.detailRequestHeaders')}
          </Typography.Text>
          <div className="headers-panel">
            <Typography.Paragraph className="pre-wrap" style={{ fontSize: 'var(--app-font-size-sm)' }}>
              {formatHeaders(event.requestHeaders)}
            </Typography.Paragraph>
          </div>

          <Typography.Text strong copyable={{ text: formatHeaders(event.responseHeaders) }} style={{ fontSize: 'var(--app-font-size-sm)' }}>
            {t('log.detailResponseHeaders')}
          </Typography.Text>
          <div className="headers-panel">
            <Typography.Paragraph className="pre-wrap" style={{ fontSize: 'var(--app-font-size-sm)' }}>
              {formatHeaders(event.responseHeaders)}
            </Typography.Paragraph>
          </div>
        </>
      )}
    </Modal>
  )
}
