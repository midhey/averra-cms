import { z } from 'zod'

// Способ связи в форме: у варианта выбора («Telegram», «Телефон») бывает вид связи, а поле
// «контакт» проверяется по виду выбранного варианта. Без этого «Telegram» и «ab» уходило бы
// в заявку, по которой не связаться. Правила — те же, что у самописной формы, с которой часто
// переезжают на Averra (examples/le-english)

/** Виды связи: закрытый список, своих видов вариант не придумывает */
export const contactKinds = ['telegram', 'vk', 'phone', 'email'] as const
export const ContactKind = z.enum(contactKinds)
export type ContactKind = z.infer<typeof ContactKind>

export const contactKindTitles: Record<ContactKind, string> = {
  telegram: 'Telegram',
  vk: 'ВКонтакте',
  phone: 'Телефон',
  email: 'Почта',
}

/** Контакт короче этого не годится ни для какого вида связи: так же его не пускает браузер */
export const CONTACT_MIN_LENGTH = 5

/**
 * Строка для атрибута pattern поля контакта: вид связи в браузере без скрипта не известен
 * (меняется выбор — меняется правило), поэтому браузер отсекает только заведомо короткое и
 * пробелы по краям, а точную проверку по виду делает сервер при отправке
 */
export const CONTACT_PATTERN = String.raw`\S.{${CONTACT_MIN_LENGTH - 2},}\S`

/** Подсказка браузера, если значение не подошло под CONTACT_PATTERN */
export const CONTACT_TITLE = `Не короче ${CONTACT_MIN_LENGTH} знаков, без пробелов по краям`

const digits = (value: string) => value.replace(/\D/g, '')

const isPhone = (value: string) =>
  /^\+?[\d\s()-]+$/.test(value) && digits(value).length >= 10 && digits(value).length <= 15

type ContactRule = { check: (value: string) => boolean; message: string }

export const contactRules: Record<ContactKind, ContactRule> = {
  telegram: {
    check: (value) =>
      /^@?[A-Za-z0-9_]{5,32}$/.test(value) ||
      /^(?:https?:\/\/)?t\.me\/[A-Za-z0-9_]{5,32}\/?$/i.test(value) ||
      isPhone(value),
    message: 'Напишите ник вроде @nickname или номер телефона',
  },
  vk: {
    check: (value) =>
      /^(?:https?:\/\/)?(?:m\.)?vk\.(?:com|ru)\/[A-Za-z0-9_.]+\/?$/i.test(value) ||
      /^@?[A-Za-z0-9_.]{5,32}$/.test(value),
    message: 'Вставьте ссылку на страницу, например vk.com/nickname',
  },
  phone: {
    check: isPhone,
    message: 'Похоже, в номере не хватает цифр: нужно от 10 до 15',
  },
  email: {
    check: (value) => value.length <= 100 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    message: 'Проверьте адрес: в нём должны быть @ и точка',
  },
}
