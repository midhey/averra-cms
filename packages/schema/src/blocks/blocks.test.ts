import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { BLOCK_CATEGORIES, ENUM_SKETCHES } from '../define-block'
import { splitParagraphs } from '../text-body'
import { blocks, faq, pricing, stats, steps, textImage } from './index'

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
    for (const block of [textImage, stats, steps, pricing, faq]) {
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
