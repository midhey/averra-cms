import { z } from 'zod'
import {
  type CustomBlockFieldsSource,
  CustomBlockKey,
  type CustomBlockPlacement,
  customBlockProps,
} from './custom-blocks'
import { collectMediaRefs } from './media'

/**
 * Свой вид шапки или подвала: ключ своего блока с местом «шапка» («подвал») и тексты его полей.
 * Ключ — вид, его выбирает владелец (header.look); поля — тексты, их правит администратор сайта
 * (header.edit). Меню, кнопка и логотип — общие поля шапки: свой вид получает их данными
 */
export const CustomPlace = z.strictObject({
  key: CustomBlockKey.meta({ title: 'Свой вид' }),
  props: z.record(z.string(), z.unknown()).default({}).meta({ title: 'Поля своего вида' }),
})
export type CustomPlace = z.infer<typeof CustomPlace>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Свой вид из базы: только знакомые ключи (более новая версия могла дописать свои). Непонятный —
 * undefined: шапка тогда стандартная, а читатель сообщает о поле
 */
export function readCustomPlace(stored: unknown): CustomPlace | null | undefined {
  if (stored === null || stored === undefined) return null
  if (!isRecord(stored)) return undefined
  const parsed = CustomPlace.safeParse({ key: stored.key, props: stored.props ?? {} })
  return parsed.success ? parsed.data : undefined
}

/** Ключ своего вида: он — часть вида шапки и подвала, его меняет только владелец */
export const customPlaceKey = (custom: CustomPlace | null) => custom?.key ?? null

/** Картинки в полях своего вида: их нельзя удалить из медиатеки, и они нужны сборке */
export const customPlaceMediaIds = (custom: CustomPlace | null | undefined) =>
  custom ? collectMediaRefs(custom.props).map((ref) => ref.mediaId) : []

const placeWords: Record<Exclude<CustomBlockPlacement, 'block'>, string> = {
  header: 'шапки',
  footer: 'подвала',
}

/**
 * Что не так со своим видом шапки или подвала: определения нет (не опубликовали или удалили),
 * оно для другого места или поля не подходят под него. Путь — от шапки: custom.key,
 * custom.props.tagline. definitions — опубликованные определения (при сохранении — и черновики)
 */
export function customPlaceIssues(
  custom: CustomPlace | null,
  placement: Exclude<CustomBlockPlacement, 'block'>,
  definitions: readonly CustomBlockFieldsSource[],
) {
  if (!custom) return []
  const definition = definitions.find((candidate) => candidate.key === custom.key)
  const word = placeWords[placement]
  if (!definition) {
    return [
      {
        path: 'custom.key',
        message: `Своего вида ${word} «${custom.key}» нет на сайте: опубликуйте его в «Свои блоки» или выберите стандартный`,
      },
    ]
  }
  if ((definition.placement ?? 'block') !== placement) {
    return [
      {
        path: 'custom.key',
        message: `«${definition.title}» — не вид ${word}: выберите свой блок с местом «${placement === 'header' ? 'Шапка сайта' : 'Подвал сайта'}»`,
      },
    ]
  }
  const result = customBlockProps(definition.fields).safeParse(custom.props)
  return (result.error?.issues ?? []).map((issue) => ({
    path: ['custom', 'props', ...issue.path.map(String)].join('.'),
    message: issue.message,
  }))
}

/** Поля своего вида после схемы определения (умолчания подставлены). null — не подходят */
export function customPlaceProps(custom: CustomPlace, definition: CustomBlockFieldsSource) {
  const result = customBlockProps(definition.fields).safeParse(custom.props)
  return result.success ? result.data : null
}
