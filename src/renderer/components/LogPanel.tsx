import React, { useState } from 'react'
import { Button, Empty, Flex, List, Space, Typography } from 'antd'
import { ClearOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import LogDetailModal from './LogDetailModal'
import IconButton from './IconButton'
import { httpStatusColor } from '../theme'
import { tsToDate } from '../formatters'
import type { ProxyLogEvent } from '../../shared/types'

const VISIBLE_COUNT_OPTIONS = [50, 100, 150] as const

interface LogPanelProps {
  logs: ProxyLogEvent[]
  onClear: () => void
}

/** Живой лог всего трафика через прокси (сработавшие подмены выделены), ограниченный по числу записей выше по стеку */
export default function LogPanel({ logs, onClear }: LogPanelProps): React.ReactElement {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<ProxyLogEvent | null>(null)
  const [visibleCount, setVisibleCount] = useState<(typeof VISIBLE_COUNT_OPTIONS)[number]>(50)
  const reversed = [...logs].reverse()
  const visible = reversed.slice(0, visibleCount)

  return (
    <div>
      <Flex justify="space-between" className="panel-toolbar">
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
      {reversed.length === 0 ? (
        <Empty description={t('log.empty')} />
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
