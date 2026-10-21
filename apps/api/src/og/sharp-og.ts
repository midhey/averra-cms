import type { OgCard } from '@averra/schema'
import sharp from 'sharp'
import { ogCardRenderers, ogCardSvg } from './card'
import { golosShaper } from './golos'

/**
 * PNG карточки из SVG (только контуры, librsvg шрифты не ищет). Палитра: у карточки несколько
 * цветов и сглаживание краёв — PNG с палитрой втрое меньше и на глаз не отличается
 */
export async function renderOgCard(card: OgCard) {
  const svg = ogCardSvg(card, golosShaper)
  return new Uint8Array(
    await sharp(Buffer.from(svg)).png({ palette: true, compressionLevel: 9 }).toBuffer(),
  )
}

/** Карточки на sharp с кешами и очередью: их подключают index.ts и testing.ts */
export const sharpOgCards = () => ogCardRenderers(renderOgCard)
