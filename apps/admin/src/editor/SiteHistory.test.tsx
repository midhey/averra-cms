// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ConfirmProvider } from '../ui/Confirm'
import { SiteHistory } from './SiteHistory'

const mocks = vi.hoisted(() => ({ post: vi.fn(), load: vi.fn(), restored: vi.fn() }))
vi.mock('../api', () => ({
  api: {
    sites: {
      ':siteId': {
        theme: { revisions: { ':revisionId': { restore: { $post: mocks.post } } } },
      },
    },
  },
}))
vi.mock('../queries', () => ({
  siteRevisionsQuery: () => ({ queryKey: ['history'], queryFn: mocks.load }),
}))

const revisions = [
  {
    id: 'new',
    version: 2,
    current: true,
    publishedAt: '2026-11-16T12:00:00Z',
    author: { kind: 'user', name: 'Анна' },
  },
  { id: 'old', version: 1, current: false, publishedAt: '2026-11-15T12:00:00Z', author: null },
]

beforeEach(() => {
  vi.resetAllMocks()
  mocks.load.mockResolvedValue(revisions)
  mocks.post.mockResolvedValue(new Response('{}', { status: 200 }))
  mocks.restored.mockResolvedValue(undefined)
})
afterEach(cleanup)

function setup(props: { canRestore?: boolean; unsaved?: boolean; busy?: boolean } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <ConfirmProvider>
        <SiteHistory
          siteId="site"
          entity="theme"
          canRestore
          unsaved={false}
          busy={false}
          onRestored={mocks.restored}
          {...props}
        />
      </ConfirmProvider>
    </QueryClientProvider>,
  )
  return client
}
async function selectFirst() {
  fireEvent.click(screen.getByRole('button', { name: 'История' }))
  fireEvent.click(await screen.findByRole('button', { name: /Версия 1/ }))
}

it('загружает историю по кнопке, показывает автора и текущую версию; возвращает выбранную в черновик', async () => {
  setup()
  expect(mocks.load).not.toHaveBeenCalled()
  await selectFirst()
  expect(screen.getByRole('button', { name: /Версия 2/ }).textContent).toContain('Анна')
  expect(screen.getByText('текущая')).toBeTruthy()
  expect(screen.getByRole('button', { name: /Версия 1/ }).textContent).toContain('автор неизвестен')
  fireEvent.click(screen.getByRole('button', { name: 'Вернуть в черновик' }))
  await screen.findByText(/Версия 1 возвращена в черновик/)
  expect(mocks.post).toHaveBeenCalledWith({ param: { siteId: 'site', revisionId: 'old' } })
  expect(mocks.restored).toHaveBeenCalledOnce()
  expect(screen.getByText(/На сайт она попадёт после публикации/)).toBeTruthy()
})

it('роль только для чтения видит версии без возврата', async () => {
  setup({ canRestore: false })
  await selectFirst()
  expect(screen.queryByRole('button', { name: 'Вернуть в черновик' })).toBeNull()
})

it('несохранённые правки требуют подтверждения, отмена сохраняет их', async () => {
  setup({ unsaved: true })
  await selectFirst()
  fireEvent.click(screen.getByRole('button', { name: 'Вернуть в черновик' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog.textContent).toContain('несохранённые правки')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }))
  expect(mocks.post).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Вернуть в черновик' }))
  const next = await screen.findByRole('alertdialog')
  fireEvent.click(within(next).getByRole('button', { name: 'Вернуть в черновик' }))
  await waitFor(() => expect(mocks.restored).toHaveBeenCalledOnce())
})

it('ошибка API остаётся у истории и не заменяет форму', async () => {
  mocks.post.mockResolvedValue(
    new Response(JSON.stringify({ error: { code: 'conflict', message: 'Картинка удалена' } }), {
      status: 409,
    }),
  )
  setup()
  await selectFirst()
  fireEvent.click(screen.getByRole('button', { name: 'Вернуть в черновик' }))
  await screen.findByText(/Не удалось вернуть версию: Картинка удалена/)
  expect(mocks.restored).not.toHaveBeenCalled()
})

it('во время сохранения или публикации возврат выключен', async () => {
  setup({ busy: true })
  await selectFirst()
  expect(
    (screen.getByRole('button', { name: 'Вернуть в черновик' }) as HTMLButtonElement).disabled,
  ).toBe(true)
})
