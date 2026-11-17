import { NewPreviewLink } from '@averra/schema'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { api } from '../api'
import { ApiRequestError, apiRequestError, messageOf } from '../errors'
import { firstInvalidField, issueFieldErrors, zodFieldErrors } from '../forms/field-errors'
import { focusField, useFormErrors } from '../forms/use-form-errors'
import { previewLinksQuery, queryKeys } from '../queries'
import { Button } from '../ui/Button'
import { useConfirm } from '../ui/Confirm'
import { Dialog } from '../ui/Dialog'
import { Select, TextInput } from '../ui/Field'
import { InlineAlert } from '../ui/InlineAlert'
import { formClassName, Section } from '../ui/Screen'

export function PreviewLinks({ siteId }: { siteId: string }) {
  const query = useQuery(previewLinksQuery(siteId))
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const linkRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [name, setName] = useState('')
  const [days, setDays] = useState<1 | 3 | 7>(3)
  const [issued, setIssued] = useState<string>()
  const [notice, setNotice] = useState('')
  const parsed = NewPreviewLink.safeParse({ name, days })
  const schemaErrors = zodFieldErrors(parsed.error)
  const fields = useFormErrors(schemaErrors)
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.previewLinks(siteId) })
  const create = useMutation({
    mutationFn: async () => {
      const res = await api.sites[':siteId']['preview-links'].$post({
        param: { siteId },
        json: { name, days },
      })
      if (res.status !== 201) throw await apiRequestError(res)
      return res.json()
    },
    onSuccess: (link) => {
      setIssued(link.url)
      setName('')
      fields.reset()
      void invalidate()
    },
    onError: (error) => {
      if (error instanceof ApiRequestError) {
        const errors = issueFieldErrors(error.issues)
        fields.showServerErrors(errors)
        focusField(formRef.current, firstInvalidField(['name', 'days'], errors))
      }
    },
  })
  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.sites[':siteId']['preview-links'][':id'].$delete({
        param: { siteId, id },
      })
      if (res.status !== 204) throw await apiRequestError(res)
    },
    onSuccess: async () => {
      setNotice('Ссылка отозвана: открыть черновики по ней больше нельзя')
      await invalidate()
      headingRef.current?.focus()
    },
  })
  return (
    <Section title="Предпросмотр для заказчика" card headingRef={headingRef}>
      <p>
        Ссылка открывает текущие черновики всего сайта без входа. Передавайте её только тем, кому
        доверяете: любой получивший ссылку увидит черновики. Формы и скрипты отключены.
      </p>
      <form
        ref={formRef}
        noValidate
        aria-label="Создать ссылку на черновики"
        className={formClassName}
        onSubmit={(event) => {
          event.preventDefault()
          fields.attempt()
          if (!parsed.success) {
            focusField(formRef.current, firstInvalidField(['name', 'days'], schemaErrors))
            return
          }
          create.mutate()
        }}
      >
        <TextInput
          label="Для кого"
          name="name"
          error={fields.errors.name}
          required
          maxLength={80}
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            fields.clearServerError('name')
          }}
        />
        <Select
          label="Срок ссылки"
          name="days"
          error={fields.errors.days}
          value={days}
          onChange={(event) => setDays(Number(event.target.value) as 1 | 3 | 7)}
        >
          <option value={1}>1 день</option>
          <option value={3}>3 дня</option>
          <option value={7}>7 дней</option>
        </Select>
        <Button type="submit" loading={create.isPending}>
          Создать ссылку на черновики
        </Button>
      </form>
      {create.error && <InlineAlert tone="danger" title={messageOf(create.error)} />}
      {revoke.error && <InlineAlert tone="danger" title={messageOf(revoke.error)} />}
      {notice && <InlineAlert tone="success" title={notice} live />}
      {query.error && (
        <InlineAlert tone="danger" title={messageOf(query.error)}>
          <Button onClick={() => void query.refetch()}>Повторить</Button>
        </InlineAlert>
      )}
      {query.isPending && <p>Загружаем активные ссылки…</p>}
      {query.data?.length === 0 && <p>Активных ссылок нет.</p>}
      {query.data && query.data.length > 0 && (
        <ul>
          {query.data.map((link) => (
            <li key={link.id}>
              {link.name} · до{' '}
              <time dateTime={link.expiresAt}>
                {new Date(link.expiresAt).toLocaleString('ru-RU')}
              </time>{' '}
              <Button
                size="small"
                loading={revoke.isPending}
                onClick={async () => {
                  if (
                    await confirm({
                      title: 'Отозвать ссылку?',
                      description: `«${link.name}» больше не сможет открыть черновики по этой ссылке.`,
                      confirmLabel: 'Отозвать',
                      tone: 'danger',
                    })
                  )
                    revoke.mutate(link.id)
                }}
              >
                Отозвать
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={issued !== undefined}
        onClose={() => setIssued(undefined)}
        title="Ссылка на черновики"
        escapeCloses={false}
        initialFocus={linkRef}
      >
        <p>
          Скопируйте ссылку сейчас: она показывается один раз. После закрытия её нельзя
          восстановить.
        </p>
        <TextInput
          label="Ссылка для заказчика"
          ref={linkRef}
          readOnly
          value={issued ?? ''}
          onFocus={(event) => event.target.select()}
        />
        <Button onClick={() => setIssued(undefined)}>Ссылка сохранена</Button>
      </Dialog>
    </Section>
  )
}
