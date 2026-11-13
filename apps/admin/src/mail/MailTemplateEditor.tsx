import type { MailTemplateText } from '@averra/schema'
import { useRef, useState } from 'react'
import { type ApiIssue, ApiRequestError, messageOf } from '../errors'
import { formatDateTime } from '../pages-format'
import type { changeMailTemplate, EditableMailTemplate } from '../queries'
import { useReportUnsaved } from '../seo/unsaved'
import { Button } from '../ui/Button'
import { useConfirm } from '../ui/Confirm'
import { TextArea, TextInput } from '../ui/Field'
import { InlineAlert } from '../ui/InlineAlert'
import styles from './MailTemplateEditor.module.scss'

type Action = Parameters<typeof changeMailTemplate>[2]
type Preview = { subject: string; html: string; text: string }

export function MailTemplateEditor({
  template,
  onAction,
}: {
  template: EditableMailTemplate
  onAction: (action: Action, text: MailTemplateText) => Promise<Preview | null>
}) {
  const [state, setState] = useState(template)
  const [text, setText] = useState<MailTemplateText>(
    template.draft ?? template.published ?? template.defaultText,
  )
  const [baseline, setBaseline] = useState(text)
  const [preview, setPreview] = useState<Preview>()
  const [issues, setIssues] = useState<readonly ApiIssue[]>([])
  const [notice, setNotice] = useState<{ error: boolean; text: string }>()
  const [pending, setPending] = useState<Action>()
  const body = useRef<HTMLTextAreaElement>(null)
  const confirm = useConfirm()
  useReportUnsaved(JSON.stringify(text) !== JSON.stringify(baseline))

  async function run(action: Action) {
    if (pending) return
    if (
      action === 'reset' &&
      (state.draft || state.published) &&
      !(await confirm({
        title: 'Вернуть стандартный текст?',
        description: 'Свой текст и черновик будут удалены.',
        confirmLabel: 'Вернуть стандартный текст',
      }))
    )
      return
    setPending(action)
    setNotice(undefined)
    setIssues([])
    try {
      const result = await onAction(action, text)
      if (action === 'preview' && result) setPreview(result)
      else {
        const next =
          action === 'reset'
            ? state.defaultText
            : action === 'discard'
              ? (state.published ?? state.defaultText)
              : text
        setText(next)
        setBaseline(next)
        setPreview(undefined)
        setState({
          ...state,
          draft: action === 'draft' ? next : null,
          draftUpdatedBy: action === 'draft' ? 'вы' : null,
          draftUpdatedAt: action === 'draft' ? new Date().toISOString() : null,
          published: action === 'publish' ? next : action === 'reset' ? null : state.published,
          publishedBy: action === 'publish' ? 'вы' : state.publishedBy,
          publishedAt: action === 'publish' ? new Date().toISOString() : state.publishedAt,
        })
        setNotice({
          error: false,
          text:
            action === 'draft'
              ? 'Черновик сохранён'
              : action === 'publish'
                ? 'Текст опубликован'
                : action === 'discard'
                  ? 'Черновик отменён'
                  : 'Возвращён стандартный текст',
        })
      }
    } catch (error) {
      if (error instanceof ApiRequestError) setIssues(error.issues)
      setNotice({ error: true, text: messageOf(error) })
    } finally {
      setPending(undefined)
    }
  }

  function insert(name: string, block: boolean) {
    const area = body.current
    const start = area?.selectionStart ?? text.body.length
    const end = area?.selectionEnd ?? start
    const insertion = `${block && start > 0 ? '\n\n' : ''}{${name}}${block ? '\n\n' : ''}`
    setText({ ...text, body: text.body.slice(0, start) + insertion + text.body.slice(end) })
    requestAnimationFrame(() => {
      area?.focus()
      area?.setSelectionRange(start + insertion.length, start + insertion.length)
    })
  }
  const error = (field: string) =>
    issues
      .filter((issue) => issue.path === field)
      .map((issue) => issue.message)
      .join('. ') || undefined

  return (
    <div className={styles.editor}>
      {state.draftUpdatedBy?.startsWith('токен «') ? (
        <InlineAlert tone="warning" title={`Черновик от ИИ: ${state.draftUpdatedBy}`}>
          Проверьте и опубликуйте
          {state.draftUpdatedAt ? ` · ${formatDateTime(state.draftUpdatedAt)}` : ''}.
        </InlineAlert>
      ) : (
        state.draft && (
          <p>
            Черновик: {state.draftUpdatedBy}
            {state.draftUpdatedAt && ` · ${formatDateTime(state.draftUpdatedAt)}`}
          </p>
        )
      )}
      {state.published && (
        <p>
          Опубликовано: {state.publishedBy}
          {state.publishedAt && ` · ${formatDateTime(state.publishedAt)}`}
        </p>
      )}
      <TextInput
        disabled={!!pending}
        label="Тема"
        value={text.subject}
        maxChars={200}
        error={error('subject')}
        onChange={(event) => setText({ ...text, subject: event.target.value })}
      />
      <TextInput
        disabled={!!pending}
        label="Строка в списке писем"
        value={text.preheader}
        maxChars={200}
        error={error('preheader')}
        onChange={(event) => setText({ ...text, preheader: event.target.value })}
      />
      <TextArea
        ref={body}
        disabled={!!pending}
        label="Текст письма"
        value={text.body}
        rows={12}
        maxChars={5000}
        error={error('body')}
        hint="Пустая строка разделяет абзацы. > в начале абзаца — пояснение мелким текстом. Блок вставляется отдельным абзацем. HTML отображается как текст."
        onChange={(event) => setText({ ...text, body: event.target.value })}
      />
      <fieldset className={styles.insertions}>
        <legend>Подстановки и блоки</legend>
        {template.vars.map(({ name, label }) => (
          <Button key={name} disabled={!!pending} size="small" onClick={() => insert(name, false)}>
            Вставить {`{${name}}`} — {label}
          </Button>
        ))}
        {template.blocks.map(({ name, label, required }) => (
          <Button key={name} disabled={!!pending} size="small" onClick={() => insert(name, true)}>
            Вставить {`{${name}}`} — {label}
            {required ? ' (обязательный)' : ''}
          </Button>
        ))}
      </fieldset>
      <div className={styles.actions}>
        <Button disabled={!!pending} onClick={() => void run('preview')}>
          Обновить предпросмотр
        </Button>
        <Button disabled={!!pending} onClick={() => void run('draft')}>
          Сохранить черновик
        </Button>
        <Button variant="primary" disabled={!!pending} onClick={() => void run('publish')}>
          Опубликовать
        </Button>
        {state.draft && (
          <Button disabled={!!pending} onClick={() => void run('discard')}>
            Отменить черновик
          </Button>
        )}
        {(state.published || state.draft) && (
          <Button disabled={!!pending} onClick={() => void run('reset')}>
            Вернуть стандартный текст
          </Button>
        )}
      </div>
      {pending && (
        <p role="status">{pending === 'preview' ? 'Собираю предпросмотр…' : 'Сохраняю…'}</p>
      )}
      {notice && (
        <InlineAlert tone={notice.error ? 'danger' : 'success'} live>
          {notice.text}
        </InlineAlert>
      )}
      {preview && (
        <>
          <p>Тема: {preview.subject}</p>
          <iframe
            className={styles.frame}
            title={`Предпросмотр письма «${template.title}»`}
            sandbox=""
            srcDoc={preview.html}
          />
          <details>
            <summary>Текстовая версия</summary>
            <pre className={styles.text}>{preview.text}</pre>
          </details>
        </>
      )}
    </div>
  )
}
