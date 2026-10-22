// @vitest-environment happy-dom
import type { MediaMap, PageContent } from '@averra/schema'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import { Page } from '../Page'
import { isEmbedUrl, PLAYER_ALLOW, PLAYER_SANDBOX, startVideoPlayers } from './player-dom'

// Блок «Видео»: до клика на странице нет ничего, что обратилось бы к площадке, — ни iframe, ни
// картинки с её сервера, ни скрипта. Клик ставит плеер с минимальными правами

const YT = 'aqz-KE-bpKQ'
const coverId = '3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b'
const media: MediaMap = {
  [coverId]: {
    width: 1280,
    height: 720,
    variants: [480, 960, 1280].flatMap((width) =>
      (['avif', 'webp', 'jpeg'] as const).map((format) => ({
        format,
        width,
        height: (width * 9) / 16,
        url: `/media/${coverId}/${width}.${format === 'jpeg' ? 'jpg' : format}`,
      })),
    ),
  },
}

const page = (props: Record<string, unknown>): PageContent =>
  ({ blocks: [{ id: 'video', type: 'video', props }] }) as PageContent

const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(<Page content={page(props)} media={media} />)

/** Адреса, которые браузер загрузит сам, без клика: src, srcset, poster, data у object */
function autoLoaded(html: string) {
  const urls: string[] = []
  for (const [, , value] of html.matchAll(/ (src|srcSet|srcset|poster|data)="([^"]*)"/g)) {
    for (const part of (value ?? '').split(',')) urls.push(part.trim().split(' ')[0] ?? '')
  }
  return urls
}

describe('блок «Видео» на странице', () => {
  it('YouTube без обложки: заглушка и ссылка на ролик, iframe и внешних загрузок нет', () => {
    const html = render({ url: `https://youtu.be/${YT}`, title: 'Как мы работаем' })
    expect(html).not.toMatch(/<iframe|<script|<link|<object|<embed/)
    expect(autoLoaded(html)).toEqual([])
    document.body.innerHTML = html
    const link = document.querySelector('a[data-video-embed]')
    expect(link?.getAttribute('href')).toBe(`https://www.youtube.com/watch?v=${YT}`)
    expect(link?.getAttribute('target')).toBe('_blank')
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer')
    expect(link?.getAttribute('aria-label')).toBe('Смотреть на YouTube: Как мы работаем')
    expect(link?.textContent).toBe('Смотреть на YouTube')
    expect(link?.getAttribute('data-video-embed')).toBe(
      `https://www.youtube-nocookie.com/embed/${YT}?autoplay=1`,
    )
    expect(document.querySelector('h2')?.textContent).toBe('Как мы работаем')
  })

  it('своя обложка — картинка с сайта; подпись под роликом', () => {
    const html = render({
      url: 'https://rutube.ru/video/0123456789abcdef0123456789abcdef/',
      title: 'Ремонт кухни',
      caption: 'Две недели за три минуты',
      cover: { mediaId: coverId, alt: 'Кухня после ремонта' },
    })
    const urls = autoLoaded(html)
    expect(urls.length).toBeGreaterThan(0)
    for (const url of urls) expect(url).toMatch(/^\/media\//)
    document.body.innerHTML = html
    expect(document.querySelector('figcaption')?.textContent).toBe('Две недели за три минуты')
    expect(document.querySelector('a[data-video-embed] img')?.getAttribute('alt')).toBe(
      'Кухня после ремонта',
    )
    expect(document.querySelector('a[data-video-embed]')?.textContent).toBe('Смотреть на Rutube')
  })

  it('VK Видео: ссылка на vkvideo.ru', () => {
    document.body.innerHTML = render({ url: 'https://vk.com/video-1_2', title: 'Объект' })
    expect(document.querySelector('a')?.getAttribute('href')).toBe('https://vkvideo.ru/video-1_2')
    expect(document.querySelector('a')?.textContent).toBe('Смотреть на VK Видео')
  })
})

describe('плеер по клику', () => {
  beforeAll(() => startVideoPlayers(document))

  const mount = () => {
    document.body.innerHTML = render({ url: `https://youtu.be/${YT}`, title: 'Как мы работаем' })
    const link = document.querySelector<HTMLAnchorElement>('a[data-video-embed]')
    if (!link) throw new Error('нет обложки')
    return link
  }

  /**
   * Клик и что с ним сделал плеер: перехватил (defaultPrevented) или оставил ссылкой. После
   * проверки переход по ссылке гасим сами: happy-dom иначе открыл бы youtube.com по-настоящему
   */
  const click = (target: Element, init: MouseEventInit = {}) => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init })
    let intercepted = false
    const stop = (seen: Event) => {
      intercepted = seen.defaultPrevented
      seen.preventDefault()
    }
    window.addEventListener('click', stop)
    target.dispatchEvent(event)
    window.removeEventListener('click', stop)
    return { defaultPrevented: intercepted }
  }

  it('клик по обложке ставит iframe youtube-nocookie с минимальными правами на её место', () => {
    const link = mount()
    const frame = link.parentElement
    // happy-dom не грузит страницы в iframe: пишет об этом в консоль (строка в выводе тестов —
    // отсюда) и шлёт событие error.
    // Попытка загрузки — первое обращение к площадке, и случается она только после клика
    const loads: string[] = []
    const onError = (event: Event) => {
      if (event.target instanceof HTMLIFrameElement) loads.push(event.target.src)
    }
    document.addEventListener('error', onError, true)
    const event = click(link.querySelector('span') ?? link)
    document.removeEventListener('error', onError, true)
    expect(loads).toEqual([`https://www.youtube-nocookie.com/embed/${YT}?autoplay=1`])
    expect(event.defaultPrevented).toBe(true)
    expect(document.querySelector('a[data-video-embed]')).toBeNull()
    const iframe = frame?.querySelector('iframe')
    expect(iframe?.getAttribute('src')).toBe(
      `https://www.youtube-nocookie.com/embed/${YT}?autoplay=1`,
    )
    expect(iframe?.getAttribute('title')).toBe('Как мы работаем')
    expect(iframe?.getAttribute('sandbox')).toBe(PLAYER_SANDBOX)
    expect(iframe?.getAttribute('sandbox')).not.toMatch(/allow-top-navigation|allow-forms/)
    expect(iframe?.getAttribute('allow')).toBe(PLAYER_ALLOW)
    expect(iframe?.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin')
    expect(iframe?.hasAttribute('allowfullscreen')).toBe(true)
  })

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['⌘', { metaKey: true }],
    ['Shift', { shiftKey: true }],
    ['средняя кнопка', { button: 1 }],
  ])('%s-клик остаётся ссылкой', (_, init) => {
    const link = mount()
    const event = click(link, init)
    expect(event.defaultPrevented).toBe(false)
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('чужой адрес в data-video-embed в iframe не попадает', () => {
    const link = mount()
    link.setAttribute('data-video-embed', 'https://evil.example/embed')
    expect(click(link).defaultPrevented).toBe(false)
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('isEmbedUrl пускает только плееры трёх площадок', () => {
    expect(isEmbedUrl(`https://www.youtube-nocookie.com/embed/${YT}?autoplay=1`)).toBe(true)
    expect(isEmbedUrl('https://rutube.ru/play/embed/abc/')).toBe(true)
    expect(isEmbedUrl('https://vkvideo.ru/video_ext.php?oid=-1&id=2')).toBe(true)
    expect(isEmbedUrl('https://www.youtube.com/embed/x')).toBe(false)
    expect(isEmbedUrl('javascript:alert(1)')).toBe(false)
    expect(isEmbedUrl('https://rutube.ru.evil.example/play/embed/x')).toBe(false)
  })
})
