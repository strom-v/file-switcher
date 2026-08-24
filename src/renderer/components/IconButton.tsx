import React from 'react'
import { Button, Tooltip } from 'antd'

type IconButtonProps = React.ComponentProps<typeof Button> & {
  tooltip: React.ReactNode
}

/** Квадратная icon-only кнопка с подсказкой — единый вид для всех кнопок-действий в приложении */
export default function IconButton({ tooltip, className, ...buttonProps }: IconButtonProps): React.ReactElement {
  return (
    <Tooltip title={tooltip}>
      <Button className={className ? `icon-btn ${className}` : 'icon-btn'} size="small" {...buttonProps} />
    </Tooltip>
  )
}
