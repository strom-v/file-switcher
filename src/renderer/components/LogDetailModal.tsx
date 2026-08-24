import React from 'react'
import { Collapse, Descriptions, Modal, Tag, Typography } from 'antd'
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
    <Modal title={t('log.detailTitle')} open={event !== null} onCancel={onClose} footer={null} width={640}>
      {event && (
        <>
          <Descriptions bordered column={1} size="small" style={{ marginBottom: 16 }}>
            <Descriptions.Item label={t('log.detailUrl')}>
              <Typography.Text copyable className="break-all">
                {event.url}
              </Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label={t('log.detailMethod')}>
              <Typography.Text copyable>{event.method}</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label={t('log.detailStatus')}>
              {event.statusCode === null ? '—' : <Typography.Text copyable>{event.statusCode}</Typography.Text>}
            </Descriptions.Item>
            <Descriptions.Item label={t('log.detailTime')}>
              <Typography.Text copyable>{formattedTime}</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label={t('log.detailSize')}>
              <Typography.Text copyable={{ text: formatSize(event.responseSize) }}>
                {formatSize(event.responseSize)}
              </Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label={t('log.detailEvent')}>
              {event.event === 'matched' ? <Tag color="green">{t('log.matched')}</Tag> : <Tag>{t('log.passed')}</Tag>}
            </Descriptions.Item>
            {event.event === 'matched' && (
              <Descriptions.Item label={t('log.detailFile')}>
                <Typography.Text copyable className="break-all">
                  {event.file}
                </Typography.Text>
              </Descriptions.Item>
            )}
          </Descriptions>

          <Collapse
            items={[
              {
                key: 'requestHeaders',
                label: t('log.detailRequestHeaders'),
                children: (
                  <Typography.Paragraph className="pre-wrap" copyable>
                    {formatHeaders(event.requestHeaders)}
                  </Typography.Paragraph>
                )
              },
              {
                key: 'responseHeaders',
                label: t('log.detailResponseHeaders'),
                children: (
                  <Typography.Paragraph className="pre-wrap" copyable>
                    {formatHeaders(event.responseHeaders)}
                  </Typography.Paragraph>
                )
              }
            ]}
          />
        </>
      )}
    </Modal>
  )
}
