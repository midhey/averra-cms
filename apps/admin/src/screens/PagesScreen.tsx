import { MAIN_PAGE_SLUG, NewPage, type PageTemplate } from '@averra/schema'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { getRouteApi, useLocation, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { api } from '../api'
import { ApiRequestError, apiRequestError, messageOf } from '../errors'
import { firstInvalidField, issueFieldErrors, zodFieldErrors } from '../forms/field-errors'
import { focusField, useFormErrors } from '../forms/use-form-errors'
import { type PageRow, PagesTable } from '../pages/PagesTable'
import { filterPages, pagePath, pagesSummary } from '../pages-format'
import { canManagePages } from '../permissions'
import { pagesQuery, queryKeys, siteQuery } from '../queries'
import { Button } from '../ui/Button'
import { cardClassName } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'
import { TextInput } from '../ui/Field'
import { InlineAlert } from '../ui/InlineAlert'
import { PageHeader } from '../ui/PageHeader'
import { formClassName, mutedClassName, Screen, Section } from '../ui/Screen'
import { SegmentedControl } from '../ui/SegmentedControl'
import { usePageTitle } from '../ui/use-page-title'
import styles from './PagesScreen.module.scss'

const route = getRouteApi('/_app/sites/$siteId/pages')

/** Якорь формы «Новая страница»: на него ведёт кнопка с обзора */
const NEW_PAGE_ANCHOR = 'new-page'

type Notice = { kind: 'done' | 'error'; text: string }

export function PagesScreen() {
  const { siteId } = route.useParams()
  // Другой сайт — другой экран: без key форма «Новая страница» и сообщение об удалении
  // переехали бы с сайта на сайт (переход «Назад» между сайтами экран не пересоздаёт)
  return <SitePages key={siteId} siteId={siteId} />
}

function SitePages({ siteId }: { siteId: string }) {
  const { data: site } = useSuspenseQuery(siteQuery(siteId))
  const { data: pages } = useSuspenseQuery(pagesQuery(siteId))
  const queryClient = useQueryClient()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [notice, setNotice] = useState<Notice>()
  const [search, setSearch] = useState('')
  usePageTitle(site.name, 'страницы')
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
      // Опубликованная страница ушла с сайта — сайт на сервере пересобирается
      await queryClient.invalidateQueries({ queryKey: queryKeys.build(siteId) })
      setNotice({ kind: 'done', text: `Страница «${title}» удалена` })
      // Кнопка «Удалить» пропала вместе со строкой: фокус ушёл бы в никуда, и человеку
      // с клавиатуры пришлось бы идти с начала страницы. Ставим его на заголовок списка
      headingRef.current?.focus()
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

  const deleteAction = (page: PageRow) =>
    page.slug === MAIN_PAGE_SLUG ? (
      <span className={mutedClassName}>Главная</span>
    ) : (
      <Button
        variant="danger"
        size="small"
        icon="trash"
        aria-label={`Удалить страницу «${page.title}»`}
        disabled={remove.isPending}
        onClick={() => confirmRemove(page)}
      >
        Удалить
      </Button>
    )

  return (
    <Screen>
      <PageHeader eyebrow={site.name} title="Страницы" meta={pagesSummary(pages)} />

      <Section
        title="Все страницы"
        headingRef={headingRef}
        actions={
          <TextInput
            label="Найти страницу"
            hideLabel
            icon="search"
            type="search"
            placeholder="Найти страницу"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={styles.search}
          />
        }
      >
        <PagesTable
          siteId={siteId}
          pages={filterPages(pages, search)}
          // Клиенту действия недоступны: пустая колонка только сбивала бы с толку
          actions={managePages ? deleteAction : undefined}
          empty={
            <EmptyState title="Ничего не нашлось" icon="search" headingLevel={3}>
              Нет страниц, в заголовке или адресе которых есть «{search.trim()}».
            </EmptyState>
          }
        />
        {notice?.kind === 'done' && (
          <InlineAlert tone="success" live>
            {notice.text}
          </InlineAlert>
        )}
        {notice?.kind === 'error' && <InlineAlert tone="danger">{notice.text}</InlineAlert>}
      </Section>

      {managePages ? (
        <NewPageForm siteId={siteId} />
      ) : (
        <InlineAlert tone="info">
          Вы можете править черновики страниц. Публикует их владелец или редактор сайта.
        </InlineAlert>
      )}
    </Screen>
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
  const { hash } = useLocation()
  const formRef = useRef<HTMLFormElement>(null)
  const headingId = useId()
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [template, setTemplate] = useState<PageTemplate>('hero')
  const [formError, setFormError] = useState<string>()

  // «Новая страница» с обзора ведёт сюда с #new-page: сразу в первое поле формы
  useEffect(() => {
    if (hash === NEW_PAGE_ANCHOR) focusField(formRef.current, 'title')
  }, [hash])

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
    <section id={NEW_PAGE_ANCHOR} aria-labelledby={headingId} className={cardClassName()}>
      <h2 id={headingId} className={styles.formTitle}>
        Новая страница
      </h2>
      <form
        ref={formRef}
        aria-labelledby={headingId}
        className={formClassName}
        onSubmit={submit}
        noValidate
      >
        <TextInput
          label="Заголовок"
          name="title"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value)
            form.clearServerError('title')
          }}
          error={form.errors.title}
          hint="Его видно во вкладке браузера и в поиске"
        />
        <TextInput
          label="Адрес"
          name="slug"
          prefix="/"
          mono
          value={slug}
          onChange={(event) => {
            setSlug(event.target.value)
            form.clearServerError('slug')
          }}
          error={form.errors.slug}
          hint="Латиница в нижнем регистре, цифры и дефис: o-nas, uslugi, price-2026"
        />
        <SegmentedControl
          legend="Содержимое"
          name="template"
          options={templates}
          value={template}
          onChange={setTemplate}
        />
        {formError && <InlineAlert tone="danger">{formError}</InlineAlert>}
        <div>
          <Button type="submit" variant="primary" icon="plus" loading={create.isPending}>
            Создать страницу
          </Button>
        </div>
      </form>
    </section>
  )
}
