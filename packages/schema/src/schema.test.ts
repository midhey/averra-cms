import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { BlockInstance, blocks, hero } from './blocks'
import { ENUM_SKETCHES } from './define-block'
import { demoPage } from './demo'
import { PageContent } from './page'

const validPage = {
  blocks: [
    { id: 'hero-1', type: 'hero', props: { title: 'Ремонт квартир под ключ' } },
    {
      id: 'features-1',
      type: 'features',
      props: { items: [{ title: 'Смета за день' }, { title: 'Гарантия 3 года' }] },
    },
    {
      id: 'cta-1',
      type: 'cta',
      props: { title: 'Рассчитаем стоимость', button: { label: 'Оставить заявку', href: '#form' } },
    },
  ],
}

describe('PageContent', () => {
  it('принимает корректную страницу и подставляет значения по умолчанию', () => {
    const page = PageContent.parse(validPage)
    expect(page.blocks[0]).toMatchObject({ type: 'hero', props: { variant: 'centered' } })
    expect(page.blocks[1]).toMatchObject({ type: 'features', props: { columns: 3 } })
  })

  it('не принимает неизвестный тип блока', () => {
    const page = { blocks: [{ id: 'x', type: 'slider', props: {} }] }
    expect(PageContent.safeParse(page).success).toBe(false)
  })

  it('не принимает лишние поля: опечатка не пройдёт молча', () => {
    const page = { blocks: [{ id: 'h', type: 'hero', props: { title: 'Ок', titel: 'Опечатка' } }] }
    expect(PageContent.safeParse(page).success).toBe(false)
  })

  it('не принимает javascript: в ссылках', () => {
    const button = { label: 'Жми', href: 'javascript:alert(1)' }
    const page = { blocks: [{ id: 'c', type: 'cta', props: { title: 'Жми', button } }] }
    expect(PageContent.safeParse(page).success).toBe(false)
  })

  it('не принимает повторяющиеся id блоков', () => {
    const [first] = validPage.blocks
    expect(PageContent.safeParse({ blocks: [first, first] }).success).toBe(false)
  })

  it('демо-лендинг всегда проходит схему', () => {
    expect(PageContent.safeParse(demoPage).success).toBe(true)
  })
})

describe('каталог блоков', () => {
  it('у каждого блока пример заполнения проходит его же схему', () => {
    for (const block of blocks) expect(block.props.safeParse(block.example).success).toBe(true)
  })

  it('совпадает с союзом, по которому проверяются страницы', () => {
    const inUnion = BlockInstance.options.map((option) => option.shape.type.value)
    expect(inUnion).toEqual(blocks.map((block) => block.type))
  })

  it('у каждого блока есть описание одной фразой: его видят каталог в редакторе и MCP', () => {
    for (const block of blocks) {
      expect(block.description.trim().length, block.type).toBeGreaterThan(10)
      expect(block.description, block.type).not.toMatch(/\.$/)
    }
  })

  it('у вариантов оформления подпись и миниатюра есть для каждого значения', () => {
    const variant = z.toJSONSchema(hero.props, { io: 'input' }).properties?.variant as {
      enum: string[]
      'x-enum-titles': Record<string, string>
      'x-enum-sketches': Record<string, string>
    }
    for (const value of variant.enum) {
      expect(variant['x-enum-titles'][value], value).toBeTruthy()
      expect(ENUM_SKETCHES, value).toContain(variant['x-enum-sketches'][value])
    }
  })

  it('отдаёт JSON Schema с подписями полей: из неё возьмут подписи админка и MCP', () => {
    expect(z.toJSONSchema(hero.props)).toMatchObject({
      properties: { title: { title: 'Заголовок' } },
    })
  })
})
