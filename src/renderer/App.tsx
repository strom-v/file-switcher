import React, { useEffect, useState } from 'react'
import {
  ConfigProvider,
  Drawer,
  Flex,
  Layout,
  Space,
  Splitter,
  Tabs,
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
import TrafficStats from './components/TrafficStats'
import SettingsPanel from './components/SettingsPanel'
import IconButton from './components/IconButton'
import OnboardingModal, { hasSeenOnboarding, markOnboardingSeen } from './components/OnboardingModal'
import { useProxyState } from './hooks/useProxyState'
import { useThemeMode } from './hooks/useThemeMode'
import { useVpnStatus } from './hooks/useVpnStatus'
import { setLanguage, type SupportedLanguage } from './i18n'
import { COLOR_DANGER, COLOR_SUCCESS, COLOR_WARNING } from './theme'
import type { Rule } from '../shared/types'

const ANTD_LOCALES = { ru: ruRU, en: enUS }

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
  const vpnActive = useVpnStatus()
  const [rules, setRules] = useState<Rule[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<Rule | null>(null)
  const [port, setPort] = useState(8080)
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
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

  const handleToggleAll = (enabled: boolean): void => {
    persist(rules.map((r) => ({ ...r, enabled })))
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

  const currentLanguage = (i18n.language.startsWith('ru') ? 'ru' : 'en') as SupportedLanguage
  const statusLabels: Record<string, string> = {
    stopped: t('settings.statusLabels.stopped'),
    starting: t('settings.statusLabels.starting'),
    running: t('settings.statusLabels.running'),
    crashed: t('settings.statusLabels.crashed')
  }

  return (
    <ConfigProvider
      locale={ANTD_LOCALES[currentLanguage]}
      theme={{ algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm }}
    >
      <Layout style={{ height: '100vh', padding: 16 }}>
        <Flex justify="space-between" className="panel-toolbar">
          <Space>
            <Typography.Title level={4} style={{ margin: 0 }}>
              FileSwitcher
            </Typography.Title>
            {vpnActive && (
              <Tooltip title={t('app.vpnActiveHint')}>
                <Tag color="error">{t('app.vpnActive')}</Tag>
              </Tooltip>
            )}
          </Space>
          <Space>
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

        <Splitter style={{ flex: 1, minHeight: 0 }}>
          <Splitter.Panel defaultSize="50%" min="20%" max="80%">
            <div className="panel-column" style={{ paddingRight: 16 }}>
              <Tabs
                size="small"
                className="panel-column"
                items={[
                  {
                    key: 'log',
                    label: t('app.logTab'),
                    children: (
                      <div className="scroll-panel">
                        <LogPanel logs={logs} onClear={clearLogs} />
                      </div>
                    )
                  },
                  {
                    key: 'stats',
                    label: t('app.statsTab'),
                    children: (
                      <div className="scroll-panel">
                        <TrafficStats logs={logs} />
                      </div>
                    )
                  }
                ]}
              />
            </div>
          </Splitter.Panel>
          <Splitter.Panel>
            <div className="panel-column" style={{ paddingLeft: 16 }}>
              <Flex justify="flex-end" className="panel-toolbar">
                <IconButton
                  tooltip={t('rules.addButton')}
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={handleAdd}
                  style={{ backgroundColor: COLOR_SUCCESS, borderColor: COLOR_SUCCESS }}
                />
              </Flex>
              <div className="scroll-panel">
                <RulesTable
                  rules={rules}
                  onToggle={handleToggle}
                  onToggleAll={handleToggleAll}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
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
          />
        </Drawer>
      </Layout>
    </ConfigProvider>
  )
}
