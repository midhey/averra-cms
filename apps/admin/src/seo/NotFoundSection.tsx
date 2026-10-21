import { defaultNotFoundContent, NOT_FOUND_PAGE_SLUG, NOT_FOUND_PAGE_TITLE } from '@averra/schema'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { api } from '../api'
import { apiRequestError, messageOf } from '../errors'
import { pageState } from '../pages-format'
import { pagesQuery, queryKeys } from '../queries'
import { Button, buttonClassName } from '../ui/Button'
import { InlineAlert } from '../ui/InlineAlert'
import { FormActions, Section } from '../ui/Screen'
import { StatusPill } from '../ui/StatusPill'

/**
 * Страница 404 — обычная страница со служебным адресом 404: её делают в редакторе из тех же
 * блоков. Своей нет — на сайте стандартная. «Создать» сразу кладёт в черновик стандартную,
 * чтобы было что поправить, и открывает редактор
 */
export function NotFoundSection({ siteId }: { siteId: string }) {
  const { data: pages } = useSuspenseQuery(pagesQuery(siteId))
  const page = pages.find((candidate) => candidate.slug === NOT_FOUND_PAGE_SLUG)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const create = useMutation({
    mutationFn: async () => {
      const param = { siteId }
      const created = await api.sites[':siteId'].pages.$post({
        param,
        json: { slug: NOT_FOUND_PAGE_SLUG, title: NOT_FOUND_PAGE_TITLE, template: 'empty' },
      })
      if (created.status !== 201) throw await apiRequestError(created)
      const saved = await api.sites[':siteId'].pages[':slug'].$put({
        param: { siteId, slug: NOT_FOUND_PAGE_SLUG },
        json: { title: NOT_FOUND_PAGE_TITLE, content: defaultNotFoundContent() },
      })
      if (saved.status !== 200) throw await apiRequestError(saved)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.pages(siteId), exact: true })
      await navigate({ to: '/pages/$slug', params: { slug: NOT_FOUND_PAGE_SLUG } })
    },
  })

  const state = page && pageState(page)

  return (
    <Section
      id="not-found"
      title="Страница 404"
      description="Её видит посетитель на адресе, где страницы нет. Сервер отдаёт её с кодом 404, поисковики её не индексируют."
      card
    >
      {page && state ? (
        <>
          <p>
            Своя страница 404 — «{page.title}»{' '}
            <StatusPill tone={state.tone} appearance="dot">
              {state.label}
            </StatusPill>
          </p>
          {page.publishedAt === null && (
            <InlineAlert tone="warning">
              Пока страница не опубликована, на сайте стандартная 404.
            </InlineAlert>
          )}
          <FormActions>
            <Link
              to="/pages/$slug"
              params={{ slug: NOT_FOUND_PAGE_SLUG }}
              className={buttonClassName()}
            >
              Открыть в редакторе
            </Link>
          </FormActions>
        </>
      ) : (
        <>
          <p>
            Своей нет — на сайте стандартная: «{NOT_FOUND_PAGE_TITLE}» и кнопка на главную в
            оформлении сайта. Своя — обычная страница с адресом /{NOT_FOUND_PAGE_SLUG}: в неё можно
            поставить любые блоки, например контакты или форму.
          </p>
          {create.isError && (
            <InlineAlert tone="danger">
              Не удалось создать страницу 404: {messageOf(create.error)}
            </InlineAlert>
          )}
          <FormActions>
            <Button icon="plus" loading={create.isPending} onClick={() => create.mutate()}>
              Создать страницу 404
            </Button>
          </FormActions>
        </>
      )}
    </Section>
  )
}
