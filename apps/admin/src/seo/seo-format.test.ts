import { readSiteSettings } from '@averra/schema'
import { describe, expect, it } from 'vitest'
import {
  emptyRedirectRow,
  fieldError,
  hasUnsavedChanges,
  parseSocials,
  redirectRows,
  rowsToRedirects,
  sentIndexes,
  shadowingPage,
  snippetAddress,
  socialsText,
  titleExample,
} from './seo-format'

describe('раздел «SEO»: подписи и сборка значений', () => {
  it('пример заголовка по шаблону', () => {
    expect(titleExample('%s — Ремонт у Ивана')).toBe('Цены — Ремонт у Ивана')
    expect(titleExample('')).toBe('Цены')
  })

  it('адрес в сниппете — домен и путь через «›»', () => {
    expect(snippetAddress('https://remont.example', null, '/ceny/')).toBe('remont.example › ceny')
    expect(snippetAddress('https://Remont.example/', null, '/')).toBe('remont.example')
    expect(snippetAddress('', null, '/')).toBe('ваш-сайт.ru')
    expect(snippetAddress('  ', 'https://install.example', '/')).toBe('install.example')
    expect(snippetAddress('', 'http://localhost:4321', '/')).toBe('localhost:4321')
  })

  it('недописанный адрес не роняет сниппет: домен — у адреса установки', () => {
    for (const typed of [
      'h',
      'https:/',
      'https://',
      'example.ru',
      'http://example.ru',
      'https://[',
    ]) {
      expect(snippetAddress(typed, 'https://install.example', '/')).toBe('install.example')
      expect(snippetAddress(typed, null, '/')).toBe('ваш-сайт.ru')
    }
  })

  it('редирект с адреса страницы перекрыт ею — в любом написании адреса', () => {
    const pages = [
      { slug: 'index', title: 'Главная' },
      { slug: 'ceny', title: 'Цены' },
      { slug: 'цены-2', title: 'Цены 2' },
    ]
    expect(shadowingPage('/ceny/', pages)?.title).toBe('Цены')
    expect(shadowingPage(' /ceny ', pages)?.title).toBe('Цены')
    expect(shadowingPage('/', pages)?.title).toBe('Главная')
    expect(shadowingPage('/%D1%86%D0%B5%D0%BD%D1%8B-2', pages)?.title).toBe('Цены 2')
    expect(shadowingPage('/old', pages)).toBeUndefined()
    expect(shadowingPage('ceny', pages)).toBeUndefined()
    expect(shadowingPage('', pages)).toBeUndefined()
  })

  it('соцсети — по одной в строке, пустые строки не в счёт', () => {
    expect(parseSocials(' https://vk.com/a \n\nhttps://t.me/a\n')).toEqual([
      'https://vk.com/a',
      'https://t.me/a',
    ])
    expect(socialsText(['https://vk.com/a', 'https://t.me/a'])).toBe(
      'https://vk.com/a\nhttps://t.me/a',
    )
  })

  it('пустые строки таблицы редиректов не уходят, а ошибки API находят свои строки', () => {
    const rows = [
      ...redirectRows([{ from: '/a', to: '/b' }]),
      emptyRedirectRow(),
      { ...emptyRedirectRow(), from: '/c' },
    ]
    expect(new Set(rows.map((row) => row.key)).size).toBe(3)
    expect(rowsToRedirects(rows)).toEqual([
      { from: '/a', to: '/b' },
      { from: '/c', to: '' },
    ])
    expect(sentIndexes(rows)).toEqual([0, undefined, 1])
  })

  it('ошибка поля — своя или у его частей', () => {
    const errors = { 'organization.socials.1': 'Ссылка https://', name: 'Пусто' }
    expect(fieldError(errors, 'organization.socials')).toBe('Ссылка https://')
    expect(fieldError(errors, 'name')).toBe('Пусто')
    expect(fieldError(errors, 'organization')).toBe('Ссылка https://')
    expect(fieldError(errors, 'description')).toBeUndefined()
  })
})

describe('несохранённые правки карточки', () => {
  const saved = {
    name: 'Ремонт',
    ...readSiteSettings({
      url: 'https://remont.ru',
      verification: { yandex: '0a1b2c3d4e5f6a7b' },
      redirects: [{ from: '/old', to: '/new' }],
    }),
  }

  it('то же, что на сервере, в любом написании — правок нет', () => {
    expect(hasUnsavedChanges({ name: 'Ремонт', url: 'HTTPS://Remont.ru/' }, saved)).toBe(false)
    expect(
      hasUnsavedChanges(
        {
          verification: { yandex: '<meta name="yandex-verification" content="0a1b2c3d4e5f6a7b">' },
        },
        saved,
      ),
    ).toBe(false)
    expect(hasUnsavedChanges({ redirects: [{ from: '/old/', to: '/new' }] }, saved)).toBe(false)
  })

  it('другое значение или то, что не проходит схему, — правка', () => {
    expect(hasUnsavedChanges({ name: 'Ремонт у Ивана' }, saved)).toBe(true)
    expect(hasUnsavedChanges({ redirects: [] }, saved)).toBe(true)
    expect(hasUnsavedChanges({ url: 'http://remont.ru' }, saved)).toBe(true)
  })
})
