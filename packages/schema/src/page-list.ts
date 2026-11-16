import { z } from 'zod'

export const PageState = z.enum(['draft', 'published', 'unpublished'])

export const PageListFilters = z.object({
  q: z.string().trim().max(200).optional(),
  state: PageState.optional(),
})

export const PAGE_LIST_DEFAULT = 20
export const PAGE_LIST_MAX = 100

const integerQuery = (max: number, min: number) =>
  z
    .string()
    .regex(/^\d{1,10}$/u, 'Нужно целое число')
    .transform(Number)
    .pipe(z.number().int().min(min).max(max))

// Без параметров остаётся полный массив: его уже читают админка и старые клиенты.
export const PageListQuery = PageListFilters.extend({
  limit: integerQuery(PAGE_LIST_MAX, 1).optional(),
  offset: integerQuery(2_147_483_647, 0).optional(),
})
export type PageListQuery = z.output<typeof PageListQuery>
