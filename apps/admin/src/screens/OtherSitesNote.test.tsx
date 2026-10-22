// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { OtherSitesNote } from './OtherSitesNote'

afterEach(cleanup)

const note = () => screen.queryByText('В базе есть и другие сайты')

describe('заметка о других сайтах базы', () => {
  it('один лишний сайт — «он сохранён», несколько — «они сохранены»', () => {
    render(<OtherSitesNote otherSites={1} />)
    expect(note()).toBeTruthy()
    expect(document.body.textContent).toContain(
      'В базе ещё 1 сайт: он сохранён, но в админке не виден.',
    )
    cleanup()
    render(<OtherSitesNote otherSites={3} />)
    expect(document.body.textContent).toContain(
      'В базе ещё 3 сайта: они сохранены, но в админке не видны.',
    )
    cleanup()
    render(<OtherSitesNote otherSites={21} />)
    expect(document.body.textContent).toContain('В базе ещё 21 сайт: он сохранён')
  })

  it.each([0, null])('нет других сайтов (%s) или пришёл не владелец — заметки нет', (count) => {
    render(<OtherSitesNote otherSites={count} />)
    expect(note()).toBeNull()
    expect(document.body.textContent).toBe('')
  })
})
