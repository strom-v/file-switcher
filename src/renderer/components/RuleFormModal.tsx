import React, { useEffect } from 'react'
import { Button, Flex, Form, Input, message, Modal, Popconfirm, Tooltip } from 'antd'
import { CopyOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { COLOR_DANGER, COLOR_INFO, COLOR_SUCCESS, COLOR_WARNING } from '../theme'
import type { Rule } from '../../shared/types'

interface RuleFormModalProps {
  open: boolean
  // без id — черновик для создания (в т.ч. дубликат существующего правила без сохранённого id)
  initialValue: Rule | Omit<Rule, 'id'> | null
  onCancel: () => void
  onSubmit: (rule: Omit<Rule, 'id'> & { id?: string }) => void
  onDelete: (rule: Rule) => void
  onDuplicate: (rule: Rule) => void
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
  onDelete,
  onDuplicate
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

  // существующее правило (редактирование) имеет id; черновик создания — и новый, и дубликат
  // существующего правила без сохранённого id — его не имеет
  const existingRule = initialValue && 'id' in initialValue ? initialValue : null

  // блокировка "нечего сохранять" осмысленна только при редактировании существующего правила —
  // черновик создания (в т.ч. дубликат) можно сохранить сразу, даже если поля ещё не тронуты
  const isUnchanged =
    !!existingRule &&
    (!currentValues ||
      (currentValues.urlPattern === initialFormValues.urlPattern &&
        currentValues.localFilePath === initialFormValues.localFilePath))
  const isUrlPatternEmpty = !currentValues?.urlPattern?.trim()

  const handleOk = async (): Promise<void> => {
    const values = await form.validateFields()
    onSubmit({
      ...(initialValue ?? { enabled: true, isRegex: true }),
      ...values,
      id: existingRule?.id
    })
  }

  const handleDelete = (): void => {
    if (existingRule) onDelete(existingRule)
  }

  const handleCopy = async (value: string | undefined): Promise<void> => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      message.success(t('rules.form.copied'))
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleDuplicate = (): void => {
    if (existingRule) onDuplicate(existingRule)
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
          {existingRule ? (
            <Flex gap={8}>
              <Popconfirm title={t('rules.table.deleteConfirm')} onConfirm={handleDelete}>
                <Button danger>{t('rules.table.delete')}</Button>
              </Popconfirm>
              <Button onClick={handleDuplicate} style={{ color: COLOR_INFO, borderColor: COLOR_INFO }}>
                {t('rules.table.duplicate')}
              </Button>
            </Flex>
          ) : (
            <span />
          )}
          <Flex gap={8}>
            <Button onClick={onCancel} style={{ color: COLOR_WARNING, borderColor: COLOR_WARNING }}>
              {t('rules.form.cancel')}
            </Button>
            <Button
              onClick={handleOk}
              disabled={isUnchanged || isUrlPatternEmpty}
              style={
                isUnchanged || isUrlPatternEmpty ? undefined : { color: COLOR_SUCCESS, borderColor: COLOR_SUCCESS }
              }
            >
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
          <Input
            placeholder={t('rules.form.urlPatternPlaceholder')}
            suffix={
              <Tooltip title={t('rules.form.copyButton')}>
                <CopyOutlined onClick={() => handleCopy(currentValues?.urlPattern)} style={{ cursor: 'pointer' }} />
              </Tooltip>
            }
          />
        </Form.Item>
        <Form.Item name="localFilePath" label={t('rules.form.localFile')}>
          <Input
            placeholder={t('rules.form.localFilePlaceholder')}
            suffix={
              <Tooltip title={t('rules.form.copyButton')}>
                <CopyOutlined onClick={() => handleCopy(currentValues?.localFilePath)} style={{ cursor: 'pointer' }} />
              </Tooltip>
            }
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
