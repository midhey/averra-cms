import { describe, expect, it } from 'vitest'
import { highlightCode } from '../ui/code-highlight'
import {
  SANDBOX_PERMISSIONS,
  sandboxCsp,
  sandboxDocument,
  sandboxGoneMessage,
} from './sandbox-document'

describe('изолированный предпросмотр', () => {
  it('рамке разрешены только скрипты: без своего источника, форм, окон и перехода наверх', () => {
    expect(SANDBOX_PERMISSIONS).toBe('allow-scripts')
  })

  it('CSP документа: ни запросов, ни форм, ни фреймов; скрипты — только data:', () => {
    const csp = sandboxCsp('https://admin.example.ru')
    expect(csp).toContain("connect-src 'none'")
    expect(csp).toContain("form-action 'none'")
    expect(csp).toContain("frame-src 'none'")
    expect(csp).toContain('script-src data:')
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).toContain('img-src https://admin.example.ru')
  })

  it('скрипты — модулями из data:, после разметки; код не вставляется в HTML как есть', () => {
    const code = 'document.body.dataset.x = "</script><script>alert(1)</script>"'
    const html = sandboxDocument({
      origin: 'https://admin.example.ru',
      head: '<style>p{}</style>',
      body: '<main><p>Текст</p></main>',
      scripts: [{ label: 'tabs', file: code }],
      token: '7',
    })
    expect(html).not.toContain('</script><script>alert(1)')
    const tags = [
      ...html.matchAll(
        /<script type="module" src="data:text\/javascript;charset=utf-8,([^"]*)"><\/script>/g,
      ),
    ]
    // Своя защита ссылок первой, потом скрипт блока
    expect(tags).toHaveLength(2)
    expect(decodeURIComponent(tags[1]?.[1] ?? '')).toBe(code)
    expect(html.indexOf('<main>')).toBeLessThan(html.indexOf('<script'))
    expect(html).toContain('http-equiv="Content-Security-Policy"')
    // Первый модуль сообщает родителю об уходе документа с меткой этого документа
    const guard = decodeURIComponent(tags[0]?.[1] ?? '')
    expect(guard).toContain("addEventListener('pagehide'")
    expect(guard).toContain(JSON.stringify(sandboxGoneMessage('7')))
  })
})

describe('подсветка скрипта', () => {
  it('комментарии, строки и ключевые слова', () => {
    const kinds = highlightCode("const a = 'x' // да\nawait b", 'js')
      .filter((token) => token.kind)
      .map((token) => [token.kind, token.text])
    expect(kinds).toEqual([
      ['atrule', 'const'],
      ['string', "'x'"],
      ['comment', '// да'],
      ['atrule', 'await'],
    ])
  })
})
