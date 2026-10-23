import { z } from 'zod'
import { clients } from './clients'
import { contacts } from './contacts'
import { cta } from './cta'
import { faq } from './faq'
import { features } from './features'
import { form } from './form'
import { gallery } from './gallery'
import { hero } from './hero'
import { pricing } from './pricing'
import { reviews } from './reviews'
import { stats } from './stats'
import { steps } from './steps'
import { team } from './team'
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
  gallery,
  reviews,
  clients,
  team,
  faq,
  cta,
  form,
  contacts,
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
  gallery.instance,
  reviews.instance,
  clients.instance,
  team.instance,
  faq.instance,
  cta.instance,
  form.instance,
  contacts.instance,
  video.instance,
  text.instance,
])

export type BlockType = (typeof blocks)[number]['type']
export type BlockInstance = z.infer<typeof BlockInstance>

export {
  clients,
  contacts,
  cta,
  faq,
  features,
  form,
  gallery,
  hero,
  pricing,
  reviews,
  stats,
  steps,
  team,
  text,
  textImage,
  video,
}
