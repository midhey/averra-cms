import { describe, expect, it } from 'vitest'
import { createBlock, type EditorBlock, insertBlock, moveBlock, removeBlock } from './draft'

const list: EditorBlock[] = [
  { id: 'hero-1', type: 'hero', props: { title: 'Первый' } },
  { id: 'cta-1', type: 'cta', props: { title: 'Последний' } },
]
const ids = (blocks: readonly EditorBlock[]) => blocks.map((block) => block.id)

describe('черновик страницы', () => {
  it('создаёт блок с примером содержимого и свободным id', () => {
    const block = createBlock('hero', list)
    expect(block.id).toBe('hero-2')
    expect(block.props.title).toBeTypeOf('string')
  })

  it('вставляет блок после выбранного, а без выбора — в конец', () => {
    const block = createBlock('features', list)
    expect(ids(insertBlock(list, block, 'hero-1'))).toEqual(['hero-1', 'features-1', 'cta-1'])
    expect(ids(insertBlock(list, block))).toEqual(['hero-1', 'cta-1', 'features-1'])
  })

  it('двигает блоки и не выходит за края списка', () => {
    expect(ids(moveBlock(list, 'cta-1', -1))).toEqual(['cta-1', 'hero-1'])
    expect(moveBlock(list, 'hero-1', -1)).toBe(list)
  })

  it('удаляет блок', () => {
    expect(ids(removeBlock(list, 'hero-1'))).toEqual(['cta-1'])
  })
})
