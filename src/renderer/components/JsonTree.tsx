import React, { useMemo } from 'react'
import { Tree, Typography } from 'antd'
import type { TreeDataNode } from 'antd'
import { COLOR_DANGER, COLOR_INFO, COLOR_SUCCESS } from '../theme'

interface JsonTreeProps {
  value: unknown
}

// подсветка по типу значения — та же палитра, что у jsonview (строки зелёным, числа/bool синим,
// null красным); ключи остаются обычным текстом, без подсветки
function renderPrimitive(value: unknown): React.ReactNode {
  if (value === null) {
    return <Typography.Text style={{ color: COLOR_DANGER }}>null</Typography.Text>
  }
  if (typeof value === 'string') {
    return <Typography.Text style={{ color: COLOR_SUCCESS }}>"{value}"</Typography.Text>
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <Typography.Text style={{ color: COLOR_INFO }}>{String(value)}</Typography.Text>
  }
  return <Typography.Text type="secondary">{String(value)}</Typography.Text>
}

let nodeKeySeq = 0

/** Строит узлы antd Tree рекурсивно из произвольного JSON-значения; объекты/массивы — сворачиваемые
 * узлы с числом элементов в заголовке, примитивы — лист с подсветкой по типу */
function buildTreeNodes(value: unknown, keyPrefix: string): TreeDataNode[] {
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      const key = `${keyPrefix}.${index}`
      const isExpandable = item !== null && typeof item === 'object'
      return {
        key,
        title: isExpandable ? (
          <Typography.Text strong>
            [{index}] {Array.isArray(item) ? `Array(${item.length})` : `Object`}
          </Typography.Text>
        ) : (
          <>
            <Typography.Text type="secondary">[{index}] </Typography.Text>
            {renderPrimitive(item)}
          </>
        ),
        children: isExpandable ? buildTreeNodes(item, key) : undefined
      }
    })
  }

  if (value !== null && typeof value === 'object') {
    return Object.entries(value).map(([prop, propValue]) => {
      const key = `${keyPrefix}.${prop}`
      const isExpandable = propValue !== null && typeof propValue === 'object'
      return {
        key,
        title: isExpandable ? (
          <Typography.Text strong>
            {prop}: {Array.isArray(propValue) ? `Array(${propValue.length})` : `Object`}
          </Typography.Text>
        ) : (
          <>
            <Typography.Text strong>{prop}: </Typography.Text>
            {renderPrimitive(propValue)}
          </>
        ),
        children: isExpandable ? buildTreeNodes(propValue, key) : undefined
      }
    })
  }

  // корневое значение — не объект и не массив (например тело — просто число или строка в кавычках)
  return [{ key: keyPrefix, title: renderPrimitive(value) }]
}

/** Сворачиваемое JSON-дерево (как jsonview) для просмотра тела запроса/ответа вместо плоского
 * текста с отступами — подсветка по типу значения, узлы объектов/массивов сворачиваются */
export default function JsonTree({ value }: JsonTreeProps): React.ReactElement {
  // ключи узлов должны быть стабильны между рендерами одного и того же дерева (иначе antd Tree
  // теряет состояние развёрнутости), но уникальны между разными открытыми деревьями на странице —
  // префикс на основе счётчика, посчитанного один раз при монтировании через useMemo
  const rootPrefix = useMemo(() => `json-${nodeKeySeq++}`, [])
  const treeData = useMemo(() => buildTreeNodes(value, rootPrefix), [value, rootPrefix])

  return (
    <Tree
      treeData={treeData}
      defaultExpandAll
      showLine
      selectable={false}
      className="text-sm"
      style={{ background: 'transparent' }}
    />
  )
}
