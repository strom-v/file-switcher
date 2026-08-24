import React, { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Descriptions,
  InputNumber,
  List,
  Popconfirm,
  Segmented,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
  message
} from 'antd'
import { QuestionCircleOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import SectionHeader from './SectionHeader'
import { buildHar } from '../harExport'
import type { ThemeMode } from '../hooks/useThemeMode'
import type { SupportedLanguage } from '../i18n'
import type { CertInfo, CertStatus, ProxyLogEvent, ProxyState, Rule, VpnService } from '../../shared/types'

interface SettingsPanelProps {
  status: ProxyState
  port: number
  onPortChange: (port: number) => void
  logs: ProxyLogEvent[]
  rules: Rule[]
  onRulesImport: (rules: Rule[]) => void
  language: SupportedLanguage
  onLanguageChange: (language: SupportedLanguage) => void
  themeMode: ThemeMode
  onThemeModeChange: (mode: ThemeMode) => void
}

/** Проверяет, что распарсенный JSON похож на массив Rule — минимально, без строгой валидации формы каждого поля */
function isRuleArray(value: unknown): value is Rule[] {
  return (
    Array.isArray(value) &&
    value.every((item) => item && typeof item === 'object' && 'urlPattern' in item && 'id' in item)
  )
}

/** Панель настроек: язык/тема, порт, статус сертификата, VPN-исключения, экспорт лога и правил */
export default function SettingsPanel({
  status,
  port,
  onPortChange,
  logs,
  rules,
  onRulesImport,
  language,
  onLanguageChange,
  themeMode,
  onThemeModeChange
}: SettingsPanelProps): React.ReactElement {
  const { t } = useTranslation()
  const [certStatus, setCertStatus] = useState<CertStatus>('not-generated')
  const [certs, setCerts] = useState<CertInfo[]>([])
  const [installing, setInstalling] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [vpnServices, setVpnServices] = useState<VpnService[]>([])
  const [sudoersInstalled, setSudoersInstalled] = useState(true)
  const [installingSudoers, setInstallingSudoers] = useState(false)

  const refreshCertStatus = async (): Promise<void> => {
    const [next, list] = await Promise.all([window.api.cert.status(), window.api.cert.list()])
    setCertStatus(next)
    setCerts(list)
  }

  const refreshVpnServices = async (): Promise<void> => {
    setVpnServices(await window.api.system.vpnServices())
  }

  useEffect(() => {
    refreshCertStatus()
    refreshVpnServices()
    window.api.system.sudoersInstalled().then(setSudoersInstalled)
  }, [status.status])

  const handleToggleVpnAllowed = async (name: string, allowed: boolean): Promise<void> => {
    await window.api.system.setVpnServiceAllowed(name, allowed)
    await refreshVpnServices()
  }

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

  const handleExportHar = (): Promise<void> =>
    exportToFile(`file-switcher-log-${Date.now()}.har`, buildHar(logs), 'log.exportSuccess')

  const handleExportRules = (): Promise<void> =>
    exportToFile('file-switcher-rules.json', JSON.stringify(rules, null, 2), 'rules.exportSuccess')

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
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      {status.error && <Alert type="error" message={t('settings.error')} description={status.error} />}

      <SectionHeader title={t('settings.appearanceTitle')}>
        <Space size="large">
          <Segmented
            value={language}
            onChange={(value) => onLanguageChange(value as SupportedLanguage)}
            options={[
              { label: 'Русский', value: 'ru' },
              { label: 'English', value: 'en' }
            ]}
          />
          <Segmented
            value={themeMode}
            onChange={(value) => onThemeModeChange(value as ThemeMode)}
            options={[
              { label: t('settings.themeLight'), value: 'light' },
              { label: t('settings.themeDark'), value: 'dark' }
            ]}
          />
        </Space>
      </SectionHeader>

      <SectionHeader title={t('settings.portLabel')}>
        <InputNumber
          min={1}
          max={65535}
          value={port}
          onChange={(value) => onPortChange(value ?? port)}
          disabled={status.status === 'running' || status.status === 'starting'}
        />
      </SectionHeader>

      {!sudoersInstalled && (
        <Alert
          type="info"
          message={t('settings.sudoersAlertTitle')}
          description={t('settings.sudoersAlertDescription')}
          action={
            <Button size="small" onClick={handleInstallSudoersRule} loading={installingSudoers}>
              {t('settings.sudoersInstallButton')}
            </Button>
          }
        />
      )}

      {vpnServices.length > 0 && (
        <SectionHeader title={t('settings.vpnTitle')} hint={t('settings.vpnHint')}>
          <List
            bordered
            size="small"
            dataSource={vpnServices}
            renderItem={(vpn) => (
              <List.Item
                actions={
                  vpn.name
                    ? [
                        <Switch
                          key="allowed"
                          checked={vpn.allowed}
                          onChange={(checked) => handleToggleVpnAllowed(vpn.name as string, checked)}
                        />
                      ]
                    : undefined
                }
              >
                <Space direction="vertical" size={0}>
                  <Typography.Text>{vpn.name ?? t('settings.vpnUnnamed')}</Typography.Text>
                  <Typography.Text type="secondary">
                    {vpn.name
                      ? vpn.allowed
                        ? t('settings.vpnAllowedHint')
                        : t('settings.vpnNotAllowedHint')
                      : t('settings.vpnUnnamedHint')}
                  </Typography.Text>
                </Space>
              </List.Item>
            )}
          />
        </SectionHeader>
      )}

      <SectionHeader title={t('settings.certTitle')} hint={t('settings.certListHint')}>
        {certs.length === 0 ? (
          <Descriptions bordered column={1} size="small">
            <Descriptions.Item label={t('settings.certStatus')}>
              {certStatus === 'not-generated' && t('settings.certNotGenerated')}
              {certStatus !== 'not-generated' && t('settings.certNotTrusted')}
            </Descriptions.Item>
          </Descriptions>
        ) : (
          <List
            bordered
            size="small"
            dataSource={certs}
            renderItem={(cert) => (
              <List.Item>
                <Space direction="vertical" size={0}>
                  <Space>
                    <Typography.Text code copyable={{ text: cert.sha1 }}>
                      {cert.sha1.slice(0, 16)}…
                    </Typography.Text>
                    <Tag color={cert.trusted ? 'success' : 'default'}>
                      {cert.trusted ? t('settings.certTrusted') : t('settings.certNotTrusted')}
                    </Tag>
                  </Space>
                  <Typography.Text type="secondary">
                    {t('settings.certExpiresAt', { date: cert.expiresAt })}
                  </Typography.Text>
                </Space>
              </List.Item>
            )}
          />
        )}

        {certStatus === 'not-generated' && (
          <Alert
            style={{ marginTop: 8 }}
            type="info"
            message={t('settings.certNotGeneratedAlertTitle')}
            description={t('settings.certNotGeneratedAlertDescription')}
          />
        )}

        <Space style={{ marginTop: 8 }}>
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
      </SectionHeader>

      <SectionHeader title={t('settings.rulesExportTitle')} hint={t('settings.rulesExportHint')}>
        <Space>
          <Button onClick={handleExportRules} disabled={rules.length === 0}>
            {t('rules.exportButton')}
          </Button>
          <Popconfirm title={t('rules.importConfirm')} onConfirm={handleImportRules}>
            <Button>{t('rules.importButton')}</Button>
          </Popconfirm>
        </Space>
      </SectionHeader>

      <SectionHeader title={t('settings.exportTitle')} hint={t('settings.exportHint')}>
        <Button onClick={handleExportHar} disabled={logs.length === 0}>
          {t('log.exportHar')}
        </Button>
      </SectionHeader>
    </Space>
  )
}
