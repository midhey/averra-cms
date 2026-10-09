import { describe, expect, it } from 'vitest'
import type { EditorBlock } from './draft'
import { validateBlocks } from './validation'

describe('validateBlocks', () => {
  it('пропускает правильную страницу и подставляет значения по умолчанию', () => {
    const result = validateBlocks([{ id: 'hero-1', type: 'hero', props: { title: 'Привет' } }])
    expect(result.content?.blocks[0]).toMatchObject({ props: { variant: 'centered' } })
  })

  it('раскладывает ошибки по блокам и полям', () => {
    const blocks: EditorBlock[] = [
      { id: 'hero-1', type: 'hero', props: { title: 'Привет' } },
      {
        id: 'cta-1',
        type: 'cta',
        props: { title: '', button: { label: 'Жми', href: 'javascript:alert(1)' } },
      },
    ]
    const result = validateBlocks(blocks)
    expect(result.content).toBeNull()
    expect(Object.keys(result.blockErrors)).toEqual(['cta-1'])
    expect(Object.keys(result.blockErrors['cta-1'] ?? {}).sort()).toEqual(['button.href', 'title'])
  })

  it('ловит ошибки страницы целиком: повтор id', () => {
    const block: EditorBlock = { id: 'same', type: 'hero', props: { title: 'Привет' } }
    expect(validateBlocks([block, block]).pageErrors).toHaveLength(1)
  })
})
