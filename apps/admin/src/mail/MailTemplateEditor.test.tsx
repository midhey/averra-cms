// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from '../errors'
import type { EditableMailTemplate } from '../queries'
import { ConfirmProvider } from '../ui/Confirm'
import { MailTemplateEditor } from './MailTemplateEditor'

afterEach(cleanup)
const text = { subject: 'Спасибо', preheader: 'Ваша заявка', body: 'Здравствуйте!' }
const template: EditableMailTemplate = {
  id: 'lead-received',
  title: 'Заявка получена',
  description: '',
  defaultText: text,
  vars: [{ name: 'siteName', label: 'Название сайта' }],
  blocks: [],
  draft: text,
  draftUpdatedBy: 'токен «Помощник»',
  draftUpdatedAt: null,
  published: null,
  publishedAt: null,
  publishedBy: null,
}

describe('редактор письма', () => {
  it('помечает черновик ИИ, вставляет в позицию курсора, показывает безопасный предпросмотр', async () => {
    const action = vi.fn(async () => ({ subject: 'Пример', html: '<p>Пример</p>', text: 'Пример' }))
    const { container } = render(
      <ConfirmProvider>
        <MailTemplateEditor template={template} onAction={action} />
      </ConfirmProvider>,
    )
    expect(screen.getByText('Черновик от ИИ: токен «Помощник»')).toBeTruthy()
    const area = screen.getByLabelText('Текст письма') as HTMLTextAreaElement
    area.setSelectionRange(0, 0)
    await userEvent.click(screen.getByRole('button', { name: /Вставить \{siteName\}/ }))
    expect(area.value).toBe('{siteName}Здравствуйте!')
    await userEvent.click(screen.getByRole('button', { name: 'Обновить предпросмотр' }))
    await waitFor(() => expect(container.querySelector('iframe')?.getAttribute('sandbox')).toBe(''))
    expect(container.querySelector('iframe')?.getAttribute('srcdoc')).toBe('<p>Пример</p>')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить черновик' }))
    expect(action).toHaveBeenLastCalledWith('draft', { ...text, body: '{siteName}Здравствуйте!' })
  })

  it('ошибка сервера связана с полем; сброс требует подтверждения', async () => {
    const action = vi.fn(async () => {
      throw new ApiRequestError(400, 'Поправьте текст', [
        { path: 'subject', message: 'Неизвестная подстановка' },
      ])
    })
    render(
      <ConfirmProvider>
        <MailTemplateEditor template={template} onAction={action} />
      </ConfirmProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Опубликовать' }))
    await waitFor(() =>
      expect(screen.getByLabelText('Тема').getAttribute('aria-invalid')).toBe('true'),
    )
    expect(screen.getByText('Неизвестная подстановка')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Вернуть стандартный текст' }))
    expect(action).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(action).toHaveBeenCalledTimes(1)
  })
})
