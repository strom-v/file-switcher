import React from 'react'
import { Modal, Steps, Typography } from 'antd'
import { useTranslation } from 'react-i18next'

const ONBOARDING_SHOWN_KEY = 'file-switcher:onboarding-shown'

interface OnboardingModalProps {
  open: boolean
  onClose: () => void
}

/** Модалка первого запуска: как включить прокси и довериться сертификату */
export default function OnboardingModal({ open, onClose }: OnboardingModalProps): React.ReactElement {
  const { t } = useTranslation()

  return (
    <Modal
      title={t('onboarding.title')}
      open={open}
      onOk={onClose}
      onCancel={onClose}
      okText={t('onboarding.ok')}
      centered
    >
      <Typography.Paragraph>{t('onboarding.intro')}</Typography.Paragraph>
      <Steps
        direction="vertical"
        size="small"
        items={[
          { title: t('onboarding.steps.addRule.title'), description: t('onboarding.steps.addRule.description') },
          { title: t('onboarding.steps.startProxy.title'), description: t('onboarding.steps.startProxy.description') },
          { title: t('onboarding.steps.openMitm.title'), description: t('onboarding.steps.openMitm.description') },
          {
            title: t('onboarding.steps.downloadCert.title'),
            description: t('onboarding.steps.downloadCert.description')
          },
          { title: t('onboarding.steps.trustCert.title'), description: t('onboarding.steps.trustCert.description') }
        ]}
      />
    </Modal>
  )
}

export function hasSeenOnboarding(): boolean {
  return localStorage.getItem(ONBOARDING_SHOWN_KEY) === 'true'
}

export function markOnboardingSeen(): void {
  localStorage.setItem(ONBOARDING_SHOWN_KEY, 'true')
}
