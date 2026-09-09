import React, { useEffect, useState } from 'react'
import { Alert, Button, Checkbox, Flex, InputNumber, Popconfirm, Select, Slider, Space, Tooltip, message } from 'antd'
import { QuestionCircleOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import SectionHeader from './SectionHeader'
import SettingsGroup from './SettingsGroup'
import { FONT_SIZE_MAX, FONT_SIZE_MIN } from '../hooks/useFontSize'
import { SPLITTER_SIZE_MAX, SPLITTER_SIZE_MIN } from '../hooks/useSplitterSize'
import type { ThemeMode } from '../hooks/useThemeMode'
import type { SupportedLanguage } from '../i18n'
import type { CertStatus, ProxyState, Rule } from '../../shared/types'

interface SettingsPanelProps {
  status: ProxyState
  port: number
  onPortChange: (port: number) => void
  autoStart: boolean
  onAutoStartChange: (autoStart: boolean) => void
  /** число записей в отображении лога — для disabled кнопки экспорта */
  logCount: number
  rules: Rule[]
  onRulesImport: (rules: Rule[]) => void
  onRulesRefresh: () => Promise<void>
  language: SupportedLanguage
  onLanguageChange: (language: SupportedLanguage) => void
  themeMode: ThemeMode
  onThemeModeChange: (mode: ThemeMode) => void
  fontSize: number
  onFontSizeChange: (size: number) => void
  splitterSize: number
  onSplitterSizeChange: (size: number) => void
  onResetSettings: () => void
}

/** Проверяет, что распарсенный JSON похож на массив Rule — минимально, без строгой валидации формы каждого поля */
function isRuleArray(value: unknown): value is Rule[] {
  return (
    Array.isArray(value) &&
    value.every((item) => item && typeof item === 'object' && 'urlPattern' in item && 'id' in item)
  )
}

/** Панель настроек: язык/тема, порт, статус сертификата, экспорт лога и правил */
export default function SettingsPanel({
  status,
  port,
  onPortChange,
  autoStart,
  onAutoStartChange,
  logCount,
  rules,
  onRulesImport,
  onRulesRefresh,
  language,
  onLanguageChange,
  themeMode,
  onThemeModeChange,
  fontSize,
  onFontSizeChange,
  splitterSize,
  onSplitterSizeChange,
  onResetSettings
}: SettingsPanelProps): React.ReactElement {
  const { t } = useTranslation()
  const [certStatus, setCertStatus] = useState<CertStatus>('not-generated')
  const [installing, setInstalling] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [sudoersInstalled, setSudoersInstalled] = useState(true)
  const [installingSudoers, setInstallingSudoers] = useState(false)
  const [refreshingRules, setRefreshingRules] = useState(false)
  const [logExportFormat, setLogExportFormat] = useState<'har' | 'json' | 'csv'>('har')
  const [devToolsOpened, setDevToolsOpened] = useState(false)

  const refreshCertStatus = async (): Promise<void> => {
    setCertStatus(await window.api.cert.status())
  }

  useEffect(() => {
    refreshCertStatus()
    window.api.system.sudoersInstalled().then(setSudoersInstalled)
  }, [status.status])

  // текст кнопки devtools зависит от их состояния; синхронизируем и при открытии панели,
  // и по событию (пользователь мог закрыть devtools горячей клавишей, минуя кнопку)
  useEffect(() => {
    window.api.window.isDevToolsOpened().then(setDevToolsOpened)
    return window.api.window.onDevToolsChanged(setDevToolsOpened)
  }, [])

  const handleInstallSudoersRule = async (): Promise<void> => {
    setInstallingSudoers(true)
    try {
      await window.api.system.installSudoersRule()
      setSudoersInstalled(await window.api.system.sudoersInstalled())
      message.success(t('settings.sudoersInstallSuccess'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      message.error(t('settings.sudoersInstallError', { message: msg }))
    } finally {
      setInstallingSudoers(false)
    }
  }

  const handleInstallCert = async (): Promise<void> => {
    setInstalling(true)
    try {
      await window.api.cert.install()
      await refreshCertStatus()
      message.success(t('settings.installCertSuccess'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      message.error(t('settings.installCertError', { message: msg }))
    } finally {
      setInstalling(false)
    }
  }

  const handleRemoveCert = async (): Promise<void> => {
    setRemoving(true)
    try {
      await window.api.cert.remove()
      await refreshCertStatus()
      message.success(t('settings.removeCertSuccess'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      message.error(t('settings.removeCertError', { message: msg }))
    } finally {
      setRemoving(false)
    }
  }

  const exportToFile = async (defaultFileName: string, content: string, successKey: string): Promise<void> => {
    const savedPath = await window.api.dialog.saveTextFile(defaultFileName, content)
    if (savedPath) message.success(t(successKey, { path: savedPath }))
  }

  const handleExportLog = async (): Promise<void> => {
    // весь лог сессии сериализует main (тела на диске), renderer только сохраняет результат
    const content = await window.api.log.exportAs(logExportFormat)
    return exportToFile(`file-switcher-log-${Date.now()}.${logExportFormat}`, content, 'log.exportSuccess')
  }

  const handleExportRules = (): Promise<void> =>
    exportToFile('file-switcher-rules.json', JSON.stringify(rules, null, 2), 'rules.exportSuccess')

  const handleRefreshRules = async (): Promise<void> => {
    setRefreshingRules(true)
    try {
      await onRulesRefresh()
      message.success(t('rules.refreshSuccess'))
    } finally {
      setRefreshingRules(false)
    }
  }

  const handleImportRules = async (): Promise<void> => {
    const content = await window.api.dialog.openTextFile(['json'])
    if (!content) return
    try {
      const parsed = JSON.parse(content)
      if (!isRuleArray(parsed)) {
        message.error(t('rules.importInvalidFormat'))
        return
      }
      onRulesImport(parsed)
      message.success(t('rules.importSuccess', { count: parsed.length }))
    } catch {
      message.error(t('rules.importInvalidFormat'))
    }
  }

  return (
    <Flex vertical style={{ minHeight: '100%' }}>
      <Space orientation="vertical" size="large" style={{ width: '100%' }}>
        {status.error && <Alert type="error" title={t('settings.error')} description={status.error} />}

        <SettingsGroup title={t('settings.groupAppearance')} first>
          <Space.Compact block>
            <Select<SupportedLanguage>
              style={{ width: '50%' }}
              value={language}
              onChange={onLanguageChange}
              options={[
                { label: 'Русский', value: 'ru' },
                { label: 'English', value: 'en' }
              ]}
            />
            <Select<ThemeMode>
              style={{ width: '50%' }}
              value={themeMode}
              onChange={onThemeModeChange}
              options={[
                { label: t('settings.themeLight'), value: 'light' },
                { label: t('settings.themeDark'), value: 'dark' }
              ]}
            />
          </Space.Compact>

          <Slider
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            step={1}
            value={fontSize}
            onChange={onFontSizeChange}
            marks={{ [FONT_SIZE_MIN]: FONT_SIZE_MIN, [FONT_SIZE_MAX]: FONT_SIZE_MAX }}
            tooltip={{ formatter: (value) => `${value}px` }}
          />

          <SectionHeader title={t('settings.splitterSizeLabel')} hint={t('settings.splitterSizeHint')}>
            <Slider
              min={SPLITTER_SIZE_MIN}
              max={SPLITTER_SIZE_MAX}
              step={1}
              value={splitterSize}
              onChange={onSplitterSizeChange}
              marks={{ [SPLITTER_SIZE_MIN]: `${SPLITTER_SIZE_MIN}%`, [SPLITTER_SIZE_MAX]: `${SPLITTER_SIZE_MAX}%` }}
              tooltip={{ formatter: (value) => `${value}%` }}
            />
          </SectionHeader>
        </SettingsGroup>

        <SettingsGroup title={t('settings.groupNetwork')}>
          <Checkbox checked={autoStart} onChange={(e) => onAutoStartChange(e.target.checked)}>
            {t('settings.autoStartLabel')}
          </Checkbox>

          <Space>
            <InputNumber
              min={1}
              max={65535}
              value={port}
              onChange={(value) => onPortChange(value ?? port)}
              disabled={status.status === 'running' || status.status === 'starting'}
            />
            <Tooltip title={t('settings.portHint')}>
              <QuestionCircleOutlined className="hint-icon" />
            </Tooltip>
          </Space>

          {!sudoersInstalled && (
            <SectionHeader title={t('settings.sudoersAlertTitle')}>
              <Alert
                type="info"
                title={t('settings.sudoersAlertDescription')}
                action={
                  <Button size="small" onClick={handleInstallSudoersRule} loading={installingSudoers}>
                    {t('settings.sudoersInstallButton')}
                  </Button>
                }
              />
            </SectionHeader>
          )}

          <div>
            {certStatus === 'not-generated' && (
              <Alert
                style={{ marginBottom: 8 }}
                type="info"
                title={t('settings.certNotGeneratedAlertTitle')}
                description={t('settings.certNotGeneratedAlertDescription')}
              />
            )}

            <Space>
              {certStatus === 'trusted' ? (
                <Button danger onClick={handleRemoveCert} loading={removing}>
                  {t('settings.removeCertButton')}
                </Button>
              ) : (
                <Button onClick={handleInstallCert} loading={installing} disabled={certStatus === 'not-generated'}>
                  {t('settings.installCertButton')}
                </Button>
              )}
              <Tooltip title={`${t('settings.firefoxWarningTitle')}. ${t('settings.firefoxWarningDescription')}`}>
                <QuestionCircleOutlined className="hint-icon" />
              </Tooltip>
            </Space>
          </div>
        </SettingsGroup>

        <SettingsGroup title={t('settings.groupData')}>
          <SectionHeader title={t('settings.groupDataRules')} hint={t('settings.groupDataRulesHint')}>
            <Flex gap={8}>
              <Button style={{ flex: 1 }} onClick={handleExportRules} disabled={rules.length === 0}>
                {t('rules.exportButton')}
              </Button>
              <Popconfirm title={t('rules.importConfirm')} onConfirm={handleImportRules}>
                <Button style={{ width: '100%', flex: 1 }}>{t('rules.importButton')}</Button>
              </Popconfirm>
              <Button style={{ flex: 1 }} onClick={handleRefreshRules} loading={refreshingRules}>
                {t('rules.refreshButton')}
              </Button>
            </Flex>
          </SectionHeader>

          <SectionHeader title={t('settings.groupDataLog')} hint={t('settings.groupDataLogHint')}>
            <Flex gap={8}>
              <Select<'har' | 'json' | 'csv'>
                value={logExportFormat}
                onChange={setLogExportFormat}
                style={{ flex: 1 }}
                options={[
                  { value: 'har', label: 'HAR' },
                  { value: 'json', label: 'JSON' },
                  { value: 'csv', label: 'CSV' }
                ]}
              />
              <Button style={{ flex: 1 }} onClick={handleExportLog} disabled={logCount === 0}>
                {t('log.exportButton')}
              </Button>
            </Flex>
          </SectionHeader>
        </SettingsGroup>

        <SettingsGroup title={t('settings.groupDeveloper')}>
          <Button onClick={() => window.api.window.toggleDevTools()}>
            {t(devToolsOpened ? 'settings.devToolsCloseButton' : 'settings.devToolsButton')}
          </Button>
        </SettingsGroup>
      </Space>

      <Flex justify="flex-start" style={{ marginTop: 'auto', paddingTop: 16 }}>
        <Popconfirm title={t('settings.resetConfirm')} onConfirm={onResetSettings}>
          <Button danger>{t('settings.resetButton')}</Button>
        </Popconfirm>
      </Flex>
    </Flex>
  )
}
