import React, { useEffect, useMemo, useState } from 'react'
import {
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
import { useLogStorageLimit } from './hooks/useLogStorageLimit'
import { useProxySettings } from './hooks/useProxySettings'
import { useSplitterSize } from './hooks/useSplitterSize'
import { useThemeMode } from './hooks/useThemeMode'
import { COMPACT_FONT_SIZE_OFFSET, useFontSize } from './hooks/useFontSize'
import { setLanguage, type SupportedLanguage } from './i18n'
import { COLOR_DANGER, COLOR_SUCCESS, COLOR_WARNING } from './theme'
import type { Rule } from '../shared/types'

const ANTD_LOCALES = { ru: ruRU, en: enUS }

// ключи настроек, которые сбрасывает "сбросить все настройки"
const RESETTABLE_STORAGE_KEYS = [
  'file-switcher:theme',
  'file-switcher:language',
  'file-switcher:font-size',
  'file-switcher:log-storage-limit',
  'file-switcher:port',
  'file-switcher:auto-start-proxy',
  'file-switcher:splitter-size'
]

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
  const { fontSize, setFontSize } = useFontSize()
  const [rules, setRules] = useState<Rule[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  // при дублировании (handleDuplicate) editingRule — копия без id, чтобы форма/handleSubmit
  // расценили сохранение как создание нового правила, а не редактирование исходного
  const [editingRule, setEditingRule] = useState<Rule | Omit<Rule, 'id'> | null>(null)
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { splitterSize, setSplitterSize } = useSplitterSize()
  const { logStorageLimit, setLogStorageLimit } = useLogStorageLimit()
  const { port, setPort, autoStart, setAutoStart } = useProxySettings()
  const { status, logs, clearLogs } = useProxyState(logStorageLimit, (text) => {
    message.warning(text)
  })

  useEffect(() => {
    window.api.rules.get().then(setRules)
    if (!hasSeenOnboarding()) {
      setOnboardingOpen(true)
    }
  }, [])

  // автозапуск прокси при старте приложения, если включено в настройках; порт на этот момент
  // уже прочитан из localStorage синхронно при инициализации useProxySettings, поэтому не в deps
  useEffect(() => {
    if (autoStart) {
      window.api.proxy.start(port)
    }
  }, [])

  const handleOnboardingClose = (): void => {
    markOnboardingSeen()
    setOnboardingOpen(false)
  }

  // сохраняет оптимистично (сразу отражает next в UI); если main отклонит правила (например,
  // невалидный regex в urlPattern) — откатывает UI к состоянию, которое реально на диске, и показывает причину
  const persist = async (next: Rule[]): Promise<void> => {
    setRules(next)
    try {
      await window.api.rules.save(next)
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      message.error(text)
      setRules(await window.api.rules.get())
    }
  }

  const updateRuleById = (id: string, patch: Partial<Rule>): Rule[] =>
    rules.map((r) => (r.id === id ? { ...r, ...patch } : r))

  const handleToggle = (rule: Rule, enabled: boolean): void => {
    persist(updateRuleById(rule.id, { enabled }))
  }

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

  // сбрасывает язык/тему/шрифт/порт/автостарт/лимит лога к дефолту и перезагружает окно,
  // чтобы все хуки с персистентностью заново прочитали чистое состояние из localStorage
  const handleResetSettings = (): void => {
    for (const key of RESETTABLE_STORAGE_KEYS) {
      localStorage.removeItem(key)
    }
    location.reload()
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
      token: { padding: 6, paddingLG: 10, marginLG: 10, borderRadius: 4, fontSize },
      components: {
        Modal: { contentPadding: 12 },
        // itemHeight у Listy = fontHeight + itemPaddingBlock*2 (см. antd/es/listy/index.js) — при
        // дефолтном fontSize (13, fontHeight≈20) даёт ровно 36px строки лога, синхронизировано
        // с высотой строки правил (RulesTable, см. global.css: .rules-table--compact tr min-height)
        Listy: { itemPaddingBlock: 8 }
      }
    }),
    [isDark, fontSize]
  )

  // CSS-переменная для компактного текста (списки лога/правил, детали запроса) — на 1px меньше базового,
  // применяется через var(--app-font-size-sm) вместо хардкода, чтобы масштабироваться вместе с настройкой
  const rootStyle = useMemo(
    () =>
      ({
        height: '100vh',
        padding: 8,
        '--app-font-size-sm': `${fontSize - COMPACT_FONT_SIZE_OFFSET}px`
      }) as React.CSSProperties,
    [fontSize]
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
              tooltip={status.error ?? t('app.vpnWarning')}
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

        <Splitter style={{ flex: 1, minHeight: 0 }} onResize={handleSplitterResizeEnd}>
          <Splitter.Panel size={`${splitterSize}%`} min="20%" max="80%">
            <div style={{ height: '100%', paddingRight: 8 }}>
              <LogPanel logs={logs} onClear={clearLogs} />
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
                <RulesTable rules={rules} onToggle={handleToggle} onEdit={handleEdit} />
              </div>
            </div>
          </Splitter.Panel>
        </Splitter>

        <RuleFormModal
          open={modalOpen}
          initialValue={editingRule}
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
            autoStart={autoStart}
            onAutoStartChange={setAutoStart}
            logs={logs}
            rules={rules}
            onRulesImport={persist}
            onRulesRefresh={handleRefreshRules}
            language={currentLanguage}
            onLanguageChange={setLanguage}
            themeMode={mode}
            onThemeModeChange={setMode}
            fontSize={fontSize}
            onFontSizeChange={setFontSize}
            splitterSize={splitterSize}
            onSplitterSizeChange={setSplitterSize}
            logStorageLimit={logStorageLimit}
            onLogStorageLimitChange={setLogStorageLimit}
            onResetSettings={handleResetSettings}
          />
        </Drawer>
      </Layout>
    </ConfigProvider>
  )
}
