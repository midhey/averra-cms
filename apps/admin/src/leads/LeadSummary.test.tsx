// @vitest-environment happy-dom
import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from '../test/render-with-router'
import { Tabs } from '../ui/Tabs'
import { LeadSummaryView } from './LeadSummary'

afterEach(cleanup)

describe('сводка заявок', () => {
  it('клавиатура и ARIA периода независимы от вкладок заявок', async () => {
    function Example() {
      const [days, setDays] = useState<'7' | '30' | '90'>('30')
      return (
        <>
          <LeadSummaryView
            days={days}
            onDaysChange={setDays}
            data={{ total: 0, sources: [], pages: [], forms: [] }}
          />
          <Tabs
            label="Фильтр заявок"
            items={[{ id: 'processed', label: 'Обработанные' }]}
            value="processed"
            onChange={() => {}}
          >
            Список
          </Tabs>
        </>
      )
    }
    await renderWithRouter(<Example />)
    const user = userEvent.setup()
    const tabs = within(screen.getByRole('tablist', { name: 'Период сводки' }))
    const selected = () => tabs.getByRole('tab', { selected: true })
    const assertPanel = (name: string) => {
      const tab = selected()
      const panel = screen.getByRole('tabpanel', { name })
      expect(tab.getAttribute('aria-controls')).toBe(panel.id)
      expect(panel.getAttribute('aria-labelledby')).toBe(tab.id)
      expect(tab.tabIndex).toBe(0)
      expect(tabs.getAllByRole('tab').filter((item) => item.tabIndex === 0)).toHaveLength(1)
      expect(screen.getByRole('tabpanel', { name: 'Обработанные' }).id).not.toBe(panel.id)
    }
    assertPanel('30 дней')
    selected().focus()
    for (const [key, name] of [
      ['ArrowRight', '90 дней'],
      ['ArrowRight', '7 дней'],
      ['ArrowLeft', '90 дней'],
      ['Home', '7 дней'],
      ['End', '90 дней'],
    ]) {
      await user.keyboard(`{${key}}`)
      assertPanel(name ?? '')
      expect(document.activeElement).toBe(selected())
    }
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('tabpanel', { name: '90 дней' }))
  })

  it('показывает итоги в таблицах и позволяет выбрать период', async () => {
    const onDaysChange = vi.fn()
    await renderWithRouter(
      <LeadSummaryView
        days="30"
        onDaysChange={onDaysChange}
        data={{
          total: 2,
          sources: [{ label: 'ya', count: 2 }],
          pages: [{ label: '/contacts', count: 2 }],
          forms: [
            {
              label: 'Перезвоните',
              pageSlug: 'contacts',
              blockId: '~footer',
              source: 'footer',
              count: 2,
            },
          ],
        }}
      />,
    )
    expect(screen.getByText('Заявок всего:').textContent).toContain('2')
    expect(
      within(screen.getByRole('table', { name: 'По источнику' })).getByRole('rowheader', {
        name: 'ya',
      }),
    ).toBeTruthy()
    expect(
      within(screen.getByRole('table', { name: 'По форме' })).getByText(/подвал сайта/),
    ).toBeTruthy()
    await userEvent.setup().click(screen.getByRole('tab', { name: '90 дней' }))
    expect(onDaysChange).toHaveBeenCalledWith('90')
  })

  it('пустой период — ноль и объяснение', async () => {
    await renderWithRouter(
      <LeadSummaryView
        days="7"
        onDaysChange={() => {}}
        data={{ total: 0, sources: [], pages: [], forms: [] }}
      />,
    )
    expect(screen.getByText('Заявок всего:').textContent).toContain('0')
    expect(screen.getAllByText(/заявок за этот период нет/)).toHaveLength(3)
  })
})
