import { z } from 'zod'
import { Uuid } from './id'
import { hasHeaderBreak } from './mail'

const PreviewLinkName = z
  .string()
  .refine((name) => !hasHeaderBreak(name), 'Подпись — одной строкой, без переводов строки')
  .trim()
  .pipe(z.string().min(1, 'Укажите, для кого ссылка').max(80, 'Подпись — не длиннее 80 символов'))

export const NewPreviewLink = z.strictObject({
  name: PreviewLinkName,
  days: z.union([z.literal(1), z.literal(3), z.literal(7)]).default(3),
})

export const PreviewLinkParams = z.object({ siteId: Uuid(), id: Uuid() })
export const PreviewSiteParams = z.object({ siteId: Uuid() })
export const PreviewToken = z
  .string()
  .regex(/^preview_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[0-9a-f]{64}$/)
