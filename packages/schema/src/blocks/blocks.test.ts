import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { BLOCK_CATEGORIES, ENUM_SKETCHES } from '../define-block'
import { splitParagraphs } from '../text-body'
import {
  blocks,
  clients,
  contacts,
  faq,
  gallery,
  pricing,
  reviews,
  stats,
  steps,
  team,
  textImage,
} from './index'

const mediaId = '3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b'
const ok = (schema: z.ZodType, value: unknown) => schema.safeParse(value).success
/** Путь первой ошибки: по нему редактор ставит ошибку у поля */
const issuePath = (schema: z.ZodType, value: unknown) =>
  schema.safeParse(value).error?.issues[0]?.path

describe('разделы каталога', () => {
  it('у каждого блока раздел из списка, и в каждом разделе есть блок', () => {
    const used = new Set(blocks.map((block) => block.category))
    for (const block of blocks)
      expect(Object.keys(BLOCK_CATEGORIES), block.type).toContain(block.category)
    expect([...used].toSorted()).toEqual(Object.keys(BLOCK_CATEGORIES).toSorted())
  })

  it('у всех вариантов оформления с миниатюрами рисунок из ENUM_SKETCHES', () => {
    for (const block of blocks) {
      const properties = z.toJSONSchema(block.props, { io: 'input' }).properties ?? {}
      for (const [key, field] of Object.entries(properties)) {
        const sketches = (field as { 'x-enum-sketches'?: Record<string, string> })[
          'x-enum-sketches'
        ]
        if (!sketches) continue
        for (const sketch of Object.values(sketches)) {
          expect(ENUM_SKETCHES, `${block.type}.${key}`).toContain(sketch)
        }
      }
    }
  })

  it('примеры без выдуманных фактов: числа и цены — заглушки в квадратных скобках', () => {
    const numbers = (value: unknown) =>
      JSON.stringify(value)
        .replaceAll(/\[[^\]]*\]/g, '')
        .match(/\d/g) ?? []
    const landing = [
      textImage,
      stats,
      steps,
      pricing,
      gallery,
      reviews,
      clients,
      team,
      faq,
      contacts,
    ]
    for (const block of landing) {
      expect(numbers(block.example), block.type).toEqual([])
    }
  })
})

describe('«Текст с картинкой»', () => {
  const image = { mediaId, alt: 'Бригада на объекте' }

  it('текст обязателен, картинка и кнопка — нет; по умолчанию картинка слева', () => {
    expect(textImage.props.parse({ body: 'Абзац' })).toMatchObject({ imagePosition: 'left' })
    expect(ok(textImage.props, { body: 'Абзац', image, imagePosition: 'right' })).toBe(true)
    expect(ok(textImage.props, { title: 'О нас' })).toBe(false)
    expect(ok(textImage.props, { body: '   ' })).toBe(false)
  })

  it('не пускает длинный текст, картинку без alt и другой вариант', () => {
    expect(ok(textImage.props, { body: 'а'.repeat(3001) })).toBe(false)
    expect(ok(textImage.props, { body: 'А', image: { mediaId, alt: '' } })).toBe(false)
    expect(ok(textImage.props, { body: 'А', imagePosition: 'top' })).toBe(false)
  })
})

describe('«Цифры»', () => {
  const item = { value: '12', label: 'лет работаем' }

  it('от двух до четырёх фактов, по умолчанию на подложке', () => {
    expect(stats.props.parse({ items: [item, item] })).toMatchObject({ tone: 'surface' })
    expect(ok(stats.props, { items: [item] })).toBe(false)
    expect(ok(stats.props, { items: [item, item, item, item, item] })).toBe(false)
  })

  it('число короткое, подпись обязательна', () => {
    expect(ok(stats.props, { items: [item, { value: '1'.repeat(17), label: 'а' }] })).toBe(false)
    expect(ok(stats.props, { items: [item, { value: '5', label: '' }] })).toBe(false)
    expect(ok(stats.props, { items: [item, item], tone: 'dark' })).toBe(false)
  })
})

describe('«Как мы работаем»', () => {
  const step = { title: 'Замер' }

  it('от трёх до шести шагов', () => {
    expect(ok(steps.props, { items: [step, step, step] })).toBe(true)
    expect(ok(steps.props, { items: [step, step] })).toBe(false)
    expect(ok(steps.props, { items: Array(7).fill(step) })).toBe(false)
  })

  it('у шага название до 80 символов, лишних полей нет', () => {
    expect(ok(steps.props, { items: [step, step, { title: 'а'.repeat(81) }] })).toBe(false)
    expect(ok(steps.props, { items: [step, step, { title: 'А', number: 3 }] })).toBe(false)
  })
})

describe('«Услуги и цены»', () => {
  const plan = { name: 'Базовый', price: 'от 1 000 ₽' }

  it('от двух до четырёх тарифов, пункты и выделение по умолчанию пустые', () => {
    const parsed = pricing.props.parse({ plans: [plan, plan] })
    expect(parsed.featuredLabel).toBe('Чаще выбирают')
    expect(parsed.plans[0]).toMatchObject({ features: [], featured: false })
    expect(ok(pricing.props, { plans: [plan] })).toBe(false)
    expect(ok(pricing.props, { plans: Array(5).fill(plan) })).toBe(false)
  })

  it('выделить можно один тариф: ошибка у флажка второго', () => {
    const featured = { ...plan, featured: true }
    expect(ok(pricing.props, { plans: [featured, plan] })).toBe(true)
    expect(issuePath(pricing.props, { plans: [plan, featured, featured] })).toEqual([
      'plans',
      2,
      'featured',
    ])
  })

  it('пункты непустые и не длиннее 120, кнопка — безопасной ссылкой', () => {
    expect(ok(pricing.props, { plans: [{ ...plan, features: [''] }, plan] })).toBe(false)
    expect(ok(pricing.props, { plans: [{ ...plan, features: ['а'.repeat(121)] }, plan] })).toBe(
      false,
    )
    const button = { label: 'Купить', href: 'javascript:alert(1)' }
    expect(ok(pricing.props, { plans: [{ ...plan, button }, plan] })).toBe(false)
    expect(ok(pricing.props, { plans: [{ ...plan, price: '' }, plan] })).toBe(false)
  })
})

describe('«Вопросы и ответы»', () => {
  const item = { question: 'Сколько стоит замер?', answer: 'Бесплатно.' }

  it('первый вопрос по умолчанию открыт, вопросов от 1 до 20', () => {
    expect(faq.props.parse({ items: [item] })).toMatchObject({ openFirst: true })
    expect(ok(faq.props, { items: [] })).toBe(false)
    expect(ok(faq.props, { items: Array(21).fill(item) })).toBe(false)
  })

  it('у вопроса нужен и ответ', () => {
    expect(ok(faq.props, { items: [{ question: 'Вопрос?' }] })).toBe(false)
    expect(ok(faq.props, { items: [{ ...item, answer: 'а'.repeat(2001) }] })).toBe(false)
  })

  it('ответ делится на абзацы по пустой строке', () => {
    expect(splitParagraphs('Первый\nабзац\n\n  \nВторой ')).toEqual(['Первый абзац', 'Второй'])
  })
})

describe('«Наши работы»', () => {
  const image = { mediaId, alt: 'Кухня после ремонта' }

  it('фото и подпись необязательны по отдельности; по умолчанию 3 колонки, 4 : 3, ссылка', () => {
    expect(gallery.props.parse({ items: [{ image }] })).toMatchObject({
      columns: 3,
      aspect: 'landscape',
      linkToFull: true,
    })
    expect(ok(gallery.props, { items: [{ caption: 'Кухня' }], columns: 4, aspect: 'square' })).toBe(
      true,
    )
  })

  it('от 1 до 24 фото, alt обязателен, подпись до 120, только свои варианты', () => {
    expect(ok(gallery.props, { items: [] })).toBe(false)
    expect(ok(gallery.props, { items: Array(25).fill({ image }) })).toBe(false)
    expect(ok(gallery.props, { items: [{ image: { mediaId, alt: ' ' } }] })).toBe(false)
    expect(ok(gallery.props, { items: [{ caption: 'а'.repeat(121) }] })).toBe(false)
    expect(ok(gallery.props, { items: [{ image }], columns: 5 })).toBe(false)
    expect(ok(gallery.props, { items: [{ image }], aspect: 'wide' })).toBe(false)
    expect(ok(gallery.props, { items: [{ image, href: '/x' }] })).toBe(false)
  })
})

describe('«Отзывы»', () => {
  const review = { quote: 'Сделали быстро.', name: 'Анна' }

  it('текст и имя обязательны, подпись и фото — нет; по умолчанию две колонки', () => {
    expect(reviews.props.parse({ items: [review] })).toMatchObject({ columns: 2 })
    expect(
      ok(reviews.props, {
        items: [{ ...review, caption: 'Ремонт ванной', photo: { mediaId, alt: 'Анна' } }],
        columns: 1,
      }),
    ).toBe(true)
    expect(ok(reviews.props, { items: [{ name: 'Анна' }] })).toBe(false)
    expect(ok(reviews.props, { items: [{ quote: 'Хорошо' }] })).toBe(false)
  })

  it('не пускает длинный отзыв, 13 отзывов, фото без alt и оценку', () => {
    expect(ok(reviews.props, { items: [{ ...review, quote: 'а'.repeat(1001) }] })).toBe(false)
    expect(ok(reviews.props, { items: Array(13).fill(review) })).toBe(false)
    expect(ok(reviews.props, { items: [{ ...review, photo: { mediaId, alt: '' } }] })).toBe(false)
    expect(ok(reviews.props, { items: [{ ...review, rating: 5 }] })).toBe(false)
  })
})

describe('«Клиенты»', () => {
  const client = { name: 'ООО «Стройка»' }

  it('от 2 до 24 клиентов, логотип необязателен и без alt — его alt название', () => {
    expect(clients.props.parse({ items: [client, client] })).toMatchObject({ tone: 'color' })
    expect(ok(clients.props, { items: [{ ...client, logo: { mediaId } }, client] })).toBe(true)
    expect(ok(clients.props, { items: [client] })).toBe(false)
    expect(ok(clients.props, { items: Array(25).fill(client) })).toBe(false)
  })

  it('название обязательно, лишний alt у логотипа и чужой вариант — ошибка', () => {
    expect(ok(clients.props, { items: [{ name: '' }, client] })).toBe(false)
    const withAlt = { ...client, logo: { mediaId, alt: 'Лого' } }
    expect(ok(clients.props, { items: [withAlt, client] })).toBe(false)
    expect(ok(clients.props, { items: [client, client], tone: 'dark' })).toBe(false)
  })
})

describe('«Команда»', () => {
  const member = { name: 'Иван Петров' }

  it('имя обязательно, должность и фото — нет; по умолчанию портрет в 3 колонки', () => {
    expect(team.props.parse({ members: [member] })).toMatchObject({
      columns: 3,
      photoShape: 'portrait',
    })
    expect(
      ok(team.props, {
        members: [{ ...member, role: 'Прораб', photo: { mediaId, alt: 'Иван Петров' } }],
        photoShape: 'round',
      }),
    ).toBe(true)
  })

  it('от 1 до 24 человек, имя и должность до 80', () => {
    expect(ok(team.props, { members: [] })).toBe(false)
    expect(ok(team.props, { members: Array(25).fill(member) })).toBe(false)
    expect(ok(team.props, { members: [{ name: 'а'.repeat(81) }] })).toBe(false)
    expect(ok(team.props, { members: [{ ...member, role: 'а'.repeat(81) }] })).toBe(false)
    expect(ok(team.props, { members: [{ role: 'Прораб' }] })).toBe(false)
  })
})

describe('«Контакты»', () => {
  it('нужен хотя бы телефон, почта или адрес: иначе ошибка у телефона', () => {
    expect(contacts.props.parse({ phone: '+7 900 123-45-67' })).toMatchObject({
      tone: 'surface',
      mapService: 'yandex',
      markup: false,
    })
    expect(ok(contacts.props, { email: 'info@example.ru' })).toBe(true)
    expect(ok(contacts.props, { address: 'Пермь, Ленина, 50' })).toBe(true)
    expect(issuePath(contacts.props, { hours: 'Пн–Пт' })).toEqual(['phone'])
  })

  it('телефон с цифрами, почта по формату, координаты в своих пределах', () => {
    expect(ok(contacts.props, { phone: '(((((' })).toBe(false)
    expect(ok(contacts.props, { phone: '+7 900 abc' })).toBe(false)
    expect(ok(contacts.props, { email: 'почта' })).toBe(false)
    const address = 'Пермь'
    expect(ok(contacts.props, { address, coordinates: '58.0105, 56.2502' })).toBe(true)
    expect(ok(contacts.props, { address, coordinates: '95, 56' })).toBe(false)
    expect(ok(contacts.props, { address, coordinates: 'Пермь' })).toBe(false)
    expect(ok(contacts.props, { address, mapService: 'google' })).toBe(false)
    expect(ok(contacts.props, { address: 'а'.repeat(201) })).toBe(false)
  })
})
