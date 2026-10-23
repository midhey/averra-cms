// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { catalogEntry } from '../editor/catalog'
import { SchemaForm } from './SchemaForm'

afterEach(cleanup)

/** Форма блока каталога со своим состоянием, как в редакторе. Значение — в <output> */
function BlockForm({
  type,
  initial,
  errors = {},
}: {
  type: 'hero' | 'features' | 'form' | 'pricing' | 'contacts' | 'gallery'
  initial: Record<string, unknown>
  errors?: Record<string, string>
}) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <SchemaForm
        schema={catalogEntry(type).schema}
        value={value}
        errors={errors}
        onChange={setValue}
      />
      <output>{JSON.stringify(value)}</output>
    </>
  )
}

// Не по роли: у списка с перетаскиванием своя живая область role=status (dnd-kit)
const formValue = () => JSON.parse(document.querySelector('output')?.textContent ?? '{}')

describe('SchemaForm', () => {
  it('строка: подпись, подсказка из схемы и счётчик в описании поля', () => {
    render(<BlockForm type="hero" initial={{ title: 'Ремонт' }} />)
    const title = screen.getByLabelText('Заголовок', { exact: true })
    expect(title.getAttribute('aria-describedby')).toBeTruthy()
    const description = (title.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent)
      .join(' · ')
    expect(description).toBe('Главная мысль страницы · 6 из 120 символов')
    // Необязательное поле подписано как необязательное
    expect(screen.getByLabelText('Подзаголовок · необязательно')).toBeTruthy()
  })

  it('ошибка поля — в aria-describedby и aria-invalid', () => {
    render(
      <BlockForm
        type="hero"
        initial={{ title: '' }}
        errors={{ title: 'Поле не может быть пустым' }}
      />,
    )
    const title = screen.getByLabelText('Заголовок', { exact: true })
    expect(title.getAttribute('aria-invalid')).toBe('true')
    const ids = (title.getAttribute('aria-describedby') ?? '').split(' ')
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toContain(
      'Поле не может быть пустым',
    )
  })

  it('вариант оформления — карточки-радиокнопки с подписями из схемы', async () => {
    const user = userEvent.setup()
    render(<BlockForm type="hero" initial={{ title: 'Ремонт' }} />)
    const group = screen.getByRole('group', { name: 'Вариант' })
    const radios = within(group).getAllByRole('radio')
    expect(radios.map((radio) => radio.closest('label')?.textContent)).toEqual([
      'По центру',
      'Слева',
      'С картинкой',
    ])
    // Значения нет — выбран вариант по умолчанию из схемы
    expect(
      (within(group).getByRole('radio', { name: 'По центру' }) as HTMLInputElement).checked,
    ).toBe(true)
    await user.click(within(group).getByRole('radio', { name: 'С картинкой' }))
    expect(formValue().variant).toBe('split')
  })

  it('ошибка варианта связана с группой радиокнопок через aria-describedby', () => {
    const message = 'В варианте «С картинкой» (split) нужна картинка'
    render(<BlockForm type="hero" initial={{ title: 'Ремонт' }} errors={{ variant: message }} />)
    const group = screen.getByRole('group', { name: 'Вариант' })
    const ids = (group.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean)
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toEqual([message])
  })

  it('короткий выбор чисел — сегменты, значение остаётся числом', async () => {
    const user = userEvent.setup()
    render(<BlockForm type="features" initial={{ items: [{ title: 'Смета' }] }} />)
    const group = screen.getByRole('group', { name: 'Колонок' })
    expect(
      within(group)
        .getAllByRole('radio')
        .map((radio) => radio.closest('label')?.textContent),
    ).toEqual(['2', '3', '4'])
    await user.click(within(group).getByRole('radio', { name: '4' }))
    expect(formValue().columns).toBe(4)
  })

  it('ссылка — моноширинным полем без счётчика', () => {
    render(
      <BlockForm
        type="hero"
        initial={{ title: 'Ремонт', button: { label: 'Позвонить', href: '#zamer' } }}
      />,
    )
    const href = screen.getByLabelText('Ссылка', { exact: true })
    expect(href.className).toMatch(/mono/)
    const described = (href.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
    expect(described.join(' ')).not.toMatch(/символ/)
  })

  it('необязательный объект — флажок «Показывать»', async () => {
    const user = userEvent.setup()
    render(<BlockForm type="hero" initial={{ title: 'Ремонт' }} />)
    const button = screen.getByRole('group', { name: 'Кнопка' })
    expect(within(button).queryByLabelText('Текст кнопки')).toBeNull()
    await user.click(within(button).getByLabelText('Показывать'))
    expect(formValue().button).toEqual({ label: '', href: '' })
    expect(within(button).getByLabelText('Текст кнопки')).toBeTruthy()
  })

  it('длинный выбор и да/нет: тип поля формы — список, «Обязательное» — флажок', () => {
    render(
      <BlockForm
        type="form"
        initial={{
          title: 'Заявка',
          policyUrl: '/privacy',
          fields: [{ name: 'phone', type: 'phone', label: 'Телефон', required: true }],
        }}
      />,
    )
    const type = screen.getByLabelText('Тип поля') as HTMLSelectElement
    expect(type.tagName).toBe('SELECT')
    expect(type.selectedOptions[0]?.textContent).toBe('Телефон')
    expect((screen.getByLabelText('Обязательное') as HTMLInputElement).checked).toBe(true)
  })

  it('пункты — карточки: добавить, поднять стрелкой, удалить', async () => {
    const user = userEvent.setup()
    render(
      <BlockForm
        type="features"
        initial={{ items: [{ title: 'Смета' }, { title: 'Гарантия' }] }}
      />,
    )
    const items = screen.getByRole('group', { name: 'Пункты' })
    const cards = () => within(items).getAllByRole('listitem')
    expect(cards()).toHaveLength(2)
    expect(
      within(cards()[1] as HTMLElement).getByRole('button', {
        name: 'Перетащить пункт «Гарантия»',
      }),
    ).toBeTruthy()

    await user.click(
      within(cards()[1] as HTMLElement).getByRole('button', { name: 'Поднять пункт' }),
    )
    expect(formValue().items.map((item: { title: string }) => item.title)).toEqual([
      'Гарантия',
      'Смета',
    ])

    await user.click(within(items).getByRole('button', { name: 'Добавить пункт' }))
    expect(cards()).toHaveLength(3)
    expect(formValue().items[2]).toEqual({ title: '' })

    await user.click(
      within(cards()[0] as HTMLElement).getByRole('button', { name: 'Удалить пункт' }),
    )
    expect(formValue().items.map((item: { title: string }) => item.title)).toEqual(['Смета', ''])
  })

  it('пункты-строки внутри пункта — карточки с одним полем: «Что входит» у тарифа', async () => {
    const user = userEvent.setup()
    const plan = (name: string, features: string[]) => ({ name, price: '1 ₽', features })
    render(
      <BlockForm
        type="pricing"
        initial={{ plans: [plan('Базовый', ['Покраска', 'Обои']), plan('Полный', [])] }}
        errors={{ 'plans.0.features.1': 'Слишком длинно' }}
      />,
    )
    // Тариф в списке назван своим названием, а не номером
    expect(screen.getByRole('button', { name: 'Перетащить пункт «Полный»' })).toBeTruthy()
    const features = screen.getAllByRole('group', { name: 'Что входит' })[0] as HTMLElement
    const cards = () => within(features).getAllByRole('listitem')
    expect(cards()).toHaveLength(2)
    // Имя пункта для ручки — сам текст
    expect(
      within(cards()[1] as HTMLElement).getByRole('button', { name: 'Перетащить пункт «Обои»' }),
    ).toBeTruthy()
    const second = within(cards()[1] as HTMLElement).getByLabelText('Пункт')
    expect(second.getAttribute('aria-invalid')).toBe('true')

    await user.clear(second)
    await user.type(second, 'Плитка')
    expect(formValue().plans[0].features).toEqual(['Покраска', 'Плитка'])

    await user.click(within(features).getByRole('button', { name: 'Добавить пункт' }))
    expect(formValue().plans[0].features).toEqual(['Покраска', 'Плитка', ''])
    // Флажок «Выделить» — у каждого тарифа
    expect(screen.getAllByLabelText('Выделить')).toHaveLength(2)
  })

  it('почта и телефон — однострочные поля с type и клавиатурой, без счётчика', () => {
    render(<BlockForm type="contacts" initial={{ phone: '+7 900 123-45-67' }} />)
    const phone = screen.getByLabelText('Телефон · необязательно', { exact: false })
    const email = screen.getByLabelText('Почта · необязательно')
    expect([phone.tagName, phone.getAttribute('type'), phone.getAttribute('inputmode')]).toEqual([
      'INPUT',
      'tel',
      'tel',
    ])
    expect([email.tagName, email.getAttribute('type'), email.getAttribute('inputmode')]).toEqual([
      'INPUT',
      'email',
      'email',
    ])
    const described = (email.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
    expect(described.join(' ')).not.toMatch(/из 254/)
  })

  it('значение по умолчанию — подсказкой в пустом поле: его и покажет сайт', () => {
    const plan = (name: string) => ({ name, price: '1 ₽' })
    render(<BlockForm type="pricing" initial={{ plans: [plan('А'), plan('Б')] }} />)
    const label = screen.getByLabelText('Подпись выделенного тарифа', { exact: false })
    expect((label as HTMLInputElement).value).toBe('')
    expect(label.getAttribute('placeholder')).toBe('Чаще выбирают')
  })

  it('фото галереи в списке названо подписью, без подписи — номером', () => {
    render(<BlockForm type="gallery" initial={{ items: [{ caption: 'Кухня, 12 м²' }, {}] }} />)
    expect(screen.getByRole('button', { name: 'Перетащить пункт «Кухня, 12 м²»' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Перетащить пункт «№ 2»' })).toBeTruthy()
  })

  it('ошибка флажка — под ним и в aria-describedby', () => {
    const plan = (name: string) => ({ name, price: '1 ₽', featured: true })
    render(
      <BlockForm
        type="pricing"
        initial={{ plans: [plan('А'), plan('Б')] }}
        errors={{ 'plans.1.featured': 'Выделить можно один тариф' }}
      />,
    )
    const [first, second] = screen.getAllByLabelText('Выделить')
    expect(first?.getAttribute('aria-invalid')).toBeNull()
    expect(second?.getAttribute('aria-invalid')).toBe('true')
    const ids = (second?.getAttribute('aria-describedby') ?? '').split(' ')
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toContain(
      'Выделить можно один тариф',
    )
  })
})
