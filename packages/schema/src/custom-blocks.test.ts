import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  applyCustomBlocks,
  CUSTOM_BLOCK_LIMITS,
  CustomBlockDraft,
  type CustomBlockDraftInput,
  CustomBlockKey,
  CustomBlocksFile,
  type CustomFieldInput,
  customBlockKeysOf,
  customBlockProps,
  exampleIssues,
  isCustomBlockType,
  PageBlock,
  starterCustomBlock,
} from './custom-blocks'
import { PageContent } from './page'

const mediaId = '3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b'

/** Тарифы с наклейкой — пример из документации: все виды полей */
const tariffs: CustomBlockDraftInput = {
  key: 'tariffs',
  title: 'Тарифы с наклейкой',
  description: 'Тарифы карточками, у тарифа — наклейка',
  fields: [
    { type: 'text', name: 'title', label: 'Заголовок', required: true, maxLength: 80 },
    { type: 'textarea', name: 'intro', label: 'Вступление', maxLength: 100 },
    {
      type: 'number',
      name: 'columns',
      label: 'Колонок',
      integer: true,
      min: 2,
      max: 4,
      default: 3,
    },
    { type: 'boolean', name: 'dark', label: 'Тёмный фон' },
    {
      type: 'select',
      name: 'align',
      label: 'Выравнивание',
      options: [
        { value: 'left', label: 'Слева' },
        { value: 'center', label: 'По центру' },
      ],
    },
    { type: 'image', name: 'photo', label: 'Фото' },
    {
      type: 'repeater',
      name: 'plans',
      label: 'Тарифы',
      min: 1,
      max: 4,
      fields: [
        { type: 'text', name: 'name', label: 'Название', required: true },
        { type: 'text', name: 'sticker', label: 'Наклейка', maxLength: 20 },
        { type: 'link', name: 'button', label: 'Кнопка' },
        {
          type: 'group',
          name: 'price',
          label: 'Цена',
          required: true,
          fields: [{ type: 'number', name: 'amount', label: 'Сумма', required: true, min: 0 }],
        },
      ],
    },
  ],
  template: '<h2>{{ title }}</h2>',
  example: { title: 'Тарифы', plans: [{ name: 'Базовый', price: { amount: 100 } }] },
}

const draft = CustomBlockDraft.parse(tariffs)
const props = customBlockProps(draft.fields)

describe('ключ своего блока', () => {
  it('латиница, цифры, дефис между ними; export и import заняты', () => {
    expect(CustomBlockKey.safeParse('tariffs-2').success).toBe(true)
    for (const bad of ['Tariffs', 'тарифы', '-a', 'a-', 'a--b', '2ab', 'export', 'x']) {
      expect(CustomBlockKey.safeParse(bad).success, bad).toBe(false)
    }
  })

  it('тип на странице — с префиксом, встроенные им не бывают', () => {
    expect(isCustomBlockType('custom:tariffs')).toBe(true)
    expect(isCustomBlockType('hero')).toBe(false)
  })
})

describe('Zod-схема из определения', () => {
  it('умолчания, обязательность и типы всех полей', () => {
    const data = props.parse({ title: ' Тарифы ', plans: [{ name: 'A', price: { amount: 5 } }] })
    expect(data).toEqual({
      title: 'Тарифы',
      columns: 3,
      dark: false,
      align: 'left',
      plans: [{ name: 'A', price: { amount: 5 } }],
    })
    expect(props.safeParse({ plans: [{ name: 'A', price: { amount: 5 } }] }).success).toBe(false)
  })

  it('ошибка — у поля, по пути внутри повторителя и группы', () => {
    const result = props.safeParse({
      title: 'x',
      plans: [{ name: 'A', price: { amount: -1 } }],
    })
    expect(result.error?.issues[0]?.path).toEqual(['plans', 0, 'price', 'amount'])
  })

  it('пределы: длина текста, число, целое, список повторителя, лишние поля', () => {
    const plan = { name: 'A', price: { amount: 1 } }
    expect(props.safeParse({ title: 'x'.repeat(81), plans: [plan] }).success).toBe(false)
    expect(props.safeParse({ title: 'x', columns: 5, plans: [plan] }).success).toBe(false)
    expect(props.safeParse({ title: 'x', columns: 2.5, plans: [plan] }).success).toBe(false)
    expect(props.safeParse({ title: 'x', plans: [] }).success).toBe(false)
    expect(props.safeParse({ title: 'x', plans: Array(5).fill(plan) }).success).toBe(false)
    expect(props.safeParse({ title: 'x', plans: [plan], extra: 1 }).success).toBe(false)
    expect(props.safeParse({ title: 'x', align: 'right', plans: [plan] }).success).toBe(false)
  })

  it('ссылка — по правилам встроенных, картинка — с alt', () => {
    const plan = { name: 'A', price: { amount: 1 } }
    const withButton = (href: string) =>
      props.safeParse({ title: 'x', plans: [{ ...plan, button: { label: 'Купить', href } }] })
    for (const href of ['/ceny/', '#contact', 'https://a.ru', 'tel:+7900', 'mailto:a@b.ru']) {
      expect(withButton(href).success, href).toBe(true)
    }
    expect(withButton('javascript:alert(1)').success).toBe(false)
    expect(props.safeParse({ title: 'x', plans: [plan], photo: { mediaId } }).success).toBe(false)
    expect(
      props.safeParse({ title: 'x', plans: [plan], photo: { mediaId, alt: 'Офис' } }).success,
    ).toBe(true)
  })

  it('JSON Schema понятна форме: подписи, многострочный текст, виджет картинки', () => {
    const schema = z.toJSONSchema(props, { io: 'input' }) as {
      properties: Record<string, Record<string, unknown>>
      required: string[]
    }
    expect(schema.properties.title?.title).toBe('Заголовок')
    expect(schema.properties.intro?.['x-multiline']).toBe(true)
    expect(schema.properties.photo?.['x-widget']).toBe('image')
    expect(schema.properties.align?.['x-enum-titles']).toEqual({
      left: 'Слева',
      center: 'По центру',
    })
    expect(schema.required).toEqual(['title', 'plans'])
  })
})

describe('структура определения', () => {
  const withFields = (fields: CustomFieldInput[]) =>
    CustomBlockDraft.safeParse({ ...tariffs, fields, example: {} })
  const firstIssue = (fields: CustomFieldInput[]) => withFields(fields).error?.issues[0]

  it('ключи полей уникальны на уровне и не заняты Liquid', () => {
    const text = { type: 'text', name: 'a', label: 'A' } as const
    expect(firstIssue([text, text])?.path).toEqual(['fields', 1, 'name'])
    expect(firstIssue([{ ...text, name: 'block' }])?.path).toEqual(['fields', 0, 'name'])
    expect(
      withFields([text, { type: 'group', name: 'g', label: 'G', fields: [text] }]).success,
    ).toBe(true)
  })

  it('вложенность — не больше трёх уровней', () => {
    const leaf: CustomFieldInput = { type: 'text', name: 'a', label: 'A' }
    const level3: CustomFieldInput = { type: 'group', name: 'c', label: 'C', fields: [leaf] }
    const level2 = (fields: CustomFieldInput[]): CustomFieldInput => ({
      type: 'group',
      name: 'b',
      label: 'B',
      fields,
    })
    const level1 = (fields: CustomFieldInput[]): CustomFieldInput => ({
      type: 'repeater',
      name: 'a',
      label: 'A',
      fields,
    })
    expect(firstIssue([level1([level2([level3])])])?.message).toMatch(/не больше 3 уровней/)
    expect(withFields([level1([level2([leaf])])]).success).toBe(true)
  })

  it('полей не больше предела во всём блоке', () => {
    const group = (n: number) => ({
      type: 'group' as const,
      name: `g${n}`,
      label: 'G',
      fields: Array.from({ length: 20 }, (_, i) => ({
        type: 'text' as const,
        name: `f${i}`,
        label: 'F',
      })),
    })
    const issue = firstIssue([group(1), group(2), group(3)])
    expect(issue?.message).toMatch(new RegExp(`не больше ${CUSTOM_BLOCK_LIMITS.fields}`))
  })

  it('настройки поля согласованы: мин ≤ макс, умолчание в пределах и из списка', () => {
    expect(firstIssue([{ type: 'number', name: 'n', label: 'N', min: 5, max: 1 }])?.path).toEqual([
      'fields',
      0,
      'min',
    ])
    expect(
      firstIssue([{ type: 'number', name: 'n', label: 'N', max: 1, default: 5 }])?.path,
    ).toEqual(['fields', 0, 'default'])
    expect(
      firstIssue([
        {
          type: 'select',
          name: 's',
          label: 'S',
          options: [
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
          ],
          default: 'c',
        },
      ])?.path,
    ).toEqual(['fields', 0, 'default'])
  })

  it('шаблон и CSS — не длиннее предела', () => {
    const long = 'x'.repeat(CUSTOM_BLOCK_LIMITS.template + 1)
    expect(CustomBlockDraft.safeParse({ ...tariffs, template: long }).success).toBe(false)
    expect(CustomBlockDraft.safeParse({ ...tariffs, css: long }).success).toBe(false)
  })

  it('пример проверяется схемой блока, ошибка — с путём от example', () => {
    expect(exampleIssues(draft)).toEqual([])
    expect(exampleIssues({ ...draft, example: { plans: [] } }).map((issue) => issue.path)).toEqual([
      'example.title',
      'example.plans',
    ])
  })

  it('заготовка нового блока проходит схему и пример', () => {
    const starter = starterCustomBlock('promo', 'Промо')
    expect(exampleIssues(starter)).toEqual([])
  })

  it('файл переноса: формат и версия', () => {
    const file = { format: 'averra.custom-blocks', version: 1, blocks: [tariffs] }
    expect(CustomBlocksFile.safeParse(file).success).toBe(true)
    expect(CustomBlocksFile.safeParse({ ...file, version: 2 }).success).toBe(false)
    expect(CustomBlocksFile.safeParse({ ...file, format: 'x' }).success).toBe(false)
  })

  it('файл с двумя блоками одного ключа — понятная ошибка; слишком большой пример — тоже', () => {
    const twice = CustomBlocksFile.safeParse({
      format: 'averra.custom-blocks',
      version: 1,
      blocks: [tariffs, tariffs],
    })
    expect(twice.success).toBe(false)
    expect(twice.error?.issues[0]?.message).toMatch(/повторяется/)
    const big = CustomBlockDraft.safeParse({ ...tariffs, example: { x: 'я'.repeat(100_001) } })
    expect(big.success).toBe(false)
    expect(big.error?.issues[0]?.message).toMatch(/слишком большой/)
  })
})

describe('свой блок на странице', () => {
  const hero = { id: 'hero', type: 'hero', props: { title: 'Привет' } }
  const own = { id: 'tariffs-1', type: 'custom:tariffs', props: draft.example }

  it('PageContent пускает свой блок с объектом полей', () => {
    expect(PageContent.safeParse({ blocks: [hero, own] }).success).toBe(true)
    expect(PageContent.safeParse({ blocks: [{ ...own, type: 'custom:Bad' }] }).success).toBe(false)
  })

  it('ошибка встроенного блока остаётся у поля, а не «ни один вариант»', () => {
    const result = PageBlock.safeParse({ id: 'h', type: 'hero', props: { title: '' } })
    expect(result.error?.issues[0]?.path).toEqual(['props', 'title'])
    const missing = PageBlock.safeParse({ id: 'h', type: 'hero', props: {} })
    expect(missing.error?.issues[0]?.path).toEqual(['props', 'title'])
  })

  it('JSON Schema блока страницы — встроенные и свой', () => {
    const schema = z.toJSONSchema(PageBlock, { io: 'input' }) as { anyOf: unknown[] }
    expect(schema.anyOf).toHaveLength(2)
  })

  it('applyCustomBlocks: умолчания, ошибки с путём от страницы, неопубликованный блок', () => {
    const content = PageContent.parse({ blocks: [hero, own] })
    const ok = applyCustomBlocks(content, [draft])
    expect(ok.issues).toEqual([])
    expect(ok.content.blocks[1]?.props).toMatchObject({ columns: 3, align: 'left' })

    const bad = PageContent.parse({ blocks: [hero, { ...own, props: { plans: [] } }] })
    expect(applyCustomBlocks(bad, [draft]).issues.map((issue) => issue.path.join('.'))).toEqual([
      'blocks.1.props.title',
      'blocks.1.props.plans',
    ])
    expect(applyCustomBlocks(content, []).issues[0]?.message).toMatch(/нет на сайте/)
    expect(customBlockKeysOf(content)).toEqual(['tariffs'])
  })
})
