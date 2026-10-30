// @vitest-environment happy-dom
import { CustomBlockDraft, type CustomFieldInput, starterCustomBlock } from '@averra/schema'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { catalog, customCatalog, filterCatalog, sectionsFor, sectionTitle } from '../editor/catalog'
import { createBlock } from '../editor/draft'
import { validateBlocks } from '../editor/validation'
import { SchemaForm } from '../forms/SchemaForm'
import { CodeEditor } from '../ui/CodeEditor'
import { highlightCode, lineRange } from '../ui/code-highlight'
import {
  blockStatus,
  changeFieldType,
  fieldTypesAt,
  freeKey,
  importConflicts,
  newField,
  publishedDefinitions,
  readBlocksFile,
  resolutionsOf,
  suggestKey,
} from './custom-block-format'
import { FieldsBuilder } from './FieldsBuilder'

afterEach(cleanup)

const tariffs = CustomBlockDraft.parse({
  key: 'tariffs',
  title: 'Тарифы с наклейкой',
  description: 'Тарифы карточками с наклейкой',
  category: 'sales',
  fields: [
    { type: 'text', name: 'title', label: 'Заголовок', required: true },
    { type: 'number', name: 'columns', label: 'Колонок', integer: true, min: 2, max: 4 },
  ],
  template: '<h2>{{ title }}</h2>',
  example: { title: 'Тарифы' },
})

describe('свои блоки в каталоге редактора', () => {
  const entries = [...catalog, ...customCatalog([tariffs])]

  it('тип с префиксом, раздел «Свои» в конце, свой блок — и в своём разделе схемы', () => {
    const own = entries.at(-1)
    expect(own).toMatchObject({ type: 'custom:tariffs', custom: true, category: 'sales' })
    expect(sectionsFor(entries).at(-1)).toBe('custom')
    expect(sectionsFor(catalog)).not.toContain('custom')
    expect(sectionTitle('custom')).toBe('Свои')
    expect(filterCatalog(entries, 'custom', '').map((entry) => entry.type)).toEqual([
      'custom:tariffs',
    ])
    expect(filterCatalog(entries, 'sales', 'наклейк').map((entry) => entry.type)).toEqual([
      'custom:tariffs',
    ])
  })

  it('новый блок — с примером и id по ключу', () => {
    const block = createBlock('custom:tariffs', [], entries)
    expect(block).toEqual({ id: 'tariffs-1', type: 'custom:tariffs', props: { title: 'Тарифы' } })
  })

  it('проверка страницы — по определению: ошибка у поля, без определения — у блока', () => {
    const block = { id: 'tariffs-1', type: 'custom:tariffs', props: { title: '', columns: 5 } }
    const result = validateBlocks([block], [tariffs])
    expect(Object.keys(result.blockErrors['tariffs-1'] ?? {}).sort()).toEqual(['columns', 'title'])
    expect(validateBlocks([block], []).blockErrors['tariffs-1']?.['']).toMatch(/нет на сайте/)
    const ok = validateBlocks([{ ...block, props: { title: 'Цены' } }], [tariffs])
    expect(ok.content?.blocks[0]?.props).toEqual({ title: 'Цены' })
  })
})

describe('форма своего блока: число', () => {
  function NumberForm() {
    const [value, setValue] = useState<Record<string, unknown>>({ title: 'x' })
    const schema = customCatalog([tariffs])[0]?.schema ?? {}
    return (
      <>
        <SchemaForm schema={schema} value={value} errors={{}} onChange={setValue} />
        <output>{JSON.stringify(value)}</output>
      </>
    )
  }

  it('цифровая клавиатура, пределы в подсказке, значение — числом', async () => {
    render(<NumberForm />)
    const input = screen.getByRole('textbox', { name: /Колонок/ })
    expect(input.getAttribute('inputmode')).toBe('numeric')
    expect(screen.getByText(/от 2 до 4/)).toBeTruthy()
    await userEvent.type(input, '3')
    expect(JSON.parse(document.querySelector('output')?.textContent ?? '{}')).toEqual({
      title: 'x',
      columns: 3,
    })
  })
})

describe('поле кода', () => {
  it('подсветка Liquid, HTML и CSS по кускам, текст не теряется', () => {
    const template = '<a href="{{ url }}">{% if x %}Да{% endif %}</a>'
    const tokens = highlightCode(template, 'liquid')
    expect(tokens.map((token) => token.text).join('')).toBe(template)
    expect(tokens.filter((token) => token.kind === 'liquid').map((token) => token.text)).toEqual([
      '{{ url }}',
      '{% if x %}',
      '{% endif %}',
    ])
    const css = '.a { color: var(--color-text); } /* x */'
    const cssTokens = highlightCode(css, 'css')
    expect(cssTokens.map((token) => token.text).join('')).toBe(css)
    expect(cssTokens.find((token) => token.kind === 'property')?.text).toBe('color')
    expect(lineRange('a\nbc\nd', 2)).toEqual({ start: 2, end: 4 })
  })

  it('настоящее поле с подписью; Tab уходит дальше; строка с ошибкой отмечена знаком', async () => {
    function Example() {
      const [value, setValue] = useState('<p>\n<script></script>')
      return (
        <>
          <CodeEditor
            label="Шаблон"
            language="liquid"
            value={value}
            onChange={setValue}
            marks={new Map([[2, 'error']])}
          />
          <button type="button">Дальше</button>
        </>
      )
    }
    render(<Example />)
    const field = screen.getByRole('textbox', { name: 'Шаблон' })
    await userEvent.click(field)
    await userEvent.keyboard('{End}!')
    expect((field as HTMLTextAreaElement).value).toContain('!')
    await userEvent.tab()
    expect(document.activeElement?.textContent).toBe('Дальше')
    expect(document.body.textContent).toContain('! 2')
  })
})

describe('конструктор полей', () => {
  it('добавить, сменить вид, вложить поле в повторитель', async () => {
    function Builder() {
      const [fields, setFields] = useState<CustomFieldInput[]>([])
      return (
        <>
          <FieldsBuilder fields={fields} onChange={setFields} errors={{}} path="fields" />
          <output>{JSON.stringify(fields)}</output>
        </>
      )
    }
    render(<Builder />)
    await userEvent.click(screen.getByRole('button', { name: 'Добавить поле' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Вид' }), 'repeater')
    await userEvent.click(screen.getByRole('button', { name: 'Добавить поле внутрь' }))
    const fields = JSON.parse(document.querySelector('output')?.textContent ?? '[]')
    expect(fields).toMatchObject([
      {
        type: 'repeater',
        name: 'title',
        fields: [{ name: 'title' }, { type: 'text', name: 'title_2' }],
      },
    ])
    expect(CustomBlockDraft.safeParse({ ...tariffs, fields }).success).toBe(true)
  })

  it('числовые настройки: минус и дробь набираются с клавиатуры', async () => {
    function Builder() {
      const [fields, setFields] = useState<CustomFieldInput[]>([
        { type: 'number', name: 'score', label: 'Оценка', required: false },
      ])
      return (
        <>
          <FieldsBuilder fields={fields} onChange={setFields} errors={{}} path="fields" />
          <output>{JSON.stringify(fields)}</output>
        </>
      )
    }
    render(<Builder />)
    const min = screen.getByRole('textbox', { name: 'Не меньше' })
    await userEvent.type(min, '-10')
    expect((min as HTMLInputElement).value).toBe('-10')
    const max = screen.getByRole('textbox', { name: 'Не больше' })
    await userEvent.type(max, '0,5')
    expect((max as HTMLInputElement).value).toBe('0,5')
    const fields = JSON.parse(document.querySelector('output')?.textContent ?? '[]')
    expect(fields[0]).toMatchObject({ min: -10, max: 0.5 })
  })

  it('«Опустить» с клавиатуры: фокус уезжает вместе с полем, поле опускается до конца', async () => {
    function Builder() {
      const [fields, setFields] = useState<CustomFieldInput[]>([
        { type: 'text', name: 'title', label: 'Заголовок', required: false },
        { type: 'text', name: 'text', label: 'Текст', required: false },
        { type: 'text', name: 'note', label: 'Сноска', required: false },
      ])
      return (
        <>
          <FieldsBuilder fields={fields} onChange={setFields} errors={{}} path="fields" />
          <output>{JSON.stringify(fields.map((field) => field.name))}</output>
        </>
      )
    }
    render(<Builder />)
    screen.getByRole('button', { name: 'Опустить поле «Заголовок»' }).focus()
    await userEvent.keyboard('{Enter}')
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Опустить поле «Заголовок»' }),
    )
    await userEvent.keyboard('{Enter}')
    expect(document.querySelector('output')?.textContent).toBe('["text","note","title"]')
    // На краю «Опустить» закрыта — фокус на «Поднять» того же поля
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Поднять поле «Заголовок»' }),
    )
  })

  it('при 60 полях во всём блоке «Добавить поле» закрыто с пояснением', () => {
    const group = (name: string, count: number): CustomFieldInput => ({
      type: 'group',
      name,
      label: name,
      required: false,
      fields: Array.from({ length: count }, (_, i) => ({
        type: 'text' as const,
        name: `f${i}`,
        label: `f${i}`,
        required: false,
        maxLength: 120,
      })),
    })
    // 2 группы по 29 полей и сами группы: 60 во всём блоке при 2 на верхнем уровне
    render(
      <FieldsBuilder
        fields={[group('a', 29), group('b', 29)]}
        onChange={() => {}}
        errors={{}}
        path="fields"
      />,
    )
    expect(
      screen.getAllByRole('button', { name: 'Добавить поле' })[0]?.getAttribute('aria-disabled'),
    ).toBe('true')
    expect(screen.getAllByText('Во всём блоке не больше 60 полей').length).toBeGreaterThan(0)
  })

  it('на последнем уровне нет повторителя и группы', () => {
    expect(fieldTypesAt(1)).toContain('repeater')
    expect(fieldTypesAt(3)).not.toContain('repeater')
    expect(fieldTypesAt(3)).not.toContain('group')
  })
})

describe('форматы своих блоков', () => {
  it('ключ из названия и свободный ключ', () => {
    expect(suggestKey('Тарифы с наклейкой')).toBe('tarify-s-nakleykoy')
    expect(suggestKey('123')).toBe('block')
    expect(freeKey('tariffs', new Set(['tariffs', 'tariffs-2']))).toBe('tariffs-3')
  })

  it('новое поле и смена вида: ключ и подпись остаются, настройки — вида', () => {
    const text = newField('text', [{ type: 'text', name: 'title', label: 'A' }])
    expect(text).toMatchObject({ type: 'text', name: 'title_2', maxLength: 120 })
    expect(changeFieldType({ ...text, label: 'Цена' }, 'number')).toEqual({
      type: 'number',
      name: 'title_2',
      label: 'Цена',
      required: false,
      integer: false,
    })
  })

  it('файл переноса: понятные ошибки, конфликты с предложенным именем', () => {
    expect(readBlocksFile('{').ok).toBe(false)
    expect(readBlocksFile('{"format":"x"}')).toMatchObject({ ok: false })
    const file = JSON.stringify({ format: 'averra.custom-blocks', version: 1, blocks: [tariffs] })
    const result = readBlocksFile(file)
    expect(result.ok).toBe(true)
    const conflicts = importConflicts([tariffs], new Set(['tariffs']))
    expect(conflicts).toEqual({ tariffs: { action: 'rename', rename: 'tariffs-2' } })
    expect(resolutionsOf(conflicts)).toEqual({ tariffs: { rename: 'tariffs-2' } })
    expect(resolutionsOf({ tariffs: { action: 'replace', rename: '' } })).toEqual({
      tariffs: 'replace',
    })
  })

  it('состояние и опубликованные определения', () => {
    expect(blockStatus({ published: false, unpublished: true }).text).toBe('Не опубликован')
    expect(blockStatus({ published: true, unpublished: true }).tone).toBe('warning')
    expect(blockStatus({ published: true, unpublished: false, unsaved: true }).text).toBe(
      'Не сохранено',
    )
    const starter = starterCustomBlock('promo', 'Промо')
    expect(publishedDefinitions([{ published: starter }, { published: null }])).toHaveLength(1)
  })
})
