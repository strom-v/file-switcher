import React, { useEffect, useState } from 'react'
import { Alert, Button, Descriptions, InputNumber, List, Space, Tag, Tooltip, Typography, message } from 'antd'
import { QuestionCircleOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import type { ProxyState, CertStatus, CertInfo } from '../../shared/types'

interface SettingsPanelProps {
  status: ProxyState
  port: number
  onPortChange: (port: number) => void
}

/** Панель настроек: порт, статус прокси и сертификата, установка CA */
export default function SettingsPanel({ status, port, onPortChange }: SettingsPanelProps): React.ReactElement {
  const { t } = useTranslation()
  const [certStatus, setCertStatus] = useState<CertStatus>('not-generated')
  const [certs, setCerts] = useState<CertInfo[]>([])
  const [installing, setInstalling] = useState(false)
  const [removing, setRemoving] = useState(false)

  const refreshCertStatus = async (): Promise<void> => {
    const [next, list] = await Promise.all([window.api.cert.status(), window.api.cert.list()])
    setCertStatus(next)
    setCerts(list)
  }

  useEffect(() => {
    refreshCertStatus()
  }, [status.status])

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

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      {status.error && <Alert type="error" message={t('settings.error')} description={status.error} />}

      <Space>
        <Typography.Text>{t('settings.portLabel')}</Typography.Text>
        <InputNumber
          min={1}
          max={65535}
          value={port}
          onChange={(value) => onPortChange(value ?? port)}
          disabled={status.status === 'running' || status.status === 'starting'}
        />
      </Space>

      <div>
        <Space style={{ marginBottom: 8 }}>
          <Typography.Text strong>{t('settings.certTitle')}</Typography.Text>
          <Tooltip title={t('settings.certListHint')}>
            <QuestionCircleOutlined className="hint-icon" />
          </Tooltip>
        </Space>

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
      </div>

      {certStatus === 'not-generated' && (
        <Alert
          type="info"
          message={t('settings.certNotGeneratedAlertTitle')}
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
    </Space>
  )
}
