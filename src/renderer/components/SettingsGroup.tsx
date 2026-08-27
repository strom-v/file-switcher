import React from 'react'
import { Divider, Space, Typography } from 'antd'

interface SettingsGroupProps {
  title: string
  first?: boolean
  children: React.ReactNode
}

/** Именованная группа секций настроек (внешний вид / сеть / данные), разделяет панель на смысловые зоны */
export default function SettingsGroup({ title, first, children }: SettingsGroupProps): React.ReactElement {
  return (
    <div>
      {!first && <Divider style={{ margin: '8px 0 16px' }} />}
      <Typography.Title level={5} style={{ marginTop: first ? 0 : undefined, marginBottom: 12 }}>
        {title}
      </Typography.Title>
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        {children}
      </Space>
    </div>
  )
}
