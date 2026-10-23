import { blocks, type MediaMap, PageContent } from '@averra/schema'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Page } from './Page'

// Блоки из каталога «Добавить блок» шага с ценами, шагами и вопросами: ключевая разметка, без
// скриптов (работают без JS), заголовки по порядку

const render = (blocksInput: unknown[], media?: MediaMap) =>
  renderToStaticMarkup(<Page content={PageContent.parse({ blocks: blocksInput })} media={media} />)
const block = (type: string, props: unknown, id = type) => ({ id, type, props })
/** Уровни заголовков по порядку: h1, h2, h3… */
const headingLevels = (html: string) =>
  [...html.matchAll(/<h([1-6])[\s>]/g)].map(([, level]) => Number(level))

const mediaId = '3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b'
const media: MediaMap = {
  [mediaId]: {
    width: 960,
    height: 720,
    variants: [{ format: 'jpeg', width: 960, height: 720, url: `/api/media/${mediaId}/960.jpeg` }],
  },
}

describe('все блоки каталога', () => {
  it('пример каждого блока рендерится без script и без пропусков уровней заголовков', () => {
    const html = render(blocks.map((entry) => block(entry.type, entry.example)))
    expect(html).not.toContain('<script')
    const levels = headingLevels(html)
    // После h2 блока может идти h3 пункта, но не h4: уровень растёт не больше чем на один
    levels.forEach((level, index) => {
      expect(level - (levels[index - 1] ?? 1)).toBeLessThanOrEqual(1)
    })
  })
})

describe('списки без маркеров', () => {
  // Safari с list-style: none не называет список списком, если у него нет role="list"
  it.each(['features', 'stats', 'steps', 'pricing', 'gallery', 'reviews', 'team', 'clients'])(
    '«%s»: главный список блока — с role="list"',
    (type) => {
      const entry = blocks.find((item) => item.type === type)
      const html = render([block(type, entry?.example)])
      expect(/<(ul|ol)[\s>][^>]*/.exec(html)?.[0]).toContain('role="list"')
    },
  )
})

describe('«Текст с картинкой»', () => {
  const image = { mediaId, alt: 'Бригада на объекте' }

  it('текст первым в разметке, картинка — слева или справа сеткой', () => {
    const left = render([block('text-image', { title: 'О нас', body: 'Абзац', image })], media)
    expect(left).toContain('data-image="left"')
    expect(left.indexOf('>О нас</h2>')).toBeLessThan(left.indexOf('<picture'))
    expect(left).toContain('alt="Бригада на объекте"')
    const right = render(
      [block('text-image', { body: 'Абзац', image, imagePosition: 'right' })],
      media,
    )
    expect(right).toContain('data-image="right"')
  })

  it('без картинки — просто текст с лёгкой разметкой', () => {
    const html = render([block('text-image', { body: 'Первый\n\n## Подробнее\n- раз\n- два' })])
    expect(html).toContain('data-image="none"')
    expect(html).not.toContain('<picture')
    expect(html).toMatch(/<h3[^>]*>Подробнее<\/h3>/)
    expect(html).toMatch(/<ul[^>]*><li>раз<\/li><li>два<\/li><\/ul>/)
  })
})

describe('«Цифры»', () => {
  const items = [
    { value: '12', label: 'лет работаем' },
    { value: '0 ₽', label: 'замер' },
  ]

  it('число и подпись в одном пункте списка: диктор читает их вместе', () => {
    const html = render([block('stats', { items })])
    expect(html).toMatch(/<li[^>]*><span[^>]*>12<\/span> <span[^>]*>лет работаем<\/span><\/li>/)
    expect(html).toContain('data-tone="surface"')
    expect(headingLevels(html)).toEqual([])
  })

  it('оформление без подложки и заголовок второго уровня', () => {
    const html = render([block('stats', { title: 'В цифрах', items, tone: 'plain' })])
    expect(html).toContain('data-tone="plain"')
    expect(html).toContain('>В цифрах</h2>')
  })
})

describe('«Как мы работаем»', () => {
  it('нумерованный список с ролью list, номер — рисунок для зрячих', () => {
    const items = [{ title: 'Заявка', text: 'Звоните' }, { title: 'Замер' }, { title: 'Ремонт' }]
    const html = render([block('steps', { title: 'Как мы работаем', items })])
    expect(html).toMatch(/<ol role="list"/)
    expect(html.match(/<li/g)).toHaveLength(3)
    expect(html).toContain('aria-hidden="true">01</span>')
    expect(html).toContain('aria-hidden="true">03</span>')
    expect(headingLevels(html)).toEqual([2, 3, 3, 3])
  })
})

describe('«Услуги и цены»', () => {
  const plan = (name: string, extra = {}) => ({
    name,
    price: 'от 1 000 ₽',
    features: ['Покраска'],
    button: { label: 'Обсудить', href: '#form' },
    ...extra,
  })

  it('тарифы — список карточек, у выделенного подпись и кнопка с заливкой', () => {
    const html = render([
      block('pricing', {
        title: 'Цены',
        plans: [plan('Базовый'), plan('Полный', { featured: true })],
      }),
    ])
    expect(headingLevels(html)).toEqual([2, 3, 3])
    expect(html).toContain('data-featured="true"')
    expect(html).toMatch(/<p[^>]*>Чаще выбирают<\/p><h3[^>]*>Полный<\/h3>/)
    expect(html).toMatch(/<a[^>]*href="#form"[^>]*data-appearance="outline"/)
    expect(html).toMatch(/<a[^>]*href="#form"[^>]*data-appearance="filled"/)
    expect(html.match(/Чаще выбирают/g)).toHaveLength(1)
  })

  it('без пунктов и кнопки — без пустого списка и ссылки', () => {
    const html = render([
      block('pricing', {
        plans: [
          { name: 'А', price: '1 ₽' },
          { name: 'Б', price: '2 ₽' },
        ],
      }),
    ])
    expect(html.match(/<ul/g)).toHaveLength(1)
    expect(html).not.toContain('<a')
  })
})

describe('«Вопросы и ответы»', () => {
  const items = [
    { question: 'Сколько стоит замер?', answer: 'Бесплатно.\n\nПриедем в удобное время.' },
    { question: 'Какая гарантия?', answer: 'Три года.' },
  ]

  it('details и summary, первый открыт, ответ по абзацам', () => {
    const html = render([block('faq', { title: 'Вопросы', items })])
    expect(html.match(/<details/g)).toHaveLength(2)
    expect(html).toMatch(/<details[^>]*open=""[^>]*><summary[^>]*>Сколько стоит замер\?/)
    expect(html).toMatch(/<details class="[^"]*"><summary[^>]*>Какая гарантия\?/)
    expect(html).toContain('<p>Бесплатно.</p><p>Приедем в удобное время.</p>')
    // В summary нет заголовка: у роли «кнопка» он теряется
    expect(html).not.toMatch(/<summary[^>]*>[^<]*<h/)
    expect(headingLevels(html)).toEqual([2])
  })

  it('все закрыты, если первый открывать не нужно', () => {
    const html = render([block('faq', { items, openFirst: false })])
    expect(html).not.toContain('open=""')
  })
})
