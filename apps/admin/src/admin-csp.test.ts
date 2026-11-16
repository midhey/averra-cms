import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// CSP в index.html — то, что не даёт скрипту в изолированном предпросмотре увести свою рамку на
// чужой адрес: frame-src родителя действует и на переход, начатый самой рамкой
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const policy = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? ''

describe('CSP админки', () => {
  it('рамки — только свои: плееры блока «Видео» админка не встраивает', () => {
    const directives = new Map(
      policy.split(';').map((part) => {
        const [name = '', ...values] = part.trim().split(/\s+/)
        return [name, values] as const
      }),
    )
    expect(directives.get('frame-src')).toEqual(["'self'"])
  })

  it('чужой адрес и «*» в frame-src не попадают', () => {
    expect(policy).not.toMatch(/\*|https?:\/\//)
  })

  it('разрешает ранний inline-скрипт темы без ослабления политики рамок', () => {
    expect(policy).not.toMatch(/(?:^|;)\s*(?:script-src(?:-elem)?|default-src)\s/)
    expect(html.indexOf('averra-admin-theme')).toBeLessThan(html.indexOf('<body>'))
  })
})
