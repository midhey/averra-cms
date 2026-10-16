import { z } from 'zod'
import { cta } from './cta'
import { features } from './features'
import { form } from './form'
import { hero } from './hero'

// Новый блок добавляется в оба списка: в каталог (для админки и MCP) и в союз (для проверки
// страниц). Тест следит, чтобы списки не разъехались
export const blocks = [hero, features, cta, form] as const

export const BlockInstance = z.discriminatedUnion('type', [
  hero.instance,
  features.instance,
  cta.instance,
  form.instance,
])

export type BlockType = (typeof blocks)[number]['type']
export type BlockInstance = z.infer<typeof BlockInstance>

export { cta, features, form, hero }
