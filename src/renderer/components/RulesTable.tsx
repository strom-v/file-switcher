import React, { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button, Checkbox, ConfigProvider, Flex, message, Table, Tag, Tooltip, Typography } from 'antd'
import { CopyOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { useTranslation } from 'react-i18next'
import type { Rule } from '../../shared/types'

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

interface CopyableEllipsisTextProps {
  text: string
  type?: 'secondary'
}

/** Однострочный ellipsis-текст со своей copy-кнопкой вместо встроенного antd copyable. Ellipsis
 * у Typography.Text использует CSS line-clamp (-webkit-box), который требует, чтобы сам элемент
 * был растянут на всю доступную ширину колонки — иначе обрезание длинных строк не работает.
 * Значит :hover-зона (на всю ширину растянутого текста) неизбежно шире короткого видимого текста,
 * но саму кнопку нужно визуально ставить сразу после него — измеряем реальную ширину отрисованного
 * (уже обрезанного) текста через getBoundingClientRect и позиционируем кнопку туда через left. */
function CopyableEllipsisText({ text, type }: CopyableEllipsisTextProps): React.ReactElement {
  const { t } = useTranslation()
  const textRef = useRef<HTMLSpanElement>(null)
  const [btnLeft, setBtnLeft] = useState(0)

  useLayoutEffect(() => {
    const el = textRef.current
    if (!el) return
    const measure = (): void => setBtnLeft(el.getBoundingClientRect().width)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text])

  // stopPropagation — иначе клик по кнопке всплыл бы до onRow строки и заодно открыл модалку
  // редактирования вместе с копированием (строка в RulesTable целиком кликабельна)
  const handleCopy = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(text)
      message.success(t('rules.table.copied'))
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <span className="copyable-text-wrapper">
      <Typography.Text ref={textRef} className="ellipsis-text text-sm" type={type} ellipsis={{ tooltip: text }}>
        {text}
      </Typography.Text>
      <Button
        className="copyable-text-btn"
        size="small"
        type="link"
        icon={<CopyOutlined />}
        onClick={handleCopy}
        style={{ left: btnLeft }}
      />
    </span>
  )
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

/** Группирует правила по репозиторию из localFilePath, заголовок группы показывается всегда, даже если группа одна;
 * группы и правила внутри них отсортированы по алфавиту (латинские названия групп впереди кириллических),
 * правила без распознанного репозитория — в "остальные" */
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

  const rows: GroupedRow = []
  sortedRepos.forEach((repo, i) => {
    const groupRules = groups.get(repo)!.sort((a, b) => a.urlPattern.localeCompare(b.urlPattern))
    rows.push({ __group: true, key: `group:${repo}`, label: repo, isFirst: i === 0 })
    rows.push(...groupRules)
  })
  return rows
}

interface RulesTableProps {
  rules: Rule[]
  onToggle: (rule: Rule, enabled: boolean) => void
  onEdit: (rule: Rule) => void
}

/** Таблица правил подмены, сгруппированных по репозиторию из пути подмены, с чекбоксом.
 * Клик по строке открывает модалку редактирования/удаления (onEdit); клик по чекбоксу enabled
 * не всплывает до строки (onCell.onClick: stopPropagation), чтобы не открывать модалку заодно. */
export default function RulesTable({ rules, onToggle, onEdit }: RulesTableProps): React.ReactElement {
  const { t } = useTranslation()

  const groupedRows = useMemo(() => groupRulesByRepo(rules, t('rules.table.otherGroup')), [rules, t])

  const columns: ColumnsType<GroupedRow[number]> = [
    {
      dataIndex: 'enabled',
      width: 36,
      onCell: (row) => (isGroupRow(row) ? { colSpan: 0 } : { onClick: (e: React.MouseEvent) => e.stopPropagation() }),
      render: (_, row) =>
        isGroupRow(row) ? null : <Checkbox checked={row.enabled} onChange={(e) => onToggle(row, e.target.checked)} />
    },
    {
      title: '',
      dataIndex: 'urlPattern',
      onCell: (row) => (isGroupRow(row) ? { colSpan: 2 } : {}),
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
            {urlPattern ? <CopyableEllipsisText text={urlPattern} /> : null}
            <Flex gap={4} align="center" style={{ width: '100%' }}>
              {rule.localFilePath ? (
                <CopyableEllipsisText text={rule.localFilePath} type="secondary" />
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
        onRow={(row) => (isGroupRow(row) ? {} : { onClick: () => onEdit(row), style: { cursor: 'pointer' } })}
      />
    </ConfigProvider>
  )
}
