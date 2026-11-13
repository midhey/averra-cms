import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { messageOf } from '../errors'
import { changeMailTemplate, type EditableMailTemplate, mailTemplatesQuery } from '../queries'
import { Button } from '../ui/Button'
import { cardClassName } from '../ui/Card'
import { InlineAlert } from '../ui/InlineAlert'
import { Section } from '../ui/Screen'
import { MailTemplateEditor } from './MailTemplateEditor'
import styles from './MailTemplateEditor.module.scss'

export function MailTemplatesSection({ siteId }: { siteId?: string }) {
  const query = useQuery(mailTemplatesQuery(siteId))
  return (
    <Section
      title={siteId ? 'Письма' : 'Шаблоны писем'}
      description="Тема, строка в списке писем и текст с подстановками. Предпросмотр — на примерных данных."
    >
      {query.isError ? (
        <InlineAlert tone="danger">
          {messageOf(query.error)} <Button onClick={() => void query.refetch()}>Повторить</Button>
        </InlineAlert>
      ) : (
        query.data?.map((template) => (
          <TemplateCard key={template.id} template={template} siteId={siteId} />
        ))
      )}
    </Section>
  )
}

function TemplateCard({
  template,
  siteId,
}: {
  template: EditableMailTemplate
  siteId: string | undefined
}) {
  const headingId = useId()
  const client = useQueryClient()
  const [fresh, setFresh] = useState<EditableMailTemplate>()
  const [error, setError] = useState<string>()
  async function load() {
    if (fresh) return
    try {
      const rows = await client.fetchQuery(mailTemplatesQuery(siteId))
      setFresh(rows.find((row) => row.id === template.id))
      setError(undefined)
    } catch (error) {
      setError(messageOf(error))
    }
  }
  return (
    <article className={cardClassName()} aria-labelledby={headingId}>
      <h3 id={headingId}>{template.title}</h3>
      <p>{template.description}</p>
      <details
        onToggle={(event) => {
          if (event.currentTarget.open) void load()
        }}
      >
        <summary className={styles.summary}>Редактировать письмо «{template.title}»</summary>
        {error ? (
          <InlineAlert tone="danger">
            {error} <Button onClick={() => void load()}>Повторить</Button>
          </InlineAlert>
        ) : fresh ? (
          <MailTemplateEditor
            template={fresh}
            onAction={async (action, text) => {
              const result = await changeMailTemplate(siteId, template.id, action, text)
              if (action !== 'preview') {
                await client.invalidateQueries({ queryKey: mailTemplatesQuery(siteId).queryKey })
                await client.invalidateQueries({ queryKey: ['mail', 'templates'] })
              }
              return result
            }}
          />
        ) : (
          <p role="status">Загружаю текст…</p>
        )}
      </details>
    </article>
  )
}
