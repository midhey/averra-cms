import { z } from 'zod'
import { Coordinates, EmailAddress, MapService, mapServiceTitles, PhoneNumber } from '../contact'
import { defineBlock } from '../define-block'
import { Image } from '../media'

/** Подписи оформления для людей: короткие, поэтому в редакторе — сегментами */
const contactsToneTitles = { surface: 'На подложке', plain: 'Без подложки' }

/**
 * Контакты: телефон, почта, адрес, часы и ссылка на карту. Чужая карта не встраивается: она
 * ставит cookie до согласия посетителя — поэтому ссылка «Открыть на карте» и, по желанию,
 * статичная картинка карты из медиатеки. Разметка для поисковиков — та же организация, что в
 * «SEO → Организация», дополненная данными блока (рендерер, organizationJsonLd)
 */
export const contacts = defineBlock({
  type: 'contacts',
  title: 'Контакты',
  description: 'Адрес, телефон, почта, часы работы и ссылка на карту',
  category: 'contact',
  props: z
    .strictObject({
      title: z.string().trim().max(120).optional().meta({ title: 'Заголовок' }),
      text: z.string().trim().max(300).optional().meta({
        title: 'Текст',
        description: 'Например, «Перезвоним в течение часа в рабочее время»',
      }),
      tone: z
        .enum(['surface', 'plain'])
        .default('surface')
        .meta({ title: 'Оформление', 'x-enum-titles': contactsToneTitles }),
      phone: PhoneNumber.optional().meta({
        title: 'Телефон',
        description: 'На телефоне номер нажимается — и сразу звонок',
      }),
      email: EmailAddress.optional().meta({ title: 'Почта' }),
      address: z.string().trim().max(200).optional().meta({
        title: 'Адрес',
        description: 'Город, улица, дом, офис — по нему карта найдёт место',
      }),
      hours: z.string().trim().max(120).optional().meta({
        title: 'Часы работы',
        description: 'Как удобно читать: «Пн–Сб, 9:00–19:00»',
      }),
      mapService: MapService.default('yandex').meta({
        title: 'Карта',
        description: 'Куда ведёт ссылка «Открыть на карте». Без адреса и координат ссылки нет',
        'x-enum-titles': mapServiceTitles,
      }),
      coordinates: Coordinates.optional().meta({
        title: 'Координаты',
        description:
          'Широта и долгота через запятую, как в Яндекс Картах: 58.0105, 56.2502. Точнее адреса',
      }),
      mapImage: Image.optional().meta({
        title: 'Картинка карты',
        description: 'Снимок карты или схема проезда из медиатеки. Живую карту не встраиваем',
      }),
      markup: z.boolean().default(false).meta({
        title: 'Разметка для поисковиков',
        description:
          'Добавит на страницу организацию из «SEO → Организация», а адрес, телефон и почту возьмёт отсюда, если там их нет. Без названия организации в «SEO» разметки не будет',
      }),
    })
    // Блок без единого способа связаться пуст. Ошибка — у телефона: с него обычно начинают
    .superRefine((props, ctx) => {
      if (!props.phone && !props.email && !props.address) {
        ctx.addIssue({
          code: 'custom',
          path: ['phone'],
          message: 'Укажите телефон, почту или адрес: иначе блоку нечего показать',
        })
      }
    }),
  example: {
    title: 'Контакты',
    address: '[Город, улица, дом, офис]',
    hours: '[Дни и часы работы]',
  },
})
