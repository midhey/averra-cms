import { NewSite } from '@averra/schema'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useId, useRef, useState } from 'react'
import { api } from '../api'
import { ApiRequestError, apiRequestError, messageOf } from '../errors'
import { countRu } from '../format/plural'
import { firstInvalidField, issueFieldErrors, zodFieldErrors } from '../forms/field-errors'
import { focusField, useFormErrors } from '../forms/use-form-errors'
import { meQuery, queryKeys, sitesQuery } from '../queries'
import { Button } from '../ui/Button'
import { cardClassName } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'
import { TextInput } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { InlineAlert } from '../ui/InlineAlert'
import { PageHeader } from '../ui/PageHeader'
import { formClassName, Screen, Section } from '../ui/Screen'
import { usePageTitle } from '../ui/use-page-title'
import styles from './SitesScreen.module.scss'

export function SitesScreen() {
  const { data: sites } = useSuspenseQuery(sitesQuery())
  const { data: me } = useSuspenseQuery(meQuery())
  const isOwner = me?.role === 'owner'
  usePageTitle('Сайты')

  return (
    <Screen>
      <PageHeader
        title="Сайты"
        meta={sites.length > 0 ? countRu(sites.length, ['сайт', 'сайта', 'сайтов']) : undefined}
      />

      <Section title="Список сайтов">
        {sites.length === 0 ? (
          <div className={cardClassName()}>
            <EmptyState title="Сайтов пока нет" icon="pages" headingLevel={3}>
              {isOwner
                ? 'Создайте первый сайт: у него сразу будет главная страница, её можно наполнить в редакторе.'
                : 'Доступа к сайтам пока нет. Его даёт владелец админки письмом-приглашением.'}
            </EmptyState>
          </div>
        ) : (
          <ul className={styles.grid}>
            {sites.map((site) => (
              <li key={site.id}>
                <Link
                  to="/sites/$siteId"
                  params={{ siteId: site.id }}
                  className={cardClassName({ interactive: true })}
                >
                  <span className={styles.mark} aria-hidden="true">
                    {site.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className={styles.name}>{site.name}</span>
                  <span className={styles.open}>
                    Открыть <Icon name="arrow-right" size={16} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Сайты создаёт только владелец: участнику API ответил бы 403 */}
      {isOwner && <NewSiteForm />}
    </Screen>
  )
}

const fieldOrder = ['name']

function NewSiteForm() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const formRef = useRef<HTMLFormElement>(null)
  const headingId = useId()
  const [name, setName] = useState('')
  const [formError, setFormError] = useState<string>()

  const parsed = NewSite.safeParse({ name })
  const form = useFormErrors(zodFieldErrors(parsed.error))

  const create = useMutation({
    mutationFn: async (body: NewSite) => {
      const res = await api.sites.$post({ json: body })
      if (res.status !== 201) throw await apiRequestError(res)
      return res.json()
    },
    onSuccess: async (site) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.sites, exact: true })
      await navigate({ to: '/sites/$siteId', params: { siteId: site.id } })
    },
    onError: (error) => {
      if (error instanceof ApiRequestError && error.issues.length > 0) {
        const errors = issueFieldErrors(error.issues)
        form.showServerErrors(errors)
        focusField(formRef.current, firstInvalidField(fieldOrder, errors))
      } else {
        setFormError(messageOf(error))
      }
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    form.attempt()
    setFormError(undefined)
    if (!parsed.success) {
      focusField(formRef.current, firstInvalidField(fieldOrder, zodFieldErrors(parsed.error)))
      return
    }
    create.mutate(parsed.data)
  }

  return (
    <section aria-labelledby={headingId} className={cardClassName()}>
      <h2 id={headingId} className={styles.formTitle}>
        Новый сайт
      </h2>
      <form
        ref={formRef}
        aria-labelledby={headingId}
        className={formClassName}
        onSubmit={submit}
        noValidate
      >
        <TextInput
          label="Название"
          name="name"
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            form.clearServerError('name')
          }}
          error={form.errors.name}
          hint="Им же назовётся главная страница (заголовок можно поменять в редакторе). Оформление — стандартная тема"
        />
        {formError && <InlineAlert tone="danger">{formError}</InlineAlert>}
        <div>
          <Button type="submit" variant="primary" icon="plus" loading={create.isPending}>
            Создать сайт
          </Button>
        </div>
      </form>
    </section>
  )
}
