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
    // Роли записаны явно: на телефоне у table и его частей меняется display, и Safari с VoiceOver
    // без ролей теряет семантику таблицы (в jsdom CSS нет, поэтому смотрим на атрибуты)
    const roleOf = (selector: string) =>
      [...table.querySelectorAll(selector)].map((element) => element.getAttribute('role'))
    expect(table.getAttribute('role')).toBe('table')
    expect(roleOf('thead, tbody')).toEqual(['rowgroup', 'rowgroup'])
    expect(roleOf('tr')).toEqual(['row', 'row', 'row'])
    expect(roleOf('thead th')).toEqual(['columnheader', 'columnheader'])
    expect(roleOf('tbody th')).toEqual(['rowheader', 'rowheader'])
    expect(roleOf('td')).toEqual(['cell', 'cell'])
    const region = screen.getByRole('group', { name: 'Страницы сайта' })
    await user.tab()
    expect(document.activeElement).toBe(region)
  })

  it('значения подписаны для карточки на телефоне, действия — без подписи', () => {
    render(
      <DataTable
        caption="Приглашения"
        columns={[
          ...columns,
          { key: 'note', header: <span>Заметка</span>, label: 'Заметка', cell: () => 'ок' },
          { key: 'actions', header: <span>Действия</span>, pinned: true, cell: () => 'Удалить' },
        ]}
        rows={[{ title: 'Главная', slug: '/' }]}
        rowKey={(page) => page.slug}
      />,
    )
    const cells = within(screen.getByRole('table', { name: 'Приглашения' })).getAllByRole('cell')
    expect(cells.map((cell) => cell.getAttribute('data-label'))).toEqual(['Адрес', 'Заметка', null])
    // Действия прижаты к краю: на узком экране рамки они не уезжают за прокрутку
    expect(cells[2]?.className).toContain('pinned')
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

/** Экран, который не рисует окно вовсе, когда нечего показывать: `{item && <Dialog open …/>}` */
function ConditionalDialog({ escapeCloses }: { escapeCloses?: boolean }) {
  const [shown, setShown] = useState(false)
  return (
    <>
      <Button onClick={() => setShown(true)}>Открыть</Button>
      {shown && (
        <Dialog
          open
          onClose={() => setShown(false)}
          title="Окно"
          escapeCloses={escapeCloses}
          footer={<Button onClick={() => setShown(false)}>Готово</Button>}
        />
      )}
    </>
  )
}

describe('Dialog: фокус и Esc', () => {
  it('убранное из DOM открытым окно возвращает фокус на кнопку, которая его открыла', async () => {
    const user = userEvent.setup()
    render(<ConditionalDialog />)
    const opener = screen.getByRole('button', { name: 'Открыть' })
    await user.click(opener)
    expect(document.querySelector('dialog')?.open).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Готово' }))
    expect(document.querySelector('dialog')).toBeNull()
    // Без возврата фокус оставался бы на body: браузер возвращает его только при закрытии окна
    expect(document.activeElement).toBe(opener)
  })

  it('кнопка, открывшая окно, пропала: фокус не угоняется на чужое', async () => {
    const user = userEvent.setup()
    function Vanishing() {
      const [step, setStep] = useState<'closed' | 'open' | 'gone'>('closed')
      return (
        <>
          {step !== 'gone' && <Button onClick={() => setStep('open')}>Открыть</Button>}
          <Button>Рядом</Button>
          {step !== 'closed' && (
            <Dialog
              open
              onClose={() => setStep('gone')}
              title="Окно"
              footer={<Button onClick={() => setStep('gone')}>Готово</Button>}
            />
          )}
        </>
      )
    }
    render(<Vanishing />)
    await user.click(screen.getByRole('button', { name: 'Открыть' }))
    await user.click(screen.getByRole('button', { name: 'Готово' }))
    expect(screen.queryByRole('button', { name: 'Открыть' })).toBeNull()
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Рядом' }))
  })

  it('escapeCloses={false}: Esc (cancel) не закрывает окно, по умолчанию — закрывает', async () => {
    const user = userEvent.setup()
    const cancel = () => {
      const event = new Event('cancel', { cancelable: true })
      document.querySelector('dialog')?.dispatchEvent(event)
      return event.defaultPrevented
    }
    const first = render(<ConditionalDialog escapeCloses={false} />)
    await user.click(screen.getByRole('button', { name: 'Открыть' }))
    expect(cancel()).toBe(true)
    first.unmount()
    render(<ConditionalDialog />)
    await user.click(screen.getByRole('button', { name: 'Открыть' }))
    expect(cancel()).toBe(false)
  })

  it('escapeCloses={false}: Esc отменяется на keydown, окно не закрывается и на миг', async () => {
    const user = userEvent.setup()
    const onEscapeBlocked = vi.fn()
    const onClose = vi.fn()
    render(
      <Dialog
        open
        onClose={onClose}
        title="Токен"
        escapeCloses={false}
        onEscapeBlocked={onEscapeBlocked}
      />,
    )
    const dialog = document.querySelector('dialog') as HTMLDialogElement
    const closed = vi.fn()
    dialog.addEventListener('close', closed)
    // Фокус внутри окна, как после showModal() в браузере
    screen.getByRole('button', { name: 'Закрыть' }).focus()
    await user.keyboard('{Escape}')
    await user.keyboard('{Escape}')
    expect(onEscapeBlocked).toHaveBeenCalledTimes(2)
    // Само нажатие отменено: именно это в браузере не даёт окну закрыться (happy-dom окно по Esc
    // не закрывает, поэтому без проверки defaultPrevented убранный preventDefault остался бы тихим)
    const blocked = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    dialog.dispatchEvent(blocked)
    expect(blocked.defaultPrevented).toBe(true)
    onEscapeBlocked.mockClear()
    expect(closed).not.toHaveBeenCalled()
    expect(dialog.open).toBe(true)
    // Другие клавиши не трогаем, а при escapeCloses по умолчанию Esc не перехватывается
    onEscapeBlocked.mockClear()
    await user.keyboard('a')
    expect(onEscapeBlocked).not.toHaveBeenCalled()
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    render(<Dialog open onClose={onClose} title="Обычное" />)
    document.querySelectorAll('dialog')[1]?.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('escapeCloses={false}: браузер закрыл окно, не спросив (Chrome), — окно открывается снова', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onEscapeBlocked = vi.fn()
    function Guarded() {
      const [shown, setShown] = useState(true)
      return (
        shown && (
          <Dialog
            open
            onClose={() => {
              onClose()
              setShown(false)
            }}
            title="Токен"
            escapeCloses={false}
            onEscapeBlocked={onEscapeBlocked}
            footer={<Button onClick={() => setShown(false)}>Готово</Button>}
          />
        )
      )
    }
    render(<Guarded />)
    const dialog = document.querySelector('dialog') as HTMLDialogElement
    // Chrome без действия человека даёт закрыть окно: cancel уже не отменить, приходит close
    for (let press = 0; press < 4; press++) {
      dialog.close()
      await vi.waitFor(() => expect(dialog.open).toBe(true))
    }
    expect(onClose).not.toHaveBeenCalled()
    expect(onEscapeBlocked).toHaveBeenCalledTimes(4)
    // Кнопки окна закрывают его по-прежнему
    await user.click(screen.getByRole('button', { name: 'Готово' }))
    expect(document.querySelector('dialog')).toBeNull()
  })
})
