import { MAIN_PAGE_SLUG, NewPage, type PageTemplate } from '@cms/schema'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useId, useRef, useState } from 'react'
import { api } from '../api'
import { ApiRequestError, apiRequestError, messageOf } from '../errors'
import { firstInvalidField, issueFieldErrors, zodFieldErrors } from '../forms/field-errors'
import { focusField, useFormErrors } from '../forms/use-form-errors'
import { formatDateTime, pagePath, pageState } from '../pages-format'
import { canManagePages } from '../permissions'
import { pagesQuery, queryKeys, siteQuery } from '../queries'
import { Breadcrumbs } from '../ui/Breadcrumbs'
import { TextField } from '../ui/TextField'
import styles from './screens.module.css'

const route = getRouteApi('/sites/$siteId')

type Notice = { kind: 'done' | 'error'; text: string }

export function SiteScreen() {
  const { siteId } = route.useParams()
  const { data: site } = useSuspenseQuery(siteQuery(siteId))
  const { data: pages } = useSuspenseQuery(pagesQuery(siteId))
  const queryClient = useQueryClient()
  const pagesHeadingId = useId()
  const [notice, setNotice] = useState<Notice>()
  // Клиент только правит черновики: создавать и удалять страницы ему API не даст
  const managePages = canManagePages(site.access)

  const remove = useMutation({
    mutationFn: async ({ slug }: { slug: string; title: string }) => {
      const res = await api.sites[':siteId'].pages[':slug'].$delete({ param: { siteId, slug } })
      if (res.status !== 204) throw await apiRequestError(res)
    },
    onSuccess: async (_, { slug, title }) => {
      queryClient.removeQueries({ queryKey: queryKeys.page(siteId, slug) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.pages(siteId), exact: true })
      setNotice({ kind: 'done', text: `Страница «${title}» удалена` })
    },
    onError: (error, { title }) =>
      setNotice({ kind: 'error', text: `Не удалось удалить «${title}»: ${messageOf(error)}` }),
  })

  function confirmRemove(page: { slug: string; title: string }) {
    const question = `Удалить страницу «${page.title}» (${pagePath(page.slug)})? Вернуть её не получится.`
    if (!window.confirm(question)) return
    setNotice(undefined)
    remove.mutate(page)
  }

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <Breadcrumbs site={site} />
        <h1>{site.name}</h1>
      </header>

      <section aria-labelledby={pagesHeadingId} className={styles.section}>
        <h2 id={pagesHeadingId}>Страницы</h2>
        <table className={styles.table} aria-labelledby={pagesHeadingId}>
          <thead>
            <tr>
              <th scope="col">Заголовок</th>
              <th scope="col">Адрес</th>
              <th scope="col">Состояние</th>
              <th scope="col">Опубликована</th>
              <th scope="col">
                <span className={styles.visuallyHidden}>Действия</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {pages.map((page) => (
              <tr key={page.slug}>
                <td>
                  <Link
                    to="/sites/$siteId/pages/$slug"
                    params={{ siteId, slug: page.slug }}
                    className={styles.pageLink}
                  >
                    {page.title}
                  </Link>
                </td>
                <td>
                  <code>{pagePath(page.slug)}</code>
                </td>
                <td>
                  <span className={styles.state} data-changed={page.hasUnpublishedChanges}>
                    {pageState(page)}
                  </span>
                </td>
                <td>
                  {page.publishedAt === null ? (
                    '—'
                  ) : (
                    <time dateTime={page.publishedAt}>{formatDateTime(page.publishedAt)}</time>
                  )}
                </td>
                <td className={styles.rowActions}>
                  {page.slug === MAIN_PAGE_SLUG ? (
                    <span className={styles.muted}>Главная</span>
                  ) : (
                    managePages && (
                      <button
                        type="button"
                        className={styles.danger}
                        aria-label={`Удалить страницу «${page.title}»`}
                        disabled={remove.isPending}
                        onClick={() => confirmRemove(page)}
                      >
                        Удалить
                      </button>
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {notice?.kind === 'done' && (
          <p role="status" className={styles.notice}>
            {notice.text}
          </p>
        )}
        {notice?.kind === 'error' && (
          <p role="alert" className={styles.formError}>
            {notice.text}
          </p>
        )}
      </section>

      {managePages ? (
        <NewPageForm siteId={siteId} />
      ) : (
        <p className={styles.muted}>
          Вы можете править черновики страниц. Публикует их владелец или редактор сайта.
        </p>
      )}
    </main>
  )
}

const templates: readonly { value: PageTemplate; label: string }[] = [
  { value: 'hero', label: 'С первым экраном' },
  { value: 'empty', label: 'Пустая' },
]

const fieldOrder = ['title', 'slug']

function NewPageForm({ siteId }: { siteId: string }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const formRef = useRef<HTMLFormElement>(null)
  const headingId = useId()
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [template, setTemplate] = useState<PageTemplate>('hero')
  const [formError, setFormError] = useState<string>()

  const parsed = NewPage.safeParse({ title, slug, template })
  const form = useFormErrors(zodFieldErrors(parsed.error))

  const create = useMutation({
    mutationFn: async (body: NewPage) => {
      const res = await api.sites[':siteId'].pages.$post({ param: { siteId }, json: body })
      if (res.status !== 201) throw await apiRequestError(res)
      return res.json()
    },
    onSuccess: async (page) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.pages(siteId), exact: true })
      await navigate({ to: '/sites/$siteId/pages/$slug', params: { siteId, slug: page.slug } })
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
      <h2 id={headingId}>Новая страница</h2>
      <form
        ref={formRef}
        aria-labelledby={headingId}
        className={styles.form}
        onSubmit={submit}
        noValidate
      >
        <TextField
          label="Заголовок"
          name="title"
          value={title}
          onChange={(value) => {
            setTitle(value)
            form.clearServerError('title')
          }}
          error={form.errors.title}
          hint="Его видно во вкладке браузера и в поиске"
        />
        <TextField
          label="Адрес"
          name="slug"
          prefix="/"
          value={slug}
          onChange={(value) => {
            setSlug(value)
            form.clearServerError('slug')
          }}
          error={form.errors.slug}
          hint="Латиница в нижнем регистре, цифры и дефис: o-nas, uslugi, price-2026"
        />
        <fieldset className={styles.choice}>
          <legend>Содержимое</legend>
          {templates.map((option) => (
            <label key={option.value}>
              <input
                type="radio"
                name="template"
                value={option.value}
                checked={template === option.value}
                onChange={() => setTemplate(option.value)}
              />
              {option.label}
            </label>
          ))}
        </fieldset>
        {formError && (
          <p role="alert" className={styles.formError}>
            {formError}
          </p>
        )}
        <div className={styles.actions}>
          <button type="submit" className={styles.primary} disabled={create.isPending}>
            Создать страницу
          </button>
        </div>
      </form>
    </section>
  )
}
