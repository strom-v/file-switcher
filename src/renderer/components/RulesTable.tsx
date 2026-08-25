import React from 'react'
import { Checkbox, ConfigProvider, Flex, Popconfirm, Space, Table, Tag, Tooltip, Typography } from 'antd'
import { DeleteOutlined, EditOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { useTranslation } from 'react-i18next'
import { COLOR_DANGER } from '../theme'
import type { Rule } from '../../shared/types'

const actionIconStyle: React.CSSProperties = { cursor: 'pointer' }
const deleteIconStyle: React.CSSProperties = { ...actionIconStyle, color: COLOR_DANGER }

// вынесено из компонента: не зависит от пропсов/state, пересоздание на каждый рендер
// заставляет ConfigProvider зря пересчитывать CSS-in-JS таблицы (заметно при частых ре-рендерах во время drag)
const RULES_TABLE_THEME = {
  components: {
    Table: {
      headerBg: 'transparent',
      borderColor: 'transparent',
      cellPaddingBlockSM: 0,
      cellPaddingInlineSM: 4
    }
  }
}

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
  onEdit: (rule: Rule) => void
  onDelete: (rule: Rule) => void
}

/** Таблица правил подмены с чекбоксом и действиями */
export default function RulesTable({ rules, onToggle, onEdit, onDelete }: RulesTableProps): React.ReactElement {
  const { t } = useTranslation()

  const columns: ColumnsType<Rule> = [
    {
      dataIndex: 'enabled',
      width: 36,
      render: (_, rule) => <Checkbox checked={rule.enabled} onChange={(e) => onToggle(rule, e.target.checked)} />
    },
    {
      title: '',
      dataIndex: 'urlPattern',
      render: (urlPattern: string, rule) => (
        <Flex vertical gap={0} style={{ width: '100%' }}>
          <Typography.Text
            className="ellipsis-text"
            ellipsis={{ tooltip: urlPattern }}
            copyable={!!urlPattern}
            style={{ fontSize: 'var(--app-font-size-sm)' }}
          >
            {urlPattern}
          </Typography.Text>
          <Flex gap={4} align="center" style={{ width: '100%' }}>
            {rule.localFilePath ? (
              <Typography.Text
                className="ellipsis-text"
                type="secondary"
                ellipsis={{ tooltip: rule.localFilePath }}
                copyable
                style={{ fontSize: 'var(--app-font-size-sm)', flex: 1, minWidth: 0 }}
              >
                {rule.localFilePath}
              </Typography.Text>
            ) : (
              <Typography.Text type="secondary" style={{ fontSize: 'var(--app-font-size-sm)' }}>
                {t('rules.table.noFile')}
              </Typography.Text>
            )}
            {hasAdvancedModifications(rule) && (
              <Tooltip title={t('rules.table.hasAdvancedHint')}>
                <Tag color="blue">{t('rules.table.hasAdvanced')}</Tag>
              </Tooltip>
            )}
          </Flex>
        </Flex>
      )
    },
    {
      title: '',
      width: 44,
      align: 'right',
      render: (_, rule) => (
        <Space size={8}>
          <Tooltip title={t('rules.table.edit')}>
            <EditOutlined style={actionIconStyle} onClick={() => onEdit(rule)} />
          </Tooltip>
          <Popconfirm title={t('rules.table.deleteConfirm')} onConfirm={() => onDelete(rule)}>
            <Tooltip title={t('rules.table.delete')}>
              <DeleteOutlined style={deleteIconStyle} />
            </Tooltip>
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <ConfigProvider theme={RULES_TABLE_THEME}>
      <Table<Rule>
        rowKey="id"
        columns={columns}
        dataSource={rules}
        pagination={false}
        size="small"
        showHeader={false}
        className="rules-table--compact"
      />
    </ConfigProvider>
  )
}
