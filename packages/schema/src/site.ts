import { z } from 'zod'

/** Название сайта: его видно только в админке */
export const SiteName = z.string().trim().min(1).max(80)

/** Что присылают в API, чтобы создать сайт. Тема пока всегда по умолчанию */
export const NewSite = z.strictObject({ name: SiteName })
export type NewSite = z.infer<typeof NewSite>
