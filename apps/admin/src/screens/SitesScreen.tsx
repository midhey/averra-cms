import { NewSite } from '@cms/schema'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useId, useRef, useState } from 'react'
import { api } from '../api'
import { ApiRequestError, apiRequestError, messageOf } from '../errors'
import { firstInvalidField, issueFieldErrors, zodFieldErrors } from '../forms/field-errors'
import { focusField, useFormErrors } from '../forms/use-form-errors'
import { queryKeys, sitesQuery } from '../queries'
import { Breadcrumbs } from '../ui/Breadcrumbs'
import { TextField } from '../ui/TextField'
import styles from './screens.module.css'

export function SitesScreen() {
  const { data: sites } = useSuspenseQuery(sitesQuery())
  const listHeadingId = useId()

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <Breadcrumbs />
        <h1>Сайты</h1>
      </header>

      <section aria-labelledby={listHeadingId} className={styles.section}>
        <h2 id={listHeadingId} className={styles.visuallyHidden}>
          Список сайтов
        </h2>
        {sites.length === 0 ? (
          <p className={styles.empty}>Сайтов пока нет. Создайте первый.</p>
        ) : (
          <ul className={styles.siteList}>
            {sites.map((site) => (
              <li key={site.id}>
                <Link to="/sites/$siteId" params={{ siteId: site.id }}>
                  {site.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <NewSiteForm />
    </main>
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
    <section className={styles.section}>
      <h2 id={headingId}>Новый сайт</h2>
      <form
        ref={formRef}
        aria-labelledby={headingId}
        className={styles.form}
        onSubmit={submit}
        noValidate
      >
        <TextField
          label="Название"
          name="name"
          value={name}
          onChange={(value) => {
            setName(value)
            form.clearServerError('name')
          }}
          error={form.errors.name}
          hint="Его видно только в админке. Оформление у нового сайта — стандартная тема"
        />
        {formError && (
          <p role="alert" className={styles.formError}>
            {formError}
          </p>
        )}
        <div className={styles.actions}>
          <button type="submit" className={styles.primary} disabled={create.isPending}>
            Создать сайт
          </button>
        </div>
      </form>
    </section>
  )
}
