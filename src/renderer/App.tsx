import React, { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Checkbox,
  ConfigProvider,
  Drawer,
  Flex,
  Layout,
  Popconfirm,
  Space,
  Splitter,
  theme as antdTheme,
  Tooltip,
  Typography,
  message
} from 'antd'
import { PlayCircleOutlined, PlusOutlined, ReloadOutlined, SettingOutlined, StopOutlined } from '@ant-design/icons'
import ruRU from 'antd/locale/ru_RU'
import enUS from 'antd/locale/en_US'
import { useTranslation } from 'react-i18next'
import RulesTable from './components/RulesTable'
import RuleFormModal from './components/RuleFormModal'
import LogPanel from './components/LogPanel'
import SettingsPanel from './components/SettingsPanel'
import IconButton from './components/IconButton'
import OnboardingModal, { hasSeenOnboarding, markOnboardingSeen } from './components/OnboardingModal'
import { useProxyState } from './hooks/useProxyState'
import { useVpnStatus } from './hooks/useVpnStatus'
import { useProxySettings } from './hooks/useProxySettings'
import { useSplitterSize } from './hooks/useSplitterSize'
import { useThemeMode } from './hooks/useThemeMode'
import { setLanguage, type SupportedLanguage } from './i18n'
import { COLOR_DANGER, COLOR_SUCCESS, COLOR_WARNING } from './theme'
import { compareGroupNames } from '../shared/ruleGroups'
import type { ProxyLogEvent, Rule } from '../shared/types'

const ANTD_LOCALES = { ru: ruRU, en: enUS }

// базовый размер шрифта antd; компактный текст списков/деталей — на 1px меньше
const BASE_FONT_SIZE = 13
const COMPACT_FONT_SIZE = BASE_FONT_SIZE - 1

// цвет кнопки старт/стоп отражает действие клика, а не сырой статус процесса:
// зелёный — сейчас остановлена, клик запустит; красный — сейчас работает, клик остановит
const START_STOP_COLOR: Record<string, string> = {
  stopped: COLOR_SUCCESS,
  starting: COLOR_WARNING,
  running: COLOR_DANGER,
  crashed: COLOR_SUCCESS
}

/** Корневой компонент: постоянные панели лога и правил, настройки в Drawer */
export default function App(): React.ReactElement {
  const { t, i18n } = useTranslation()
  const { mode, isDark, setMode } = useThemeMode()
  const [rules, setRules] = useState<Rule[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  // при дублировании (handleDuplicate) editingRule — копия без id, чтобы форма/handleSubmit
  // расценили сохранение как создание нового правила, а не редактирование исходного
  const [editingRule, setEditingRule] = useState<Rule | Omit<Rule, 'id'> | null>(null)
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { splitterSize, setSplitterSize } = useSplitterSize()
  const { port, setPort } = useProxySettings()
  const { status, logs, clearLogs, appendLog } = useProxyState((text) => {
    message.warning(text)
  })
  const { vpn, check: checkVpn } = useVpnStatus()

  useEffect(() => {
    window.api.rules.get().then(setRules)
    if (!hasSeenOnboarding()) {
      setOnboardingOpen(true)
    }
  }, [])

  // прокси запускается автоматически при старте приложения; порт на этот момент уже прочитан
  // из localStorage синхронно при инициализации useProxySettings, поэтому не в deps
  useEffect(() => {
    // rejection глушим: итог запуска (в т.ч. crash с текстом ошибки) приходит через proxy:status broadcast
    window.api.proxy.start(port).catch(() => undefined)
  }, [])

  const handleOnboardingClose = (): void => {
    markOnboardingSeen()
    setOnboardingOpen(false)
  }

  // сохраняет оптимистично (сразу отражает next в UI); если main отклонит правила (например,
  // невалидный regex в urlPattern) — откатывает UI к состоянию, которое реально на диске, и показывает
  // причину. Возвращает true при подтверждённой записи — вызывающий импорт по этому решает, показывать
  // ли success (иначе зелёное сообщение об успехе выходило до отката)
  const persist = async (next: Rule[]): Promise<boolean> => {
    setRules(next)
    try {
      await window.api.rules.save(next)
      return true
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      message.error(text)
      setRules(await window.api.rules.get())
      return false
    }
  }

  const updateRuleById = (id: string, patch: Partial<Rule>): Rule[] =>
    rules.map((r) => (r.id === id ? { ...r, ...patch } : r))

  const handleToggle = (rule: Rule, enabled: boolean): void => {
    persist(updateRuleById(rule.id, { enabled }))
  }

  const handleMoveToGroup = (ruleId: string, targetGroup: string): void => {
    persist(updateRuleById(ruleId, { group: targetGroup }))
  }

  // непустые группы из текущих правил — подсказки в форме правила (порядок как в списке)
  const knownGroups = useMemo(
    () => [...new Set(rules.map((r) => r.group).filter((g): g is string => !!g))].sort(compareGroupNames),
    [rules]
  )

  const handleToggleAll = (enabled: boolean): void => {
    persist(rules.map((r) => ({ ...r, enabled })))
  }

  const handleEdit = (rule: Rule): void => {
    setEditingRule(rule)
    setModalOpen(true)
  }

  const handleDelete = (rule: Rule): void => {
    persist(rules.filter((r) => r.id !== rule.id))
    setModalOpen(false)
  }

  const handleAdd = (): void => {
    setEditingRule(null)
    setModalOpen(true)
  }

  // черновик правила из строки лога: URL запроса как regex с экранированными спецсимволами
  // (точное совпадение по умолчанию, пользователь может ослабить в форме), поле подмены пустое,
  // contentType — тип исходного ответа (используется, если пользователь заполнит инлайн-тело)
  const handleAddRuleFromLog = (log: ProxyLogEvent): void => {
    const escaped = log.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const contentType = log.responseHeaders['content-type'] || log.responseHeaders['Content-Type']
    setEditingRule({ enabled: true, isRegex: true, urlPattern: escaped, group: '', contentType })
    setModalOpen(true)
  }

  // копия без id — RuleFormModal/handleSubmit увидят черновик создания, а не редактирование
  // исходного правила; пользователь может тут же поправить URL/путь и сохранить как новое
  const handleDuplicate = (rule: Rule): void => {
    const { id: _id, ...copy } = rule
    setEditingRule(copy)
    setModalOpen(true)
  }

  const handleRefreshRules = async (): Promise<void> => {
    setRules(await window.api.rules.get())
  }

  const handleSubmit = (rule: Omit<Rule, 'id'> & { id?: string }): void => {
    if (rule.id) {
      persist(updateRuleById(rule.id, rule))
    } else {
      const id = crypto.randomUUID()
      persist([...rules, { ...rule, id }])
    }
    setModalOpen(false)
  }

  const handleStart = async (): Promise<void> => {
    // проверяем VPN прямо перед запуском: full-tunnel (blocksProxy) точно ломает перехват —
    // предупреждаем явно; просто активный VPN обычно не мешает — не отвлекаем
    const vpnNow = await checkVpn()
    if (vpnNow.blocksProxy) {
      message.warning(t('app.vpnBlocksWarning'))
    }
    const state = await window.api.proxy.start(port)
    if (state.status === 'crashed') {
      message.error(state.error ?? t('proxyErrors.startFailed'))
    }
  }

  const handleStop = async (): Promise<void> => {
    await window.api.proxy.stop()
  }

  const handleRelaunch = (): void => {
    window.api.app.relaunch()
  }

  const handleSplitterResizeEnd = (sizes: number[]): void => {
    const [left, right] = sizes
    const total = left + right
    if (total <= 0) return
    setSplitterSize(Math.round((left / total) * 100))
  }

  const enabledRulesCount = rules.filter((r) => r.enabled).length
  const allRulesEnabled = rules.length > 0 && enabledRulesCount === rules.length
  const someRulesEnabled = enabledRulesCount > 0 && enabledRulesCount < rules.length

  const currentLanguage = (i18n.language.startsWith('ru') ? 'ru' : 'en') as SupportedLanguage

  // мемоизация обязательна: без неё новый объект темы на каждый рендер (например, на каждое событие лога)
  // заставляет ConfigProvider пересчитывать CSS-in-JS всего дерева — заметно тормозит перетаскивание Splitter
  const theme = useMemo(
    () => ({
      algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      // paddingLG:10 задаёт и компактные внутренние отступы модалок (antd 6 берёт их из этого токена)
      token: { padding: 6, paddingLG: 10, marginLG: 10, borderRadius: 4, fontSize: BASE_FONT_SIZE },
      components: {
        // itemHeight у Listy = fontHeight + itemPaddingBlock*2 (см. antd/es/listy/index.js) — при
        // fontSize 13 (fontHeight≈20) даёт ровно 36px строки лога, синхронизировано
        // с высотой строки правил (RulesTable, см. global.css: .rules-table--compact tr min-height)
        Listy: { itemPaddingBlock: 8 }
      }
    }),
    [isDark]
  )

  // CSS-переменная для компактного текста (списки лога/правил, детали запроса) — на 1px меньше базового,
  // применяется через var(--app-font-size-sm) вместо хардкода
  const rootStyle = useMemo(
    () =>
      ({
        height: '100vh',
        padding: 8,
        '--app-font-size-sm': `${COMPACT_FONT_SIZE}px`
      }) as React.CSSProperties,
    []
  )

  return (
    <ConfigProvider locale={ANTD_LOCALES[currentLanguage]} theme={theme}>
      <Layout style={rootStyle}>
        <Flex justify="space-between" className="panel-toolbar">
          <Space>
            <Typography.Title level={4} style={{ margin: 0 }}>
              FileSwitcher
            </Typography.Title>
          </Space>
          <Space>
            <IconButton
              tooltip={t('app.settingsButton')}
              icon={<SettingOutlined />}
              onClick={() => setSettingsOpen(true)}
            />
            {/* в dev-режиме electron-vite сам следит за пересборкой/HMR — app.relaunch()
                там не нужен и вдобавок неверно перезапустит dev-инстанс без watch-режима */}
            {!import.meta.env.DEV && (
              <Popconfirm title={t('app.relaunchConfirm')} onConfirm={handleRelaunch}>
                <IconButton tooltip={t('app.relaunchButton')} icon={<ReloadOutlined />} />
              </Popconfirm>
            )}
            <IconButton
              tooltip={
                status.error ??
                (vpn.blocksProxy
                  ? t('app.vpnBlocksWarning')
                  : vpn.active
                    ? t('app.vpnWarning')
                    : t(status.status === 'running' ? 'app.stopProxyButton' : 'app.startProxyButton'))
              }
              icon={status.status === 'running' ? <StopOutlined /> : <PlayCircleOutlined />}
              onClick={status.status === 'running' ? handleStop : handleStart}
              disabled={status.status === 'starting'}
              style={{
                backgroundColor: START_STOP_COLOR[status.status],
                borderColor: START_STOP_COLOR[status.status],
                color: '#fff'
              }}
            />
          </Space>
        </Flex>

        {/* full-tunnel VPN точно ломает перехват — заметный алерт, висит пока такой VPN активен
            и сам исчезает при его отключении (закрыть вручную нельзя, иначе потерялось бы) */}
        {vpn.blocksProxy && (
          <Alert type="error" showIcon message={t('app.vpnBlocksWarning')} style={{ marginBottom: 8 }} />
        )}

        <Splitter style={{ flex: 1, minHeight: 0 }} onResize={handleSplitterResizeEnd}>
          <Splitter.Panel size={`${splitterSize}%`} min="20%" max="80%">
            <div style={{ height: '100%', paddingRight: 8 }}>
              <LogPanel logs={logs} onClear={clearLogs} onAddRule={handleAddRuleFromLog} onReplayLogged={appendLog} />
            </div>
          </Splitter.Panel>
          <Splitter.Panel>
            <div className="panel-column" style={{ paddingLeft: 8 }}>
              <Flex justify="space-between" align="center" className="panel-toolbar">
                <Tooltip title={t(allRulesEnabled ? 'rules.disableAll' : 'rules.enableAll')}>
                  <Flex align="center" justify="center" style={{ width: 24, height: 24 }}>
                    <Checkbox
                      checked={allRulesEnabled}
                      indeterminate={someRulesEnabled}
                      disabled={rules.length === 0}
                      onChange={(e) => handleToggleAll(e.target.checked)}
                    />
                  </Flex>
                </Tooltip>
                <IconButton
                  tooltip={t('rules.addButton')}
                  icon={<PlusOutlined />}
                  onClick={handleAdd}
                  style={{ color: COLOR_SUCCESS, borderColor: COLOR_SUCCESS }}
                />
              </Flex>
              <div className="scroll-panel scroll-panel--visible scroll-panel--panel-bg">
                <RulesTable
                  rules={rules}
                  onToggle={handleToggle}
                  onEdit={handleEdit}
                  onMoveToGroup={handleMoveToGroup}
                />
              </div>
            </div>
          </Splitter.Panel>
        </Splitter>

        <RuleFormModal
          open={modalOpen}
          initialValue={editingRule}
          knownGroups={knownGroups}
          onCancel={() => setModalOpen(false)}
          onSubmit={handleSubmit}
          onDelete={handleDelete}
          onDuplicate={handleDuplicate}
        />
        <OnboardingModal open={onboardingOpen} onClose={handleOnboardingClose} />
        <Drawer open={settingsOpen} onClose={() => setSettingsOpen(false)} size={460} closeIcon={false} destroyOnHidden>
          <SettingsPanel
            status={status}
            port={port}
            onPortChange={setPort}
            rules={rules}
            onRulesImport={persist}
            onRulesRefresh={handleRefreshRules}
            language={currentLanguage}
            onLanguageChange={setLanguage}
            themeMode={mode}
            onThemeModeChange={setMode}
          />
        </Drawer>
      </Layout>
    </ConfigProvider>
  )
}
