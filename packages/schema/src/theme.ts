import { z } from 'zod'

// Строго #RRGGBB: значения темы попадают прямо в CSS страницы,
// поэтому произвольную строку (например, с `}</style>`) сюда не пропускаем
const Color = z.string().regex(/^#[0-9a-f]{6}$/i, 'Цвет в формате #RRGGBB')

// Пока только системные шрифты: быстро и без внешних запросов. Свои шрифты — позже
const Font = z.enum(['system', 'humanist', 'serif'])

export const Theme = z.strictObject({
  colors: z.strictObject({
    background: Color.meta({ title: 'Фон' }),
    surface: Color.meta({ title: 'Фон карточек' }),
    text: Color.meta({ title: 'Текст' }),
    muted: Color.meta({ title: 'Второстепенный текст' }),
    accent: Color.meta({ title: 'Акцент' }),
    onAccent: Color.meta({ title: 'Текст на акценте' }),
  }),
  fonts: z.strictObject({
    heading: Font.meta({ title: 'Шрифт заголовков' }),
    body: Font.meta({ title: 'Шрифт текста' }),
  }),
  radius: z
    .enum(['none', 'small', 'medium', 'large'])
    .default('medium')
    .meta({ title: 'Скругления' }),
})

export type Theme = z.infer<typeof Theme>
