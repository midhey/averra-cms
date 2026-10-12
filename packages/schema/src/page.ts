import { z } from 'zod'
import { BlockInstance } from './blocks'

export const PageContent = z
  .strictObject({
    blocks: z.array(BlockInstance).max(50),
  })
  .refine((page) => new Set(page.blocks.map((block) => block.id)).size === page.blocks.length, {
    error: 'Id блоков на странице должны быть уникальными',
    path: ['blocks'],
  })

/** Страница после проверки: значения по умолчанию уже подставлены */
export type PageContent = z.infer<typeof PageContent>
/** Что можно прислать в API: поля со значениями по умолчанию необязательны */
export type PageContentInput = z.input<typeof PageContent>

/** Заголовок страницы (тег title). Одна схема для API и для поля в редакторе */
export const PageTitle = z.string().trim().min(1).max(120)
