import { z } from 'zod'
import { cta } from './cta'
import { faq } from './faq'
import { features } from './features'
import { form } from './form'
import { hero } from './hero'
import { pricing } from './pricing'
import { stats } from './stats'
import { steps } from './steps'
import { text } from './text'
import { textImage } from './text-image'
import { video } from './video'

// Новый блок добавляется в оба списка: в каталог (для админки и MCP) и в союз (для проверки
// страниц). Тест следит, чтобы списки не разъехались. Порядок каталога — как блоки обычно идут
// на странице сверху вниз: так их показывают «Добавить блок» и list_blocks
export const blocks = [
  hero,
  textImage,
  features,
  stats,
  steps,
  pricing,
  faq,
  cta,
  form,
  video,
  text,
] as const

export const BlockInstance = z.discriminatedUnion('type', [
  hero.instance,
  textImage.instance,
  features.instance,
  stats.instance,
  steps.instance,
  pricing.instance,
  faq.instance,
  cta.instance,
  form.instance,
  video.instance,
  text.instance,
])

export type BlockType = (typeof blocks)[number]['type']
export type BlockInstance = z.infer<typeof BlockInstance>

export { cta, faq, features, form, hero, pricing, stats, steps, text, textImage, video }
