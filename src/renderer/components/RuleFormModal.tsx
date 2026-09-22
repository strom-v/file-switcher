import React, { useEffect, useState } from 'react'
import {
  AutoComplete,
  Button,
  Flex,
  Form,
  Input,
  message,
  Modal,
  Popconfirm,
  Segmented,
  Tooltip,
  Typography
} from 'antd'
import { CopyOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import JsonTree from './JsonTree'
import { tryParseJson } from '../formatters'
import { COLOR_DANGER, COLOR_INFO, COLOR_SUCCESS, COLOR_WARNING } from '../theme'
import type { Rule } from '../../shared/types'

interface RuleFormModalProps {
  open: boolean
  // без id — черновик для создания (в т.ч. дубликат существующего правила без сохранённого id)
  initialValue: Rule | Omit<Rule, 'id'> | null
  /** непустые группы из существующих правил — подсказки для поля "группа" */
  knownGroups: string[]
  onCancel: () => void
  onSubmit: (rule: Omit<Rule, 'id'> & { id?: string }) => void
  onDelete: (rule: Rule) => void
  onDuplicate: (rule: Rule) => void
}

interface FormValues {
  urlPattern: string
  group: string
  localFilePath: string
  responseBody: string
}

/** Просмотр тела ответа сворачиваемым JSON-деревом; для невалидного JSON — пояснение вместо дерева */
function ResponseBodyTree({ body }: { body: string }): React.ReactElement {
  const { t } = useTranslation()
  const parsed = tryParseJson(body)
  return (
    <div className="headers-panel headers-panel--tall">
      {parsed.ok ? (
        <JsonTree value={parsed.value} defaultExpandDepth={2} />
      ) : (
        <Typography.Text type="secondary" className="text-sm">
          {t('rules.form.bodyTreeNotJson')}
        </Typography.Text>
      )}
    </div>
  )
}

/** Модальная форма добавления/редактирования правила подмены: URL-паттерн, группа и способ подмены —
 * локальный файл ИЛИ инлайн-тело ответа. Вид подмены не выбирается вручную: при сохранении берётся
 * тот, чьё поле заполнено (тело важнее файла, если заполнены оба). Остальные поля правила
 * (enabled/isRegex/заголовки и т.д.) через эту форму не редактируются. */
export default function RuleFormModal({
  open,
  initialValue,
  knownGroups,
  onCancel,
  onSubmit,
  onDelete,
  onDuplicate
}: RuleFormModalProps): React.ReactElement {
  const { t } = useTranslation()
  const [form] = Form.useForm<FormValues>()
  // просмотр тела ответа: редактируемый текст либо сворачиваемое JSON-дерево
  const [bodyAsTree, setBodyAsTree] = useState(false)

  const initialFormValues: FormValues = {
    urlPattern: initialValue?.urlPattern ?? '',
    group: initialValue?.group ?? '',
    localFilePath: initialValue?.localFilePath ?? '',
    responseBody: initialValue?.responseBody ?? ''
  }
  const currentValues = Form.useWatch([], form)

  useEffect(() => {
    if (open) {
      form.setFieldsValue(initialFormValues)
      setBodyAsTree(false)
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
        currentValues.group === initialFormValues.group &&
        currentValues.localFilePath === initialFormValues.localFilePath &&
        currentValues.responseBody === initialFormValues.responseBody))
  const isUrlPatternEmpty = !currentValues?.urlPattern?.trim()

  const handleOk = async (): Promise<void> => {
    let values: FormValues
    try {
      values = await form.validateFields()
    } catch {
      // валидация не прошла — antd уже подсветил поля; без catch rejection улетал бы в консоль
      return
    }
    // вид подмены вычисляется автоматически: непустое тело важнее файла; при пустом теле —
    // подмена файлом. Поле неактивного вида сохраняем пустым, чтобы вид оставался однозначным.
    // contentType не редактируется — переносится как есть (для правил из лога это тип исходного
    // ответа; для правил, созданных вручную, его нет, и addon.py ставит application/json)
    const hasBody = !!values.responseBody?.trim()
    const swapFields = hasBody
      ? { responseBody: values.responseBody, localFilePath: undefined }
      : { localFilePath: values.localFilePath, responseBody: undefined, contentType: undefined }
    onSubmit({
      ...(initialValue ?? { enabled: true, isRegex: true }),
      urlPattern: values.urlPattern,
      group: values.group?.trim() || '',
      ...swapFields,
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

        <Form.Item name="group" label={t('rules.form.group')}>
          <AutoComplete
            allowClear
            placeholder={t('rules.form.groupPlaceholder')}
            options={knownGroups.map((g) => ({ value: g }))}
            filterOption={(input, option) => (option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
          />
        </Form.Item>

        <Form.Item name="localFilePath" label={t('rules.form.localFile')} extra={t('rules.form.swapKindHint')}>
          <Input
            placeholder={t('rules.form.localFilePlaceholder')}
            suffix={
              <Tooltip title={t('rules.form.copyButton')}>
                <CopyOutlined onClick={() => handleCopy(currentValues?.localFilePath)} style={{ cursor: 'pointer' }} />
              </Tooltip>
            }
          />
        </Form.Item>

        <div>
          <Flex justify="space-between" align="center">
            <span>{t('rules.form.responseBody')}</span>
            <Segmented<boolean>
              size="small"
              value={bodyAsTree}
              onChange={setBodyAsTree}
              options={[
                { label: t('rules.form.bodyViewText'), value: false },
                { label: t('rules.form.bodyViewTree'), value: true }
              ]}
            />
          </Flex>
          <Form.Item name="responseBody" hidden={bodyAsTree} style={{ marginBottom: bodyAsTree ? 0 : undefined }}>
            <Input.TextArea
              rows={10}
              placeholder={t('rules.form.responseBodyPlaceholder')}
              style={{ fontFamily: 'monospace' }}
            />
          </Form.Item>
          {bodyAsTree && <ResponseBodyTree body={currentValues?.responseBody ?? ''} />}
        </div>
      </Form>
    </Modal>
  )
}
