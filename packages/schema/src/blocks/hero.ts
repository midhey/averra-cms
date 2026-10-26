import { z } from 'zod'
import { Button } from '../common'
import { defineBlock, type EnumSketch } from '../define-block'
import { Image } from '../media'

/** Подписи вариантов первого экрана для людей: их видят карточки вариантов в редакторе */
const heroVariantTitles = {
  centered: 'По центру',
  left: 'Слева',
  split: 'С картинкой',
  cover: 'На фото',
}

/** Варианты, в которых у первого экрана есть картинка: сбоку (split) или фоном (cover) */
const withImage = new Set(['split', 'cover'])

export const hero = defineBlock({
  type: 'hero',
  title: 'Первый экран',
  description: 'Заголовок, подзаголовок и кнопка — первое, что видит посетитель',
  category: 'start',
  props: z
    .strictObject({
      variant: z
        .enum(['centered', 'left', 'split', 'cover'])
        .default('centered')
        .meta({
          title: 'Вариант',
          'x-enum-titles': heroVariantTitles,
          'x-enum-sketches': {
            centered: 'centered',
            left: 'left',
            split: 'split',
            cover: 'cover',
          } satisfies Record<string, EnumSketch>,
        }),
      title: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .meta({ title: 'Заголовок', description: 'Главная мысль страницы' }),
      subtitle: z.string().trim().max(300).optional().meta({ title: 'Подзаголовок' }),
      button: Button.optional().meta({ title: 'Кнопка' }),
      image: Image.optional().meta({
        title: 'Картинка',
        description:
          'Только для вариантов «С картинкой» (split: текст слева, картинка справа) и «На фото» (cover: фото на весь блок под затемнением, текст поверх). Там она обязательна, в других вариантах её не должно быть',
      }),
    })
    // Путь — само поле: в редакторе ошибка встанет прямо у выбора картинки.
    // Картинка в другом варианте не выводится, но считалась бы «используемой»: медиатека не дала
    // бы её удалить и сослалась бы на страницу, где её не видно. Поэтому данные = то, что на экране
    .superRefine((props, ctx) => {
      const needsImage = withImage.has(props.variant)
      if (needsImage && !props.image) {
        ctx.addIssue({
          code: 'custom',
          path: ['image'],
          message: `В варианте «${heroVariantTitles[props.variant]}» (${props.variant}) нужна картинка: выберите её в медиатеке`,
        })
      }
      if (!needsImage && props.image) {
        ctx.addIssue({
          code: 'custom',
          path: ['image'],
          message:
            'Картинка выводится только в вариантах «С картинкой» (split) и «На фото» (cover): уберите её или выберите один из них',
        })
      }
    }),
  example: {
    title: 'Главная мысль страницы',
    subtitle: 'Одно-два предложения о том, чем вы полезны клиенту.',
    button: { label: 'Оставить заявку', href: '#contact' },
  },
})
