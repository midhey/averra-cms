import { z } from 'zod'
import { MAIL_ADDRESS_PATTERN } from './mail'

// Контакты: телефон, почта и карта. Правила одни на «SEO → Организация» и блок «Контакты» — на
// сайте и в разметке для поисковиков номер и адрес пишутся по одним законам

const MAIL_ADDRESS_REGEXP = new RegExp(`^(?:${MAIL_ADDRESS_PATTERN})$`, 'v')
const PHONE_REGEXP = /^\+?[\d\s()-]{5,30}$/
const PHONE_MESSAGE = 'Телефон: цифры, пробелы, скобки и дефис, например +7 900 123-45-67'

/** Телефон или пусто — поле «SEO → Организация» */
export const OptionalPhone = z
  .string()
  .trim()
  .regex(/^(\+?[\d\s()-]{5,30})?$/, PHONE_MESSAGE)

/** Почта или пусто — поле «SEO → Организация» */
export const OptionalEmail = z
  .string()
  .trim()
  .max(254)
  .refine(
    (value) => value === '' || MAIL_ADDRESS_REGEXP.test(value),
    'Нужен адрес почты, например info@example.ru',
  )

/** Цифры номера: из них — ссылка tel: */
const phoneDigits = (phone: string) => phone.replace(/\D/g, '')

/**
 * Телефон на сайте: по нему звонят нажатием, поэтому в номере хотя бы 5 цифр — иначе ссылка tel:
 * вышла бы пустой
 */
export const PhoneNumber = z
  .string()
  .trim()
  .regex(PHONE_REGEXP, PHONE_MESSAGE)
  .refine((value) => phoneDigits(value).length >= 5, PHONE_MESSAGE)

/** Почта на сайте: по ней пишут нажатием (mailto:) */
export const EmailAddress = z
  .string()
  .trim()
  .max(254)
  .refine((value) => MAIL_ADDRESS_REGEXP.test(value), 'Нужен адрес почты, например info@example.ru')

/** Ссылка «позвонить»: только цифры и «+» в начале — так номер понимают все телефоны */
export const telHref = (phone: string) =>
  `tel:${phone.trim().startsWith('+') ? '+' : ''}${phoneDigits(phone)}`

const COORDINATES_REGEXP = /^(-?\d{1,2}(?:\.\d{1,8})?)\s*,\s*(-?\d{1,3}(?:\.\d{1,8})?)$/

/** Широта и долгота из строки «58.0105, 56.2502» — как их копируют из Яндекс Карт и 2ГИС */
export function parseCoordinates(value: string) {
  const match = COORDINATES_REGEXP.exec(value.trim())
  if (!match) return undefined
  const lat = Number(match[1])
  const lon = Number(match[2])
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : undefined
}

export const Coordinates = z
  .string()
  .trim()
  .refine(
    (value) => parseCoordinates(value) !== undefined,
    'Широта и долгота через запятую, как в Яндекс Картах: 58.0105, 56.2502',
  )

/** Сервисы карт: ссылки на них открываются и в приложении на телефоне */
export const MapService = z.enum(['yandex', '2gis'])
export type MapService = z.infer<typeof MapService>
export const mapServiceTitles = {
  yandex: 'Яндекс Карты',
  '2gis': '2ГИС',
} as const satisfies Record<MapService, string>

/**
 * Ссылка на точку на карте: по координатам — точка, иначе поиск по адресу. Порядок в адресах
 * сервисов — долгота, потом широта (проверено вживую). Нет ни координат, ни адреса — ссылки нет
 */
export function mapUrl(place: { service: MapService; coordinates?: string; address?: string }) {
  const point = place.coordinates ? parseCoordinates(place.coordinates) : undefined
  const address = place.address?.trim()
  if (place.service === '2gis') {
    if (point) return `https://2gis.ru/geo/${point.lon},${point.lat}`
    return address ? `https://2gis.ru/search/${encodeURIComponent(address)}` : undefined
  }
  if (point) return `https://yandex.ru/maps/?pt=${point.lon},${point.lat}&z=17&l=map`
  return address ? `https://yandex.ru/maps/?text=${encodeURIComponent(address)}` : undefined
}
