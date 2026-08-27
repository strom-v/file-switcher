import React, { useEffect, useMemo, useState } from 'react'
import {
  ConfigProvider,
  Drawer,
  Flex,
  Layout,
  Space,
  Splitter,
  theme as antdTheme,
  Tooltip,
  Typography,
  message
} from 'antd'
import { PlusOutlined, QuestionCircleOutlined, SettingOutlined } from '@ant-design/icons'
import ruRU from 'antd/locale/ru_RU'
import enUS from 'antd/locale/en_US'
import zhCN from 'antd/locale/zh_CN'
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

const ANTD_LOCALES = { ru: ruRU, en: enUS, zh: zhCN }

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
  const [editingRule, setEditingRule] = useState<Rule | null>(null)
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

  const currentLanguage = (
    i18n.language.startsWith('ru') ? 'ru' : i18n.language.startsWith('zh') ? 'zh' : 'en'
  ) as SupportedLanguage
  const statusLabels: Record<string, string> = {
    stopped: t('settings.statusLabels.stopped'),
    starting: t('settings.statusLabels.starting'),
    running: t('settings.statusLabels.running'),
    crashed: t('settings.statusLabels.crashed')
  }

  // мемоизация обязательна: без неё новый объект темы на каждый рендер (например, на каждое событие лога)
  // заставляет ConfigProvider пересчитывать CSS-in-JS всего дерева — заметно тормозит перетаскивание Splitter
  const theme = useMemo(
    () => ({
      algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      token: { padding: 6, paddingLG: 10, marginLG: 10, borderRadius: 4, fontSize },
      components: { Modal: { contentPadding: 12 } }
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
            <Tooltip
              title={status.error ? `${statusLabels[status.status]}: ${status.error}` : statusLabels[status.status]}
            >
              <Typography.Title
                level={4}
                style={{
                  margin: 0,
                  color: START_STOP_COLOR[status.status],
                  cursor: status.status === 'starting' ? 'default' : 'pointer',
                  userSelect: 'none'
                }}
                onClick={
                  status.status === 'starting' ? undefined : status.status === 'running' ? handleStop : handleStart
                }
              >
                FileSwitcher
              </Typography.Title>
            </Tooltip>
            <Tooltip title={t('app.titleClickHint')}>
              <QuestionCircleOutlined className="hint-icon" />
            </Tooltip>
          </Space>
          <Space>
            <IconButton
              tooltip={t('rules.addButton')}
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleAdd}
              style={{ backgroundColor: COLOR_SUCCESS, borderColor: COLOR_SUCCESS }}
            />
            <IconButton
              tooltip={t('app.settingsButton')}
              icon={<SettingOutlined />}
              onClick={() => setSettingsOpen(true)}
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
