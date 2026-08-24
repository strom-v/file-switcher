import React from 'react'
import { Checkbox, ConfigProvider, Popconfirm, Space, Table, Tag, Tooltip, Typography } from 'antd'
import { DeleteOutlined, EditOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { useTranslation } from 'react-i18next'
import IconButton from './IconButton'
import type { Rule } from '../../shared/types'

/** Есть ли у правила модификации, кроме подмены тела (заголовки/задержка/статус) */
function hasAdvancedModifications(rule: Rule): boolean {
  return (
    !!rule.requestHeaderOverrides?.length ||
    !!rule.responseHeaderOverrides?.length ||
    !!rule.delayMs ||
    !!rule.statusCodeOverride
  )
}

interface RulesTableProps {
  rules: Rule[]
  onToggle: (rule: Rule, enabled: boolean) => void
  onToggleAll: (enabled: boolean) => void
  onEdit: (rule: Rule) => void
  onDelete: (rule: Rule) => void
}

/** Таблица правил подмены с чекбоксом и действиями */
export default function RulesTable({
  rules,
  onToggle,
  onToggleAll,
  onEdit,
  onDelete
}: RulesTableProps): React.ReactElement {
  const { t } = useTranslation()

  const allEnabled = rules.length > 0 && rules.every((r) => r.enabled)
  const someEnabled = rules.some((r) => r.enabled)

  const columns: ColumnsType<Rule> = [
    {
      title: (
        <Checkbox
          checked={allEnabled}
          indeterminate={someEnabled && !allEnabled}
          onChange={(e) => onToggleAll(e.target.checked)}
        />
      ),
      dataIndex: 'enabled',
      width: 60,
      render: (_, rule) => <Checkbox checked={rule.enabled} onChange={(e) => onToggle(rule, e.target.checked)} />
    },
    {
      title: t('rules.table.urlPattern'),
      dataIndex: 'urlPattern',
      ellipsis: true,
      render: (urlPattern: string) => (
        <Typography.Text className="ellipsis-text" ellipsis={{ tooltip: urlPattern }} copyable={!!urlPattern}>
          {urlPattern}
        </Typography.Text>
      )
    },
    {
      title: t('rules.table.localFile'),
      dataIndex: 'localFilePath',
      ellipsis: true,
      render: (localFilePath: string | undefined, rule) => (
        <Space size={4}>
          {localFilePath ? (
            <Typography.Text className="ellipsis-text" ellipsis={{ tooltip: localFilePath }} copyable>
              {localFilePath}
            </Typography.Text>
          ) : (
            <Typography.Text type="secondary">{t('rules.table.noFile')}</Typography.Text>
          )}
          {hasAdvancedModifications(rule) && (
            <Tooltip title={t('rules.table.hasAdvancedHint')}>
              <Tag color="blue">{t('rules.table.hasAdvanced')}</Tag>
            </Tooltip>
          )}
        </Space>
      )
    },
    {
      title: '',
      width: 72,
      render: (_, rule) => (
        <Space>
          <IconButton tooltip={t('rules.table.edit')} icon={<EditOutlined />} onClick={() => onEdit(rule)} />
          <Popconfirm title={t('rules.table.deleteConfirm')} onConfirm={() => onDelete(rule)}>
            <IconButton tooltip={t('rules.table.delete')} danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <ConfigProvider theme={{ components: { Table: { headerBg: 'transparent', borderColor: 'transparent' } } }}>
      <Table<Rule>
        rowKey="id"
        columns={columns}
        dataSource={rules}
        pagination={false}
        size="small"
        className="rules-table--compact"
        rowClassName={(rule) => (rule.urlPattern && rule.localFilePath ? 'rule-row--complete' : '')}
      />
    </ConfigProvider>
  )
}
