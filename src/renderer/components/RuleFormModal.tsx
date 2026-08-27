import React, { useEffect } from 'react'
import { Button, Flex, Form, Input, Modal, Popconfirm } from 'antd'
import { useTranslation } from 'react-i18next'
import { COLOR_DANGER } from '../theme'
import type { Rule } from '../../shared/types'

interface RuleFormModalProps {
  open: boolean
  initialValue: Rule | null
  onCancel: () => void
  onSubmit: (rule: Omit<Rule, 'id'> & { id?: string }) => void
  onDelete: (rule: Rule) => void
}

interface FormValues {
  urlPattern: string
  localFilePath: string
}

/** Модальная форма добавления/редактирования правила подмены: только URL-паттерн и локальный путь.
 * Остальные поля правила (enabled/isRegex/заголовки и т.д.) через эту форму не редактируются —
 * при создании берутся дефолтные значения, при редактировании сохраняются как есть. */
export default function RuleFormModal({
  open,
  initialValue,
  onCancel,
  onSubmit,
  onDelete
}: RuleFormModalProps): React.ReactElement {
  const { t } = useTranslation()
  const [form] = Form.useForm<FormValues>()
  const initialFormValues: FormValues = {
    urlPattern: initialValue?.urlPattern ?? '',
    localFilePath: initialValue?.localFilePath ?? ''
  }
  const currentValues = Form.useWatch([], form)

  useEffect(() => {
    if (open) {
      form.setFieldsValue(initialFormValues)
    }
    // initialFormValues пересоздаётся на каждый рендер, поэтому не в deps — эффект должен
    // сработать только при открытии/смене редактируемого правила, не на каждое изменение поля
  }, [open, initialValue, form])

  const isUnchanged =
    !currentValues ||
    (currentValues.urlPattern === initialFormValues.urlPattern &&
      currentValues.localFilePath === initialFormValues.localFilePath)
  const isUrlPatternEmpty = !currentValues?.urlPattern?.trim()

  const handleOk = async (): Promise<void> => {
    const values = await form.validateFields()
    onSubmit({
      ...(initialValue ?? { enabled: true, isRegex: true }),
      ...values,
      id: initialValue?.id
    })
  }

  const handleDelete = (): void => {
    if (initialValue) onDelete(initialValue)
  }

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      closeIcon={false}
      destroyOnHidden
      centered
      footer={
        <Flex justify="space-between">
          {initialValue ? (
            <Popconfirm title={t('rules.table.deleteConfirm')} onConfirm={handleDelete}>
              <Button danger>{t('rules.table.delete')}</Button>
            </Popconfirm>
          ) : (
            <span />
          )}
          <Flex gap={8}>
            <Button onClick={onCancel}>{t('rules.form.cancel')}</Button>
            <Button type="primary" onClick={handleOk} disabled={isUnchanged || isUrlPatternEmpty}>
              {t('rules.form.save')}
            </Button>
          </Flex>
        </Flex>
      }
    >
      <Form<FormValues>
        form={form}
        layout="vertical"
        requiredMark={(label, { required }) => (
          <>
            {label}
            {required && <span style={{ color: COLOR_DANGER }}> *</span>}
          </>
        )}
      >
        <Form.Item
          name="urlPattern"
          label={t('rules.form.urlPattern')}
          rules={[{ required: true, message: t('rules.form.urlPatternRequired') }]}
        >
          <Input placeholder={t('rules.form.urlPatternPlaceholder')} />
        </Form.Item>
        <Form.Item name="localFilePath" label={t('rules.form.localFile')}>
          <Input placeholder={t('rules.form.localFilePlaceholder')} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
