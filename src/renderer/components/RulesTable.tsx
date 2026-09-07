import React, { useMemo, useState } from 'react'
import { Checkbox, ConfigProvider, Flex, Table, Tag, Tooltip, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useTranslation } from 'react-i18next'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { compareGroupNames, groupKeyOf } from '../../shared/ruleGroups'
import type { Rule } from '../../shared/types'

const GROUP_ROW_PREFIX = 'group:'
const HOME_DIR = window.api.homeDir

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

/** Срезает префикс домашней папки для компактного показа пути в списке (полный путь остаётся в tooltip);
 * HOME_DIR приходит из preload, т.к. renderer сам его не получает */
function stripHomeDir(path: string): string {
  return HOME_DIR && path.startsWith(`${HOME_DIR}/`) ? path.slice(HOME_DIR.length + 1) : path
}

interface GroupHeaderRow {
  __group: true
  key: string
  label: string
  isFirst: boolean
}
type DisplayRow = GroupHeaderRow | (Rule & { __group?: false })

/** Различает строку-заголовок группы от обычного правила */
function isGroupRow(row: DisplayRow): row is GroupHeaderRow {
  return '__group' in row && row.__group === true
}

/** Группирует правила по Rule.group (пустая/undefined — группа "остальные"); заголовок группы
 * показывается всегда, группы и правила внутри отсортированы по алфавиту (латиница впереди кириллицы) */
function groupRules(rules: Rule[], otherLabel: string): DisplayRow[] {
  const groups = Map.groupBy(rules, groupKeyOf)
  const sortedKeys = [...groups.keys()].sort((a, b) => compareGroupNames(a || otherLabel, b || otherLabel))

  const rows: DisplayRow[] = []
  sortedKeys.forEach((key, i) => {
    const groupRulesList = groups.get(key)!.toSorted((a, b) => a.urlPattern.localeCompare(b.urlPattern))
    rows.push({ __group: true, key: `${GROUP_ROW_PREFIX}${key}`, label: key || otherLabel, isFirst: i === 0 })
    rows.push(...groupRulesList)
  })
  return rows
}

/** Оборачивает <tr> правила в draggable dnd-kit; заголовки групп и обычные строки — droppable-зоны,
 * дроп в любую точку группы переносит правило в неё */
function DraggableRow(props: React.HTMLAttributes<HTMLTableRowElement>): React.ReactElement {
  // antd прокидывает в кастомный row-компонент data-row-key — это ключ строки (id правила либо group:*)
  const rowKey = (props as { 'data-row-key'?: string })['data-row-key'] ?? ''
  const isGroupHeader = rowKey.startsWith(GROUP_ROW_PREFIX)

  const draggable = useDraggable({ id: rowKey, disabled: isGroupHeader })
  const droppable = useDroppable({ id: rowKey })

  const style: React.CSSProperties = {
    ...props.style,
    ...(draggable.isDragging ? { opacity: 0.4 } : {}),
    ...(droppable.isOver ? { outline: '2px dashed var(--ant-color-primary)', outlineOffset: -2 } : {})
  }

  const setRefs = (el: HTMLTableRowElement | null): void => {
    draggable.setNodeRef(el)
    droppable.setNodeRef(el)
  }

  const dndProps = isGroupHeader ? {} : { ...draggable.listeners, ...draggable.attributes }
  return <tr {...props} {...dndProps} ref={setRefs} style={style} />
}

interface RulesTableProps {
  rules: Rule[]
  onToggle: (rule: Rule, enabled: boolean) => void
  onEdit: (rule: Rule) => void
  /** переносит правило в другую группу (пустая строка targetGroup — группа "остальные") */
  onMoveToGroup: (ruleId: string, targetGroup: string) => void
}

/** Таблица правил подмены, сгруппированных по Rule.group, с чекбоксом. Клик по строке открывает
 * модалку редактирования; строку правила можно перетащить в другую группу (dnd-kit).
 * Клик по чекбоксу enabled не всплывает до строки, чтобы не открывать модалку заодно. */
export default function RulesTable({ rules, onToggle, onEdit, onMoveToGroup }: RulesTableProps): React.ReactElement {
  const { t } = useTranslation()
  const otherLabel = t('rules.table.otherGroup')
  const [draggedRule, setDraggedRule] = useState<Rule | null>(null)

  const displayRows = useMemo(() => groupRules(rules, otherLabel), [rules, otherLabel])

  // сенсор с дистанцией активации, чтобы обычный клик по строке (открыть модалку) не считался перетаскиванием
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const handleDragStart = (event: DragStartEvent): void => {
    setDraggedRule(rules.find((r) => r.id === event.active.id) ?? null)
  }

  const handleDragEnd = (event: DragEndEvent): void => {
    setDraggedRule(null)
    const { active, over } = event
    if (!over) return

    const rule = rules.find((r) => r.id === active.id)
    if (!rule) return

    // дроп на заголовок группы (id "group:<ключ>") либо на строку правила (id правила — берём его группу)
    const overId = String(over.id)
    const overRule = rules.find((r) => r.id === overId)
    const targetGroup = overId.startsWith(GROUP_ROW_PREFIX)
      ? overId.slice(GROUP_ROW_PREFIX.length)
      : overRule
        ? groupKeyOf(overRule)
        : null

    if (targetGroup !== null && targetGroup !== groupKeyOf(rule)) {
      onMoveToGroup(rule.id, targetGroup)
    }
  }

  const columns: ColumnsType<DisplayRow> = [
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
          <Flex vertical gap={0} style={{ width: '100%', minWidth: 0 }}>
            <Typography.Text
              className="ellipsis-text text-sm"
              ellipsis={{ tooltip: urlPattern }}
              style={{ width: '100%', minWidth: 0 }}
            >
              {urlPattern}
            </Typography.Text>
            <Flex gap={4} align="center" style={{ width: '100%', minWidth: 0 }}>
              {rule.responseBody ? (
                <Typography.Text
                  className="ellipsis-text text-sm"
                  type="secondary"
                  ellipsis={{ tooltip: rule.responseBody }}
                  style={{ flex: 1, minWidth: 0 }}
                >
                  {rule.responseBody}
                </Typography.Text>
              ) : rule.localFilePath ? (
                <Typography.Text
                  className="ellipsis-text text-sm"
                  type="secondary"
                  ellipsis={{ tooltip: rule.localFilePath }}
                  style={{ flex: 1, minWidth: 0 }}
                >
                  {stripHomeDir(rule.localFilePath)}
                </Typography.Text>
              ) : (
                <Typography.Text type="secondary" className="text-sm">
                  {t('rules.table.noFile')}
                </Typography.Text>
              )}
              {hasAdvancedModifications(rule) && (
                <Tooltip title={t('rules.table.hasAdvancedHint')}>
                  <Tag color="blue" style={{ flexShrink: 0, marginInlineEnd: 0 }}>
                    {t('rules.table.hasAdvanced')}
                  </Tag>
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
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <Table<DisplayRow>
          rowKey={(row) => (isGroupRow(row) ? row.key : row.id)}
          columns={columns}
          dataSource={displayRows}
          pagination={false}
          size="small"
          showHeader={false}
          tableLayout="fixed"
          className="rules-table--compact"
          components={{ body: { row: DraggableRow } }}
          onRow={(row) =>
            isGroupRow(row)
              ? { className: 'rules-table-row--group' }
              : {
                  onClick: () => onEdit(row),
                  style: { cursor: 'pointer' },
                  // фон строки разделяет вид подмены: инлайн-тело / локальный файл
                  className: row.responseBody
                    ? 'rules-table-row--body'
                    : row.localFilePath
                      ? 'rules-table-row--file'
                      : undefined
                }
          }
        />
        <DragOverlay>
          {draggedRule ? <div className="rules-table-drag-overlay text-sm">{draggedRule.urlPattern}</div> : null}
        </DragOverlay>
      </DndContext>
    </ConfigProvider>
  )
}
