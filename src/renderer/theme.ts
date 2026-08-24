/** Единая цветовая палитра статусов, общая для индикаторов прокси и HTTP-статусов в логе */
export const COLOR_SUCCESS = '#52c41a'
export const COLOR_WARNING = '#faad14'
export const COLOR_DANGER = '#ff4d4f'
export const COLOR_INFO = '#1677ff'

/** Цвет по HTTP-статус-коду ответа: 2xx — успех, 3xx — инфо, 4xx — предупреждение, 5xx — ошибка */
export function httpStatusColor(statusCode: number | null): string | undefined {
  if (statusCode === null) return undefined
  if (statusCode >= 500) return COLOR_DANGER
  if (statusCode >= 400) return COLOR_WARNING
  if (statusCode >= 300) return COLOR_INFO
  if (statusCode >= 200) return COLOR_SUCCESS
  return undefined
}
