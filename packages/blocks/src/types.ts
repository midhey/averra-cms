import type { BlockInstance, BlockType } from '@cms/schema'

/** Поля блока после проверки схемой: значения по умолчанию уже подставлены */
export type BlockData<T extends BlockType> = Extract<BlockInstance, { type: T }>['props']

export type BlockComponentProps<T extends BlockType> = {
  /** Id блока, он же якорь: на блок можно сослаться ссылкой #id */
  id: string
  data: BlockData<T>
  /** 1 — только у главного первого экрана, чтобы h1 на странице был один */
  headingLevel: 1 | 2
}
