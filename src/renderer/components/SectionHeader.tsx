import React from 'react'
import { Space, Tooltip, Typography } from 'antd'
import { QuestionCircleOutlined } from '@ant-design/icons'

interface SectionHeaderProps {
  title: string
  hint?: string
  children: React.ReactNode
}

/** Единообразный заголовок секции (жирный текст + опциональная подсказка) с содержимым под ним */
export default function SectionHeader({ title, hint, children }: SectionHeaderProps): React.ReactElement {
  return (
    <div>
      <Space style={{ marginBottom: 8 }}>
        <Typography.Text strong>{title}</Typography.Text>
        {hint && (
          <Tooltip title={hint}>
            <QuestionCircleOutlined className="hint-icon" />
          </Tooltip>
        )}
      </Space>
      {children}
    </div>
  )
}
