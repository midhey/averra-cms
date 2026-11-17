// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { absolutePreviewResources, preparePreviewBody, previewHref } from './document'

describe('навигация черновика', () => {
  it.each([
    ['/', '/preview/token/'],
    ['/about/?q=1#team', '/preview/token/about/?q=1#team'],
    ['https://site.example/about/', '/preview/token/about/'],
    ['//site.example/about/', '/preview/token/about/'],
    ['../prices/', '/preview/token/prices/'],
    ['#form', '#form'],
    ['/about/#form', '#form'],
    ['java\nscript:alert(1)', '#'],
    ['mailto:hello@example.com', 'mailto:hello@example.com'],
    ['https://other.example/', 'https://other.example/'],
  ])('%s → %s', (href, expected) => {
    expect(previewHref(href, '/about/', 'https://site.example', '/preview/token')).toBe(expected)
  })

  it('разрешает ресурсы blob-документа с домена админки, а якоря оставляет внутри страницы', () => {
    const doc = new DOMParser().parseFromString(
      `<html><head><style>.a { background: url('/api/media/a/image.webp') }</style></head><body>
      <a href="#form">К форме</a><a href="/preview/token/about/">О нас</a>
      <img src="/api/media/a/image.webp" srcset="/api/media/a/480.webp 480w, /api/media/a/960.webp 960w" alt="">
      <div style="background-image: url(/api/media/a/image.webp)"></div>
    </body></html>`,
      'text/html',
    )
    absolutePreviewResources(doc, 'https://admin.example')
    expect(doc.querySelector('a')?.getAttribute('href')).toBe('#form')
    expect(doc.querySelectorAll('a')[1]?.getAttribute('href')).toBe(
      'https://admin.example/preview/token/about/',
    )
    expect(doc.querySelector('img')?.getAttribute('src')).toBe(
      'https://admin.example/api/media/a/image.webp',
    )
    expect(doc.querySelector('img')?.getAttribute('srcset')).toBe(
      'https://admin.example/api/media/a/480.webp 480w, https://admin.example/api/media/a/960.webp 960w',
    )
    expect(doc.querySelector('style')?.textContent).toContain(
      'https://admin.example/api/media/a/image.webp',
    )
    expect(doc.querySelector('div')?.getAttribute('style')).toContain(
      'https://admin.example/api/media/a/image.webp',
    )
  })

  it('убирает скрипты, фреймы и обработчики; отключает все формы и переписывает ссылки', () => {
    const doc = new DOMParser().parseFromString(
      `<html><body>
      <script>window.executed = true</script><iframe></iframe>
      <a href="/about/" ping="/track">О нас</a><a href="#form" target="_blank">Форма</a>
      <a href="javascript:alert(1)">Опасно</a>
      <form action="/api/forms/site/page/form" method="post"><input name="phone" onfocus="alert(1)"><button formaction="https://evil.example">Отправить</button><input type="submit"></form>
    </body></html>`,
      'text/html',
    )
    preparePreviewBody(doc, '/', 'https://site.example', '/preview/token')
    expect(doc.querySelector('script, iframe, [onfocus], [formaction], [ping]')).toBeNull()
    expect(doc.querySelector('a')?.getAttribute('href')).toBe('/preview/token/about/')
    expect(doc.querySelector('a')?.target).toBe('_top')
    expect(doc.querySelectorAll('a')[1]?.target).toBe('_self')
    expect(doc.querySelectorAll('a')[2]?.hasAttribute('href')).toBe(false)
    expect(doc.querySelector('form')?.hasAttribute('action')).toBe(false)
    expect(doc.querySelector('button')?.disabled).toBe(true)
    expect(doc.querySelector<HTMLInputElement>('input[type="submit"]')?.disabled).toBe(true)
    expect(doc.body.textContent).toContain('Это предпросмотр: заявки не отправляются')
  })
})
