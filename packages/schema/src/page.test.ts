import { describe, expect, it } from 'vitest'
import { hero } from './blocks'
import { NewPage, PageContent, PageSlug, pageTemplateContent } from './page'
import { NewSite } from './site'

describe('PageSlug', () => {
  it.each(['index', 'o-nas', 'price-2026', 'a', '404', 'a'.repeat(64)])(
    'принимает «%s»',
    (slug) => {
      expect(PageSlug.safeParse(slug).success).toBe(true)
    },
  )

  it.each([
    ['пустой', ''],
    ['заглавные', 'About'],
    ['кириллица', 'о-нас'],
    ['пробел', 'o nas'],
    ['подчёркивание', 'o_nas'],
    ['ведущий дефис', '-o-nas'],
    ['хвостовой дефис', 'o-nas-'],
    ['двойной дефис', 'o--nas'],
    ['слеш', 'o/nas'],
    ['длиннее 64', 'a'.repeat(65)],
  ])('отклоняет адрес: %s', (_, slug) => {
    expect(PageSlug.safeParse(slug).success).toBe(false)
  })

  it('объясняет человеку, какой адрес нужен', () => {
    expect(PageSlug.safeParse('O nas').error?.issues[0]?.message).toMatch(/латиница/)
  })

  it('на пустой и слишком длинный адрес — одна ошибка, без лишней «не та латиница»', () => {
    expect(PageSlug.safeParse('').error?.issues).toHaveLength(1)
    expect(PageSlug.safeParse('A'.repeat(65)).error?.issues).toHaveLength(1)
  })
})

describe('NewPage', () => {
  it('по умолчанию создаёт пустую страницу и обрезает пробелы в заголовке', () => {
    expect(NewPage.parse({ slug: 'o-nas', title: '  О нас ' })).toEqual({
      slug: 'o-nas',
      title: 'О нас',
      template: 'empty',
    })
  })

  it('не принимает неизвестный шаблон и лишние поля', () => {
    expect(NewPage.safeParse({ slug: 'a', title: 'А', template: 'blog' }).success).toBe(false)
    expect(NewPage.safeParse({ slug: 'a', title: 'А', content: {} }).success).toBe(false)
  })
})

describe('pageTemplateContent', () => {
  it('пустой шаблон — страница без блоков', () => {
    expect(pageTemplateContent('empty')).toEqual({ blocks: [] })
  })

  it('шаблон hero — один первый экран с примером из каталога', () => {
    const content = pageTemplateContent('hero')
    expect(PageContent.safeParse(content).success).toBe(true)
    expect(content.blocks).toHaveLength(1)
    expect(content.blocks[0]).toMatchObject({ id: 'hero', type: 'hero', props: hero.example })
  })
})

describe('NewSite', () => {
  it('обрезает пробелы в названии', () => {
    expect(NewSite.parse({ name: '  Студия  ' })).toEqual({ name: 'Студия' })
  })

  it.each([
    ['пустое', ''],
    ['из пробелов', '   '],
    ['длиннее 80', 'я'.repeat(81)],
  ])('не принимает название: %s', (_, name) => {
    expect(NewSite.safeParse({ name }).success).toBe(false)
  })

  it('не принимает лишние поля: тему пока не выбирают', () => {
    expect(NewSite.safeParse({ name: 'Сайт', theme: {} }).success).toBe(false)
  })
})
