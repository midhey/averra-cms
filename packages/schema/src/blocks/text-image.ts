import { z } from 'zod'
import { Button } from '../common'
import { defineBlock, type EnumSketch } from '../define-block'
import { Image } from '../media'

/** Текст рядом с картинкой — несколько абзацев, не страница политики: столько хватает с запасом */
export const TEXT_IMAGE_BODY_MAX = 3000

/**
 * Текст с картинкой: абзацы рядом с фото. Картинка необязательна — пример для каталога и MCP
 * обходится без медиатеки, а без картинки блок остаётся просто текстом. Разметка текста — та же
 * лёгкая, что у блока «Текст» (text-body.ts)
 */
export const textImage = defineBlock({
  type: 'text-image',
  title: 'Текст с картинкой',
  description: 'Абзацы рядом с фото, картинка слева или справа',
  category: 'about',
  props: z.strictObject({
    imagePosition: z
      .enum(['left', 'right'])
      .default('left')
      .meta({
        title: 'Картинка',
        'x-enum-titles': { left: 'Слева', right: 'Справа' },
        'x-enum-sketches': {
          left: 'image-left',
          right: 'image-right',
        } satisfies Record<string, EnumSketch>,
      }),
    title: z.string().trim().max(120).optional().meta({ title: 'Заголовок' }),
    body: z.string().trim().min(1).max(TEXT_IMAGE_BODY_MAX).meta({
      title: 'Текст',
      description:
        'Пустая строка — новый абзац. Строка с «- » — пункт списка, строка с «## » — подзаголовок',
    }),
    button: Button.optional().meta({ title: 'Кнопка' }),
    image: Image.optional().meta({
      title: 'Картинка',
      description:
        'Фото рядом с текстом, лучше 4 : 3 или квадрат. На телефоне — под текстом. Без картинки блок — просто текст',
    }),
  }),
  example: {
    title: 'О компании',
    body: '[Пара абзацев о том, кто вы и чем занимаетесь: с какого года работаете, где, для кого.]\n\n[Что отличает вас от других — коротко и по делу.]',
  },
})
