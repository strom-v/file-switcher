import React, { useMemo } from 'react'
import { Empty, List, Space, Statistic, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import SectionHeader from './SectionHeader'
import { httpStatusColor } from '../theme'
import { formatSize } from '../formatters'
import type { ProxyLogEvent } from '../../shared/types'

const TOP_HOSTS_COUNT = 8
const TOP_LARGEST_COUNT = 8

/** Хост из URL, либо сам URL, если он не парсится (например относительный путь) */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

interface HostCount {
  host: string
  count: number
}

interface StatusCount {
  status: number
  count: number
}

/** Считает агрегаты по логу: запросы по хостам, распределение по статусам, самые крупные ответы */
function computeStats(logs: ProxyLogEvent[]): {
  totalRequests: number
  matchedCount: number
  totalBytes: number
  topHosts: HostCount[]
  statusCounts: StatusCount[]
  largestResponses: ProxyLogEvent[]
} {
  const hostCounts = new Map<string, number>()
  const statusCounts = new Map<number, number>()
  let totalBytes = 0
  let matchedCount = 0

  for (const item of logs) {
    const host = hostOf(item.url)
    hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1)
    if (item.statusCode !== null) {
      statusCounts.set(item.statusCode, (statusCounts.get(item.statusCode) ?? 0) + 1)
    }
    totalBytes += item.responseSize
    if (item.event === 'matched') matchedCount += 1
  }

  const topHosts = [...hostCounts.entries()]
    .map(([host, count]) => ({ host, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_HOSTS_COUNT)

  const sortedStatusCounts = [...statusCounts.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count)

  const largestResponses = [...logs].sort((a, b) => b.responseSize - a.responseSize).slice(0, TOP_LARGEST_COUNT)

  return {
    totalRequests: logs.length,
    matchedCount,
    totalBytes,
    topHosts,
    statusCounts: sortedStatusCounts,
    largestResponses
  }
}

interface TrafficStatsProps {
  logs: ProxyLogEvent[]
}

/** Сводка по накопленному логу: счётчики, топ хостов, распределение статусов, самые крупные ответы */
export default function TrafficStats({ logs }: TrafficStatsProps): React.ReactElement {
  const { t } = useTranslation()
  const stats = useMemo(() => computeStats(logs), [logs])

  if (logs.length === 0) {
    return <Empty description={t('log.empty')} />
  }

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Space size="large">
        <Statistic title={t('stats.totalRequests')} value={stats.totalRequests} />
        <Statistic title={t('stats.matchedCount')} value={stats.matchedCount} />
        <Statistic title={t('stats.totalBytes')} value={formatSize(stats.totalBytes)} />
      </Space>

      <SectionHeader title={t('stats.topHosts')}>
        <List
          bordered
          size="small"
          dataSource={stats.topHosts}
          renderItem={(item) => (
            <List.Item>
              <Typography.Text className="ellipsis-text" ellipsis={{ tooltip: item.host }}>
                {item.host}
              </Typography.Text>
              <Typography.Text type="secondary">{item.count}</Typography.Text>
            </List.Item>
          )}
        />
      </SectionHeader>

      <SectionHeader title={t('stats.statusBreakdown')}>
        <List
          bordered
          size="small"
          dataSource={stats.statusCounts}
          renderItem={(item) => (
            <List.Item>
              <Typography.Text strong style={{ color: httpStatusColor(item.status) }}>
                {item.status}
              </Typography.Text>
              <Typography.Text type="secondary">{item.count}</Typography.Text>
            </List.Item>
          )}
        />
      </SectionHeader>

      <SectionHeader title={t('stats.largestResponses')}>
        <List
          bordered
          size="small"
          dataSource={stats.largestResponses}
          renderItem={(item) => (
            <List.Item>
              <Typography.Text className="ellipsis-text" ellipsis={{ tooltip: item.url }} style={{ flex: 1 }}>
                {item.url}
              </Typography.Text>
              <Typography.Text type="secondary">{formatSize(item.responseSize)}</Typography.Text>
            </List.Item>
          )}
        />
      </SectionHeader>
    </Space>
  )
}
