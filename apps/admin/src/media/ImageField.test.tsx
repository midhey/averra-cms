// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JsonSchema } from '../forms/json-schema'
import { queryKeys } from '../queries'
import { ImageField } from './ImageField'
import type { MediaLibraryData } from './media-format'

// Поле картинки: фото блока — с alt и без SVG, логотип «Клиентов» — без alt и с SVG

afterEach(cleanup)

const siteId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'
const photoId = '3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b'
const svgId = '4a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const item = (id: string, name: string, mimeType: string, format: string) => ({
  id,
  originalName: name,
  mimeType,
  width: 120,
  height: 40,
  size: 2048,
  createdAt: '2026-10-20T12:00:00.000Z',
  variants: [{ format, width: 120, height: 40, size: 2048, url: `/api/media/${id}/x` }],
})
const library = {
  items: [
    item(photoId, 'kuhnya.jpg', 'image/jpeg', 'jpeg'),
    item(svgId, 'stroyka.svg', 'image/svg+xml', 'svg'),
  ],
  maxBytes: 10_000_000,
} as unknown as MediaLibraryData

const photoSchema: JsonSchema = {
  type: 'object',
  'x-widget': 'image',
  properties: { mediaId: { type: 'string' }, alt: { type: 'string', title: 'Описание' } },
}
const logoSchema: JsonSchema = {
  type: 'object',
  'x-widget': 'image',
  'x-allow-svg': true,
  properties: { mediaId: { type: 'string' } },
}

function field(schema: JsonSchema, value: unknown) {
  // Медиатека уже в кеше и свежая: тест не ходит в API
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } },
  })
  queryClient.setQueryData(queryKeys.media(siteId), library)
  const onChange = vi.fn()
  render(
    <QueryClientProvider client={queryClient}>
      <ImageField
        siteId={siteId}
        schema={schema}
        value={value}
        path={['logo']}
        label="Логотип"
        required={false}
        errors={{}}
        onChange={onChange}
        widgets={{}}
      />
    </QueryClientProvider>,
  )
  return { onChange }
}

describe('ImageField', () => {
  it('фото: есть поле alt, SVG в выборе нет, выбор сохраняет alt', async () => {
    const user = userEvent.setup()
    const { onChange } = field(photoSchema, { mediaId: photoId, alt: 'Кухня' })
    expect(screen.getByLabelText(/Описание/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Заменить' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByText('stroyka.svg')).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: /^Выбрать «kuhnya.jpg»/ }))
    expect(onChange).toHaveBeenCalledWith(['logo'], { mediaId: photoId, alt: 'Кухня' })
  })

  it('логотип: без alt, SVG можно выбрать, значение — только mediaId', async () => {
    const user = userEvent.setup()
    const { onChange } = field(logoSchema, { mediaId: photoId })
    expect(screen.queryByRole('textbox')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Заменить' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^Выбрать «stroyka.svg»/ }))
    expect(onChange).toHaveBeenCalledWith(['logo'], { mediaId: svgId })
  })
})
