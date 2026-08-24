import React, { useEffect } from 'react'
import { Button, Form, Input, Modal, Switch } from 'antd'
import { useTranslation } from 'react-i18next'
import type { Rule } from '../../shared/types'

interface RuleFormModalProps {
  open: boolean
  initialValue: Rule | null
  onCancel: () => void
  onSubmit: (rule: Omit<Rule, 'id'> & { id?: string }) => void
}

type FormValues = Omit<Rule, 'id'>

/** Модальная форма добавления/редактирования правила подмены */
export default function RuleFormModal({
  open,
  initialValue,
  onCancel,
  onSubmit
}: RuleFormModalProps): React.ReactElement {
  const { t } = useTranslation()
  const [form] = Form.useForm<FormValues>()

  useEffect(() => {
    if (open) {
      form.setFieldsValue(
        initialValue ?? {
          enabled: true,
          urlPattern: '',
          isRegex: true,
          localFilePath: '',
          contentType: ''
        }
      )
    }
  }, [open, initialValue, form])

  const handleSelectFile = async (): Promise<void> => {
    const path = await window.api.dialog.selectFile()
    if (path) {
      form.setFieldsValue({ localFilePath: path })
    }
  }

  const handleOk = async (): Promise<void> => {
    const values = await form.validateFields()
    onSubmit({ ...values, id: initialValue?.id })
  }

  return (
    <Modal
      title={initialValue ? t('rules.form.titleEdit') : t('rules.form.titleNew')}
      open={open}
      onCancel={onCancel}
      onOk={handleOk}
      okText={t('rules.form.save')}
      cancelText={t('rules.form.cancel')}
      destroyOnClose
    >
      <Form<FormValues> form={form} layout="vertical">
        <Form.Item name="enabled" label={t('rules.form.enabled')} valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item
          name="urlPattern"
          label={t('rules.form.urlPattern')}
          rules={[{ required: true, message: t('rules.form.urlPatternRequired') }]}
        >
          <Input placeholder={t('rules.form.urlPatternPlaceholder')} />
        </Form.Item>
        <Form.Item name="isRegex" label={t('rules.form.isRegex')} valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item
          name="localFilePath"
          label={t('rules.form.localFile')}
          extra={t('rules.form.localFileHint')}
          rules={[{ required: true, message: t('rules.form.localFileRequired') }]}
        >
          <Input
            placeholder={t('rules.form.localFilePlaceholder')}
            addonAfter={
              <Button type="link" size="small" onClick={handleSelectFile} style={{ padding: 0 }}>
                {t('rules.form.selectFile')}
              </Button>
            }
          />
        </Form.Item>
        <Form.Item name="contentType" label={t('rules.form.contentType')}>
          <Input placeholder={t('rules.form.contentTypePlaceholder')} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
