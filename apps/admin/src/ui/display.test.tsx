// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button } from './Button'
import { Card } from './Card'
import { DataTable } from './DataTable'
import { Dialog } from './Dialog'
import { EmptyState } from './EmptyState'
import { InlineAlert } from './InlineAlert'
import { PageHeader } from './PageHeader'
import { StatusPill } from './StatusPill'

afterEach(cleanup)

describe('StatusPill', () => {
  it('смысл несёт текст, точка скрыта от диктора', () => {
    render(<StatusPill tone="success">Опубликована</StatusPill>)
    const pill = screen.getByText('Опубликована')
    expect(pill.textContent).toBe('Опубликована')
    expect(pill.querySelector('[aria-hidden="true"]')).toBeTruthy()
  })
})

type Page = { title: string; slug: string }
const columns = [
  { key: 'title', header: 'Страница', cell: (page: Page) => page.title },
  { key: 'slug', header: 'Адрес', mono: true, cell: (page: Page) => page.slug },
]

describe('DataTable', () => {
  it('подпись, заголовки столбцов и строк, прокручиваемая область в порядке Tab', async () => {
    const user = userEvent.setup()
    render(
      <DataTable
        caption="Страницы сайта"
        columns={columns}
        rows={[
          { title: 'Главная', slug: '/' },
          { title: 'Цены', slug: '/ceny' },
        ]}
        rowKey={(page) => page.slug}
      />,
    )
    const table = screen.getByRole('table', { name: 'Страницы сайта' })
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Страница', 'Адрес'])
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((th) => th.textContent),
    ).toEqual(['Главная', 'Цены'])
    const region = screen.getByRole('region', { name: 'Страницы сайта' })
    await user.tab()
    expect(document.activeElement).toBe(region)
  })

  it('пустая — вместо таблицы пустое состояние', () => {
    render(
      <DataTable
        caption="Заявки"
        columns={columns}
        rows={[]}
        rowKey={(page) => page.slug}
        empty={<EmptyState title="Заявок пока нет">Они придут с форм сайта.</EmptyState>}
      />,
    )
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: 'Заявок пока нет' })).toBeTruthy()
  })
})

describe('InlineAlert', () => {
  it('ошибка — role="alert", остальное — просто текст', () => {
    render(
      <>
        <InlineAlert tone="danger" title="Не вышло сохранить">
          API не отвечает
        </InlineAlert>
        <InlineAlert tone="info">Сайт собирается</InlineAlert>
      </>,
    )
    expect(screen.getByRole('alert').textContent).toContain('Не вышло сохранить')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })
})

describe('PageHeader, Card, EmptyState', () => {
  it('заголовок экрана — h1, действия рядом', () => {
    render(
      <PageHeader
        eyebrow="Ремонт у Ивана"
        title="Заявки"
        meta="хранятся 180 дней"
        actions={<Button>Скачать CSV</Button>}
      />,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Заявки' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Скачать CSV' })).toBeTruthy()
  })

  it('карточка рисуется нужным элементом', () => {
    render(
      <Card as="section" aria-label="Коротко">
        Текст
      </Card>,
    )
    expect(screen.getByRole('region', { name: 'Коротко' }).tagName).toBe('SECTION')
  })

  it('пустое состояние — заголовок нужного уровня и действие', () => {
    render(
      <EmptyState title="Страниц нет" headingLevel={3} action={<Button>Создать</Button>}>
        Создайте первую
      </EmptyState>,
    )
    expect(screen.getByRole('heading', { level: 3, name: 'Страниц нет' })).toBeTruthy()
  })
})

function DeleteDialog({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Удалить…</Button>
      <Dialog
        open={open}
        onClose={() => {
          onClose()
          setOpen(false)
        }}
        title="Удалить страницу?"
        description="История тоже удалится"
        footer={<Button onClick={() => setOpen(false)}>Отмена</Button>}
      />
    </>
  )
}

describe('Dialog', () => {
  it('открывается showModal, подписан заголовком и описанием', async () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal')
    const user = userEvent.setup()
    render(<DeleteDialog onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Удалить…' }))
    const dialog = screen.getByRole('dialog', { name: 'Удалить страницу?' }) as HTMLDialogElement
    expect(dialog.open).toBe(true)
    // Модальное окно (фокус внутри, фон недоступен), а не просто open
    expect(showModal).toHaveBeenCalledOnce()
    showModal.mockRestore()
    const description = document.getElementById(dialog.getAttribute('aria-describedby') ?? '')
    expect(description?.textContent).toBe('История тоже удалится')
  })

  it('«Закрыть» и Esc сообщают экрану о закрытии', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<DeleteDialog onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Удалить…' }))
    await user.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect((document.querySelector('dialog') as HTMLDialogElement).open).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Удалить…' }))
    // Esc у нативного окна: браузер закрывает его сам и шлёт close
    ;(document.querySelector('dialog') as HTMLDialogElement).close()
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(2))
  })

  it('кнопка в подвале закрывает без лишнего onClose', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<DeleteDialog onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Удалить…' }))
    await user.click(screen.getByRole('button', { name: 'Отмена' }))
    expect((document.querySelector('dialog') as HTMLDialogElement).open).toBe(false)
    expect(onClose).not.toHaveBeenCalled()
  })
})
