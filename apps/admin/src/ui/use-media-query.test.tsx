// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMediaQuery } from './use-media-query'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function Probe() {
  return <output>{useMediaQuery('(width < 64rem)') ? 'узкий' : 'широкий'}</output>
}

describe('useMediaQuery', () => {
  it('сразу отвечает по matchMedia и перерисовывает, когда совпадение меняется', () => {
    let matches = true
    const listeners = new Set<() => void>()
    vi.stubGlobal('matchMedia', (query: string) => ({
      media: query,
      get matches() {
        return matches
      },
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    }))
    const { unmount } = render(<Probe />)
    expect(screen.getByRole('status').textContent).toBe('узкий')

    act(() => {
      matches = false
      for (const listener of listeners) listener()
    })
    expect(screen.getByRole('status').textContent).toBe('широкий')

    unmount()
    expect(listeners.size).toBe(0)
  })

  it('без matchMedia — «не совпадает», без падения', () => {
    vi.stubGlobal('matchMedia', undefined)
    render(<Probe />)
    expect(screen.getByRole('status').textContent).toBe('широкий')
  })
})
