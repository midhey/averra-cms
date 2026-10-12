import { z } from 'zod'
import { Button } from '../common'
import { defineBlock } from '../define-block'
import { Image } from '../media'

export const hero = defineBlock({
  type: 'hero',
  title: 'Первый экран',
  props: z
    .strictObject({
      variant: z.enum(['centered', 'left', 'split']).default('centered').meta({ title: 'Вариант' }),
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
          'Только для варианта split (текст слева, картинка справа): там она обязательна, в других вариантах её не должно быть',
      }),
    })
    // Путь — само поле: в редакторе ошибка встанет прямо у выбора картинки.
    // Картинка в другом варианте не выводится, но считалась бы «используемой»: медиатека не дала
    // бы её удалить и сослалась бы на страницу, где её не видно. Поэтому данные = то, что на экране
    .superRefine((props, ctx) => {
      if (props.variant === 'split' && !props.image) {
        ctx.addIssue({
          code: 'custom',
          path: ['image'],
          message: 'В варианте split нужна картинка: выберите её в медиатеке',
        })
      }
      if (props.variant !== 'split' && props.image) {
        ctx.addIssue({
          code: 'custom',
          path: ['image'],
          message: 'Картинка выводится только в варианте split: уберите её или выберите split',
        })
      }
    }),
  example: {
    title: 'Главная мысль страницы',
    subtitle: 'Одно-два предложения о том, чем вы полезны клиенту.',
    button: { label: 'Оставить заявку', href: '#contact' },
  },
})
