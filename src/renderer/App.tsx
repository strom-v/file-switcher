import React, { useEffect, useMemo, useState } from 'react'
import {
  ConfigProvider,
  Drawer,
  Flex,
  Layout,
  Space,
  Splitter,
  Tag,
  Tooltip,
  theme as antdTheme,
  Typography,
  message
} from 'antd'
import { PlayCircleOutlined, PlusOutlined, SettingOutlined, StopOutlined } from '@ant-design/icons'
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
import { useThemeMode } from './hooks/useThemeMode'
import { useVpnStatus } from './hooks/useVpnStatus'
import { COMPACT_FONT_SIZE_OFFSET, useFontSize } from './hooks/useFontSize'
import { setLanguage, type SupportedLanguage } from './i18n'
import { COLOR_DANGER, COLOR_SUCCESS, COLOR_WARNING } from './theme'
import type { Rule } from '../shared/types'

const ANTD_LOCALES = { ru: ruRU, en: enUS }

const SPLITTER_SIZE_STORAGE_KEY = 'file-switcher:splitter-size'
const DEFAULT_SPLITTER_SIZE = '50%'

/** Сохранённая доля ширины левой панели (лог) из прошлого запуска, если она есть и валидна */
function readStoredSplitterSize(): string {
  const stored = localStorage.getItem(SPLITTER_SIZE_STORAGE_KEY)
  if (stored && /^\d+(\.\d+)?%$/.test(stored)) {
    return stored
  }
  return DEFAULT_SPLITTER_SIZE
}

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
  const vpnStatus = useVpnStatus()
  const [rules, setRules] = useState<Rule[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<Rule | null>(null)
  const [port, setPort] = useState(8080)
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [splitterSize] = useState(readStoredSplitterSize)
  const { status, logs, clearLogs } = useProxyState((text) => {
    message.warning(text)
  })

  useEffect(() => {
    window.api.rules.get().then(setRules)
    if (!hasSeenOnboarding()) {
      setOnboardingOpen(true)
    }
  }, [])

  const handleOnboardingClose = (): void => {
    markOnboardingSeen()
    setOnboardingOpen(false)
  }

  const persist = async (next: Rule[]): Promise<void> => {
    setRules(next)
    await window.api.rules.save(next)
  }

  const handleToggle = (rule: Rule, enabled: boolean): void => {
    persist(rules.map((r) => (r.id === rule.id ? { ...r, enabled } : r)))
  }

  const handleEdit = (rule: Rule): void => {
    setEditingRule(rule)
    setModalOpen(true)
  }

  const handleDelete = (rule: Rule): void => {
    persist(rules.filter((r) => r.id !== rule.id))
  }

  const handleAdd = (): void => {
    setEditingRule(null)
    setModalOpen(true)
  }

  const handleSubmit = (rule: Omit<Rule, 'id'> & { id?: string }): void => {
    if (rule.id) {
      persist(rules.map((r) => (r.id === rule.id ? { ...r, ...rule, id: rule.id! } : r)))
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

  const handleSplitterResizeEnd = (sizes: number[]): void => {
    const [left, right] = sizes
    const total = left + right
    if (total <= 0) return
    localStorage.setItem(SPLITTER_SIZE_STORAGE_KEY, `${((left / total) * 100).toFixed(2)}%`)
  }

  const currentLanguage = (i18n.language.startsWith('ru') ? 'ru' : 'en') as SupportedLanguage
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
    () => ({ height: '100vh', padding: 8, '--app-font-size-sm': `${fontSize - COMPACT_FONT_SIZE_OFFSET}px` }) as React.CSSProperties,
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
            {vpnStatus.active && (
              <Tooltip title={t('app.vpnActiveHint')}>
                <Tag color="error">{vpnStatus.name ?? t('app.vpnActive')}</Tag>
              </Tooltip>
            )}
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
            <IconButton
              tooltip={status.error ? `${statusLabels[status.status]}: ${status.error}` : statusLabels[status.status]}
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

        <Splitter style={{ flex: 1, minHeight: 0 }} onResizeEnd={handleSplitterResizeEnd}>
          <Splitter.Panel defaultSize={splitterSize} min="20%" max="80%">
            <div style={{ height: '100%', paddingRight: 8 }}>
              <LogPanel logs={logs} onClear={clearLogs} />
            </div>
          </Splitter.Panel>
          <Splitter.Panel>
            <div className="panel-column" style={{ paddingLeft: 8 }}>
              <div className="scroll-panel scroll-panel--visible">
                <RulesTable rules={rules} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} />
              </div>
            </div>
          </Splitter.Panel>
        </Splitter>

        <RuleFormModal
          open={modalOpen}
          initialValue={editingRule}
          onCancel={() => setModalOpen(false)}
          onSubmit={handleSubmit}
        />
        <OnboardingModal open={onboardingOpen} onClose={handleOnboardingClose} />
        <Drawer
          title={t('app.settingsDrawerTitle')}
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          width={420}
          destroyOnHidden
        >
          <SettingsPanel
            status={status}
            port={port}
            onPortChange={setPort}
            logs={logs}
            rules={rules}
            onRulesImport={persist}
            language={currentLanguage}
            onLanguageChange={setLanguage}
            themeMode={mode}
            onThemeModeChange={setMode}
            fontSize={fontSize}
            onFontSizeChange={setFontSize}
          />
        </Drawer>
      </Layout>
    </ConfigProvider>
  )
}
