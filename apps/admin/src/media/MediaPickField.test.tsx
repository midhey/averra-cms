// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '../queries'
import { MediaPickField } from './MediaPickField'
import type { MediaLibraryData } from './media-format'

// Поле картинки без alt (логотип шапки, иконка сайта): у кого нет права менять — только просмотр

afterEach(cleanup)

const siteId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'
const logoId = '3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b'
const library = {
  items: [
    {
      id: logoId,
      originalName: 'logo.png',
      mimeType: 'image/png',
      width: 240,
      height: 80,
      size: 2048,
      createdAt: '2026-10-20T12:00:00.000Z',
      variants: [{ format: 'png', width: 240, height: 80, size: 2048, url: '/api/media/x' }],
    },
  ],
  maxBytes: 10_000_000,
} as unknown as MediaLibraryData

function field(disabled: boolean) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } },
  })
  queryClient.setQueryData(queryKeys.media(siteId), library)
  const onChange = vi.fn()
  render(
    <QueryClientProvider client={queryClient}>
      <MediaPickField
        siteId={siteId}
        label="Логотип"
        name="logo"
        value={logoId}
        onChange={onChange}
        disabled={disabled}
      />
    </QueryClientProvider>,
  )
  return onChange
}

describe('MediaPickField', () => {
  it('можно менять — «Заменить» и «Убрать картинку»', () => {
    field(false)
    expect(screen.getByRole('button', { name: 'Заменить' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Убрать картинку' })).toBeTruthy()
  })

  it('только просмотр — картинку видно, кнопок выбора и удаления нет', () => {
    field(true)
    expect(screen.getByText('logo.png')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
