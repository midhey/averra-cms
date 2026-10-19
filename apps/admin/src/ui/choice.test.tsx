// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { LayoutThumbnail, SegmentedControl } from './SegmentedControl'
import { TabList, Tabs } from './Tabs'

afterEach(cleanup)

type Device = 'phone' | 'tablet' | 'desktop'

function Devices({ appearance }: { appearance?: 'segments' | 'cards' }) {
  const [value, setValue] = useState<Device>('desktop')
  return (
    <>
      <SegmentedControl
        legend="Ширина предпросмотра"
        appearance={appearance}
        options={[
          { value: 'phone', label: 'Телефон', thumbnail: <LayoutThumbnail /> },
          { value: 'tablet', label: 'Планшет' },
          { value: 'desktop', label: 'Десктоп' },
        ]}
        value={value}
        onChange={setValue}
      />
      <output>{value}</output>
    </>
  )
}

describe('SegmentedControl', () => {
  it('группа радиокнопок, подписанная legend; выбранная отмечена', () => {
    render(<Devices />)
    const group = screen.getByRole('group', { name: 'Ширина предпросмотра' })
    const radios = within(group).getAllByRole('radio')
    expect(radios.map((radio) => radio.getAttribute('value'))).toEqual([
      'phone',
      'tablet',
      'desktop',
    ])
    expect(
      (within(group).getByRole('radio', { name: 'Десктоп' }) as HTMLInputElement).checked,
    ).toBe(true)
  })

  it('мышью и стрелками меняет выбор', async () => {
    const user = userEvent.setup()
    render(<Devices appearance="cards" />)
    await user.click(screen.getByText('Телефон'))
    expect(screen.getByRole('status').textContent).toBe('phone')
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('status').textContent).toBe('tablet')
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Планшет' }))
  })

  it('миниатюра скрыта от диктора: имя варианта — подпись', () => {
    render(<Devices appearance="cards" />)
    expect(screen.getByRole('radio', { name: 'Телефон' })).toBeTruthy()
  })
})

function Filter() {
  const [value, setValue] = useState<'new' | 'done' | 'all'>('new')
  return (
    <>
      <button type="button">До вкладок</button>
      <Tabs
        label="Фильтр заявок"
        items={[
          { id: 'new', label: 'Новые', count: 3 },
          { id: 'done', label: 'Обработанные', count: 24 },
          { id: 'all', label: 'Все' },
        ]}
        value={value}
        onChange={setValue}
      >
        Панель {value}
      </Tabs>
    </>
  )
}

describe('Tabs', () => {
  it('роли и связи по WAI-ARIA, в порядке Tab только выбранная вкладка', async () => {
    const user = userEvent.setup()
    render(<Filter />)
    const list = screen.getByRole('tablist', { name: 'Фильтр заявок' })
    const tabs = within(list).getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Новые · 3', 'Обработанные · 24', 'Все'])
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1])
    const panel = screen.getByRole('tabpanel', { name: 'Новые · 3' })
    expect(tabs[0]?.getAttribute('aria-controls')).toBe(panel.id)
    await user.tab()
    await user.tab()
    expect(document.activeElement).toBe(tabs[0])
    await user.tab()
    expect(document.activeElement).toBe(panel)
  })

  it('панель с фокусируемым внутри (panelFocusable={false}) — без лишней остановки Tab', async () => {
    const user = userEvent.setup()
    render(
      <Tabs
        label="Настройки"
        items={[{ id: 'main', label: 'Основное' }]}
        value="main"
        onChange={() => {}}
        panelFocusable={false}
      >
        <button type="button">Сохранить</button>
      </Tabs>,
    )
    const panel = screen.getByRole('tabpanel', { name: 'Основное' })
    expect(panel.hasAttribute('tabindex')).toBe(false)
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Основное' }))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Сохранить' }))
  })

  it('стрелки по кругу, Home и End — переходят и выбирают', async () => {
    const user = userEvent.setup()
    render(<Filter />)
    await user.click(screen.getByRole('tab', { name: 'Новые · 3' }))
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Все')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Все' }))
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Новые · 3')
    await user.keyboard('{End}')
    expect(screen.getByRole('tabpanel').textContent).toBe('Панель all')
    await user.keyboard('{Home}')
    expect(screen.getByRole('tabpanel', { name: 'Новые · 3' }).textContent).toBe('Панель new')
  })
})

function Columns() {
  const [value, setValue] = useState<'blocks' | 'fields'>('blocks')
  return (
    <>
      <TabList
        label="Части редактора"
        items={[
          { id: 'blocks', label: 'Блоки' },
          { id: 'fields', label: 'Поля' },
        ]}
        value={value}
        onChange={setValue}
        tabId={(id) => `tab-${id}`}
        panelId={(id) => `panel-${id}`}
      />
      <div
        role="tabpanel"
        id="panel-blocks"
        aria-labelledby="tab-blocks"
        hidden={value !== 'blocks'}
      >
        Блоки
      </div>
      <div
        role="tabpanel"
        id="panel-fields"
        aria-labelledby="tab-fields"
        hidden={value !== 'fields'}
      >
        Поля
      </div>
    </>
  )
}

describe('TabList', () => {
  it('у каждой вкладки своя панель: aria-controls ведёт на неё, стрелка переключает', async () => {
    const user = userEvent.setup()
    render(<Columns />)
    const fields = screen.getByRole('tab', { name: 'Поля' })
    expect(fields.getAttribute('aria-controls')).toBe('panel-fields')
    expect(screen.getByRole('tabpanel').textContent).toBe('Блоки')
    await user.click(screen.getByRole('tab', { name: 'Блоки' }))
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(fields)
    expect(screen.getByRole('tabpanel', { name: 'Поля' }).textContent).toBe('Поля')
  })
})
