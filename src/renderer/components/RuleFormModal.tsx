import React, { useEffect } from 'react'
import { Button, Collapse, Flex, Form, Input, InputNumber, Modal, Space, Switch } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import type { HeaderOverride, Rule } from '../../shared/types'

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
          contentType: '',
          requestHeaderOverrides: [],
          responseHeaderOverrides: [],
          delayMs: undefined,
          statusCodeOverride: undefined
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
      centered
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
        <Form.Item name="localFilePath" label={t('rules.form.localFile')} extra={t('rules.form.localFileHint')}>
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

        <Collapse
          size="small"
          items={[
            {
              key: 'advanced',
              label: t('rules.form.advancedSection'),
              children: (
                <>
                  <Form.Item name="statusCodeOverride" label={t('rules.form.statusCodeOverride')}>
                    <InputNumber
                      min={100}
                      max={599}
                      placeholder={t('rules.form.statusCodeOverridePlaceholder')}
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                  <Form.Item name="delayMs" label={t('rules.form.delayMs')}>
                    <InputNumber min={0} step={100} style={{ width: '100%' }} />
                  </Form.Item>
                  <HeaderOverridesField name="requestHeaderOverrides" label={t('rules.form.requestHeaders')} />
                  <HeaderOverridesField name="responseHeaderOverrides" label={t('rules.form.responseHeaders')} />
                </>
              )
            }
          ]}
        />
      </Form>
    </Modal>
  )
}

interface HeaderOverridesFieldProps {
  name: 'requestHeaderOverrides' | 'responseHeaderOverrides'
  label: string
}

/** Динамический список пар имя/значение заголовков; пустое значение при сохранении означает "удалить заголовок" */
function HeaderOverridesField({ name, label }: HeaderOverridesFieldProps): React.ReactElement {
  const { t } = useTranslation()

  return (
    <Form.Item label={label}>
      <Form.List name={name}>
        {(fields, { add, remove }) => (
          <Space direction="vertical" style={{ width: '100%' }}>
            {fields.map((field) => (
              <Flex key={field.key} gap={8}>
                <Form.Item name={[field.name, 'name']} noStyle>
                  <Input placeholder={t('rules.form.headerName')} style={{ flex: 1 }} />
                </Form.Item>
                <Form.Item name={[field.name, 'value']} noStyle>
                  <Input placeholder={t('rules.form.headerValueHint')} style={{ flex: 1 }} />
                </Form.Item>
                <Button icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
              </Flex>
            ))}
            <Button
              type="dashed"
              icon={<PlusOutlined />}
              onClick={() => add({ name: '', value: '' } satisfies HeaderOverride)}
              block
            >
              {t('rules.form.addHeader')}
            </Button>
          </Space>
        )}
      </Form.List>
    </Form.Item>
  )
}
