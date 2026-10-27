import { describe, expect, it } from 'vitest'
import { isPlaceholderText, mapUrl, parseCoordinates, samePhone, telHref } from './contact'

describe('ссылка tel:', () => {
  it('только цифры и «+» в начале', () => {
    expect(telHref('+7 (342) 000-00-00')).toBe('tel:+73420000000')
    expect(telHref('8 900 123-45-67')).toBe('tel:89001234567')
  })
})

describe('координаты', () => {
  it('широта и долгота через запятую, в пределах', () => {
    expect(parseCoordinates('58.010455, 56.229443')).toEqual({ lat: 58.010455, lon: 56.229443 })
    expect(parseCoordinates('-33.9,18.4')).toEqual({ lat: -33.9, lon: 18.4 })
    expect(parseCoordinates('91, 10')).toBeUndefined()
    expect(parseCoordinates('10, 181')).toBeUndefined()
    expect(parseCoordinates('58.01 56.22')).toBeUndefined()
  })
})

describe('ссылка на карту', () => {
  const address = 'Пермь, Ленина, 50'
  const coordinates = '58.0105, 56.2502'

  it('Яндекс Карты: точка по координатам (долгота, широта), иначе поиск по адресу', () => {
    expect(mapUrl({ service: 'yandex', coordinates, address })).toBe(
      'https://yandex.ru/maps/?pt=56.2502,58.0105&z=17&l=map',
    )
    expect(mapUrl({ service: 'yandex', address })).toBe(
      `https://yandex.ru/maps/?text=${encodeURIComponent(address)}`,
    )
  })

  it('2ГИС: точка по координатам, иначе поиск', () => {
    expect(mapUrl({ service: '2gis', coordinates })).toBe('https://2gis.ru/geo/56.2502,58.0105')
    expect(mapUrl({ service: '2gis', address })).toBe(
      `https://2gis.ru/search/${encodeURIComponent(address)}`,
    )
  })

  it('ни адреса, ни координат — ссылки нет', () => {
    expect(mapUrl({ service: 'yandex' })).toBeUndefined()
    expect(mapUrl({ service: '2gis', address: '  ' })).toBeUndefined()
  })

  it('адрес-заглушка из примера («[Город, улица…]») — ссылки нет, координаты — есть', () => {
    const address = '[Город, улица, дом, офис]'
    expect(mapUrl({ service: 'yandex', address })).toBeUndefined()
    expect(mapUrl({ service: '2gis', address: ' [улица] ' })).toBeUndefined()
    expect(mapUrl({ service: 'yandex', address, coordinates: '58.0105, 56.2502' })).toBe(
      'https://yandex.ru/maps/?pt=56.2502,58.0105&z=17&l=map',
    )
  })

  it('пометка в скобках внутри настоящего адреса — не заглушка, ссылка есть', () => {
    const address = 'Пермь, Ленина, 50 [вход со двора]'
    expect(isPlaceholderText(address)).toBe(false)
    expect(mapUrl({ service: 'yandex', address })).toBe(
      `https://yandex.ru/maps/?text=${encodeURIComponent(address)}`,
    )
  })
})

describe('samePhone', () => {
  it('«8 …» и «+7 …» — один номер, в любой записи', () => {
    expect(samePhone('8 (342) 000-00-00', '+7 (342) 000-00-00')).toBe(true)
    expect(samePhone('+7 342 000 00 00', '7(342)0000000')).toBe(true)
  })

  it('разные номера и короткие номера с «8» не сводятся', () => {
    expect(samePhone('+7 342 000-00-00', '+7 342 000-00-01')).toBe(false)
    expect(samePhone('8 800', '7 800')).toBe(false)
  })
})
