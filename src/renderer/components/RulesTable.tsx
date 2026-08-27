import React, { useMemo } from 'react'
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

/** Репозиторий из пути подмены — второй сегмент после папки "projects" (.../projects/<организация>/<репозиторий>/...) */
function extractRepo(localFilePath: string | undefined): string | null {
  if (!localFilePath) return null
  const match = localFilePath.match(/\/projects\/[^/]+\/([^/]+)\//)
  return match ? match[1] : null
}

interface GroupHeaderRow {
  __group: true
  key: string
  label: string
  isFirst: boolean
}
type GroupedRow = (GroupHeaderRow | (Rule & { __group?: false }))[]

/** Различает строку-заголовок группы от обычного правила */
function isGroupRow(row: GroupedRow[number]): row is GroupHeaderRow {
  return '__group' in row && row.__group === true
}

const CYRILLIC_RE = /[а-яё]/i

/** Сравнивает названия групп: латинские идут перед кириллическими, внутри каждой части — по алфавиту */
function compareGroupNames(a: string, b: string): number {
  const aIsCyrillic = CYRILLIC_RE.test(a)
  const bIsCyrillic = CYRILLIC_RE.test(b)
  if (aIsCyrillic !== bIsCyrillic) return aIsCyrillic ? 1 : -1
  return a.localeCompare(b)
}

/** Группирует правила по репозиторию из localFilePath; группы и правила внутри них отсортированы по алфавиту
 * (латинские названия групп впереди кириллических), правила без распознанного репозитория — в "остальные" */
function groupRulesByRepo(rules: Rule[], otherLabel: string): GroupedRow {
  const groups = new Map<string, Rule[]>()
  for (const rule of rules) {
    const repo = extractRepo(rule.localFilePath) ?? otherLabel
    const bucket = groups.get(repo)
    if (bucket) {
      bucket.push(rule)
    } else {
      groups.set(repo, [rule])
    }
  }

  const sortedRepos = [...groups.keys()].sort(compareGroupNames)
  const showGroups = groups.size > 1

  const rows: GroupedRow = []
  sortedRepos.forEach((repo, i) => {
    const groupRules = groups.get(repo)!.sort((a, b) => a.urlPattern.localeCompare(b.urlPattern))
    if (showGroups) {
      rows.push({ __group: true, key: `group:${repo}`, label: repo, isFirst: i === 0 })
    }
    rows.push(...groupRules)
  })
  return rows
}

interface RulesTableProps {
  rules: Rule[]
  onToggle: (rule: Rule, enabled: boolean) => void
  onEdit: (rule: Rule) => void
  onDelete: (rule: Rule) => void
}

/** Таблица правил подмены, сгруппированных по репозиторию из пути подмены, с чекбоксом и действиями */
export default function RulesTable({ rules, onToggle, onEdit, onDelete }: RulesTableProps): React.ReactElement {
  const { t } = useTranslation()

  const groupedRows = useMemo(() => groupRulesByRepo(rules, t('rules.table.otherGroup')), [rules, t])

  const columns: ColumnsType<GroupedRow[number]> = [
    {
      dataIndex: 'enabled',
      width: 36,
      onCell: (row) => (isGroupRow(row) ? { colSpan: 0 } : {}),
      render: (_, row) =>
        isGroupRow(row) ? null : <Checkbox checked={row.enabled} onChange={(e) => onToggle(row, e.target.checked)} />
    },
    {
      title: '',
      dataIndex: 'urlPattern',
      onCell: (row) => (isGroupRow(row) ? { colSpan: 3 } : {}),
      render: (urlPattern: string, row) => {
        if (isGroupRow(row)) {
          return (
            <div style={{ marginTop: row.isFirst ? 0 : 14 }}>
              <Typography.Text
                type="secondary"
                strong
                className="text-sm"
                style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}
              >
                {row.label}
              </Typography.Text>
            </div>
          )
        }
        const rule = row
        return (
          <Flex vertical gap={0} style={{ width: '100%' }}>
            <Typography.Text
              className="ellipsis-text text-sm"
              ellipsis={{ tooltip: urlPattern }}
              copyable={!!urlPattern}
            >
              {urlPattern}
            </Typography.Text>
            <Flex gap={4} align="center" style={{ width: '100%' }}>
              {rule.localFilePath ? (
                <Typography.Text
                  className="ellipsis-text text-sm"
                  type="secondary"
                  ellipsis={{ tooltip: rule.localFilePath }}
                  copyable
                  style={{ flex: 1, minWidth: 0 }}
                >
                  {rule.localFilePath}
                </Typography.Text>
              ) : (
                <Typography.Text type="secondary" className="text-sm">
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
      }
    },
    {
      title: '',
      width: 44,
      align: 'right',
      onCell: (row) => (isGroupRow(row) ? { colSpan: 0 } : {}),
      render: (_, row) =>
        isGroupRow(row) ? null : (
          <Space size={8}>
            <Tooltip title={t('rules.table.edit')}>
              <EditOutlined style={actionIconStyle} onClick={() => onEdit(row)} />
            </Tooltip>
            <Popconfirm title={t('rules.table.deleteConfirm')} onConfirm={() => onDelete(row)}>
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
      <Table<GroupedRow[number]>
        rowKey={(row) => (isGroupRow(row) ? row.key : row.id)}
        columns={columns}
        dataSource={groupedRows}
        pagination={false}
        size="small"
        showHeader={false}
        className="rules-table--compact"
      />
    </ConfigProvider>
  )
}
