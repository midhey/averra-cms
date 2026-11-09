import { describe, expect, it } from 'vitest'
import { Button } from './common'
import { PageContent } from './page'
import {
  defaultTheme,
  focusContrast,
  readTheme,
  sameTheme,
  Theme,
  ThemeInput,
  themeMediaIds,
  themeMediaRoles,
} from './theme'
import {
  blocksUseBehaviors,
  pageSlugOfHref,
  templateUsesBehaviors,
  templateUsesWindow,
  windowSlugsOfBlocks,
} from './window'

// Окна и поведения в схеме: адрес → страница, кнопки в окно, настройки окна; новые части темы

describe('окна', () => {
  it.each([
    ['/', 'index'],
    ['/zapis', 'zapis'],
    ['/zapis/', 'zapis'],
    ['/zapis/?utm=1#form', 'zapis'],
    ['/a/b/', undefined],
    ['https://t.me/x', undefined],
    ['#form', undefined],
    ['/Zapis/', undefined],
  ])('%s → %s', (href, slug) => {
    expect(pageSlugOfHref(href)).toBe(slug)
  })

  it('кнопки с window в любом месте полей блока — адреса окон', () => {
    const blocks = [
      { type: 'hero', props: { button: { label: 'А', href: '/zapis/', window: true } } },
      {
        type: 'pricing',
        props: {
          plans: [
            { button: { label: 'Б', href: '/ceny', window: true } },
            { button: { label: 'В', href: '/o-nas' } },
          ],
        },
      },
    ]
    expect([...windowSlugsOfBlocks(blocks)]).toEqual(['zapis', 'ceny'])
    expect(blocksUseBehaviors(blocks)).toBe(false)
  })

  it('флажок окна у кнопки необязателен', () => {
    expect(Button.parse({ label: 'А', href: '/zapis' })).toEqual({ label: 'А', href: '/zapis' })
    expect(Button.parse({ label: 'А', href: '/zapis', window: true }).window).toBe(true)
  })

  it('настройки окна — со значениями по умолчанию, длинный заголовок не проходит', () => {
    const content = PageContent.parse({ blocks: [], window: {} })
    expect(content.window).toEqual({
      title: '',
      width: 'medium',
      surface: 'background',
      closeOnBackdrop: true,
    })
    expect(PageContent.safeParse({ blocks: [], window: { title: 'x'.repeat(81) } }).success).toBe(
      false,
    )
  })

  it('шаблоны с поведениями и окнами узнаются по атрибутам', () => {
    expect(templateUsesWindow('<a href="/z/" data-av-window>з</a>')).toBe(true)
    expect(templateUsesWindow('<p data-av-reveal>т</p>')).toBe(false)
    expect(templateUsesBehaviors('<p data-av-reveal>т</p>')).toBe(true)
    expect(templateUsesBehaviors('<p data-avatar>т</p>')).toBe(false)
  })
})

describe('тема: фокус, фон, строка браузера, CSS окон', () => {
  const mediaId = '7b0c2a54-0d7b-4b1e-9a6f-3f1f4e2a9c11'

  it('кольцо фокуса — от 3 к фону и поверхности, иначе тему не сохранить', () => {
    expect(ThemeInput.safeParse({ ...defaultTheme, focus: '#c2410c' }).success).toBe(true)
    const pale = ThemeInput.safeParse({ ...defaultTheme, focus: '#eeeeee' })
    expect(pale.success).toBe(false)
    expect(pale.error?.issues[0]?.path).toEqual(['focus'])
    expect(focusContrast(defaultTheme)).toBeUndefined()
  })

  it('readTheme читает новые части и отбрасывает непонятные', () => {
    const stored = {
      ...defaultTheme,
      fonts: { ...defaultTheme.fonts, mono: 'jetbrains-mono' },
      focus: '#c2410c',
      browserColor: 'accent',
      background: { mediaId, size: 'cover' },
      windowCss: ':scope { padding: 0 }',
    }
    expect(readTheme(stored)).toEqual(Theme.parse(stored))
    const invalid: string[] = []
    const read = readTheme(
      { ...defaultTheme, focus: 'red', browserColor: 'pink', background: { mediaId: 'x' } },
      (field) => invalid.push(field),
    )
    expect(read).toEqual(defaultTheme)
    expect(invalid).toEqual(['focus', 'browserColor', 'background'])
  })

  it('новые части — в сравнении тем и в картинках темы', () => {
    const withBackground = { ...defaultTheme, background: { mediaId, size: 'tile' as const } }
    expect(sameTheme(defaultTheme, withBackground)).toBe(false)
    expect(sameTheme(defaultTheme, { ...defaultTheme, windowCss: '' })).toBe(true)
    expect(
      sameTheme(defaultTheme, {
        ...defaultTheme,
        fonts: { ...defaultTheme.fonts, mono: 'jetbrains-mono' },
      }),
    ).toBe(false)
    expect(themeMediaIds(withBackground)).toEqual([mediaId])
    expect(themeMediaIds(defaultTheme)).toEqual([])
    // Картинки CSS окон — тоже картинки темы (без повторов, в нижнем регистре)
    const other = '0f8e5c1a-2b3c-4d5e-8f70-112233445566'
    expect(
      themeMediaIds({
        ...withBackground,
        windowCss: `:scope { background: url(media:${other.toUpperCase()}) }\na { background: url(media:${mediaId}) }`,
      }),
    ).toEqual([mediaId, other])
    // Где именно — словами: фон страницы и CSS окон различаются
    const both = { ...withBackground, windowCss: `a { background: url(media:${other}) }` }
    expect(themeMediaRoles([both], mediaId)).toEqual(['фон страницы'])
    expect(themeMediaRoles([both], other.toUpperCase())).toEqual(['CSS окон'])
    expect(themeMediaRoles([null, withBackground, both], mediaId)).toEqual(['фон страницы'])
    expect(themeMediaRoles([defaultTheme], mediaId)).toEqual([])
  })
})
