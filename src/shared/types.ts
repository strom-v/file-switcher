/**
 * Общие типы для main, preload и renderer.
 */

/** Пара имя/значение заголовка; пустое value означает "удалить заголовок", если он есть в запросе/ответе */
export interface HeaderOverride {
  name: string
  value: string
}

export interface Rule {
  id: string
  enabled: boolean
  urlPattern: string
  isRegex: boolean
  /** группа в списке правил. undefined — ещё не мигрировано (группа определится из пути при загрузке);
   * пустая строка — явно отнесено к группе "остальные" */
  group?: string
  /** пусто — запрос идёт на реальный сервер без подмены тела, применяются только остальные модификации ниже */
  localFilePath?: string
  /** тело ответа прямо в правиле (без файла на диске); имеет приоритет над localFilePath */
  responseBody?: string
  contentType?: string
  requestHeaderOverrides?: HeaderOverride[]
  responseHeaderOverrides?: HeaderOverride[]
  /** задержка перед ответом в миллисекундах — эмуляция медленной сети */
  delayMs?: number
  /** подменяет HTTP-статус ответа (например для теста обработки ошибок 500/404) */
  statusCodeOverride?: number
}

export type ProxyStatus = 'stopped' | 'starting' | 'running' | 'crashed'

export interface ProxyState {
  status: ProxyStatus
  port: number
  error?: string
}

// matched — сработала подмена; passed — прошёл насквозь; replay — повторная отправка запроса
// из лога напрямую на сервер (не через прокси), см. LogPanel context menu + replayRequest
export type ProxyLogEventType = 'matched' | 'passed' | 'replay'

/** Лёгкая запись лога для списка — без тел и заголовков; они лежат на диске и грузятся по ts
 * при открытии деталей (log:getEvent). Полный набор полей — в ProxyLogEvent. */
export interface LogEntryMeta {
  event: ProxyLogEventType
  url: string
  file: string
  method: string
  statusCode: number | null
  responseSize: number
  ts: number
  requestBodyIsBinary: boolean
  requestBodySize: number
  responseBodyIsBinary: boolean
}

export interface ProxyLogEvent extends LogEntryMeta {
  requestHeaders: Record<string, string>
  responseHeaders: Record<string, string>
  /** тело запроса, декодировано как текст (errors=replace для бинарных данных) */
  requestBody: string
  /** тело ответа, декодировано как текст (errors=replace для бинарных данных) */
  responseBody: string
}

export type CertStatus = 'not-generated' | 'not-trusted' | 'trusted'

export interface VpnStatus {
  /** есть признаки VPN: подключённый VPN-сервис ОС или активный туннельный интерфейс */
  active: boolean
  /** дефолтный сетевой маршрут идёт через туннельный интерфейс — full-tunnel VPN, при котором
   * системный прокси не перехватывает трафик (split-tunnel не мешает и сюда не попадает) */
  blocksProxy: boolean
}
