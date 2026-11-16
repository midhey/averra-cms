import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const script = /<script>([\s\S]*?)<\/script>/u.exec(html)?.[1] ?? ''

function bootDocument() {
  const scheme = { content: 'light' }
  return {
    documentElement: { dataset: { theme: '' } },
    querySelector: (selector: string) => {
      expect(selector).toBe('meta[name="color-scheme"]')
      return scheme
    },
  }
}

function boot(storage: { getItem: (key: string) => string | null }) {
  const document = bootDocument()
  runInNewContext(script, { document, localStorage: storage })
  const theme = document.documentElement.dataset.theme
  expect(document.querySelector('meta[name="color-scheme"]').content).toBe(
    theme === 'system' ? 'light dark' : theme,
  )
  return theme
}

describe('тема до первой отрисовки', () => {
  it.each(['light', 'dark', 'system'])('читает сохранённый режим %s', (theme) => {
    expect(
      boot({
        getItem: (key) => {
          expect(key).toBe('averra-admin-theme')
          return theme
        },
      }),
    ).toBe(theme)
  })

  it.each([null, '', 'unknown', 'DARK'])('оставляет светлую тему при значении %s', (saved) => {
    expect(boot({ getItem: () => saved })).toBe('light')
  })

  it('переживает запрет доступа к localStorage', () => {
    const document = bootDocument()
    const context = Object.defineProperty({ document }, 'localStorage', {
      get: () => {
        throw new Error('Хранилище закрыто')
      },
    })
    expect(() => runInNewContext(script, context)).not.toThrow()
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})
