import {
  FOOTER_LOOK_FIELDS,
  type Footer,
  HEADER_LOOK_FIELDS,
  type Header,
  LOOK_LOCKED_CODE,
} from '@averra/schema'
import { ApiRequestError } from '../errors'

// Администратор сайта вид шапки и подвала не меняет (header.look), но его форма держит копию вида,
// снятую при открытии экрана. Владелец успел поменять вид — сервер отвечает 403, хотя администратор
// трогал только тексты. Тогда экран берёт новый вид с сервера и оставляет его тексты

/** Сообщение под кнопками, когда вид сменился у владельца */
export const LOOK_CHANGED_NOTICE =
  'Вид изменил владелец, поэтому сохранить не получилось. Экран обновлён — проверьте тексты и сохраните ещё раз'

/**
 * Отказ при сохранении, который говорит «вид сменил владелец»: по коду ответа, а не по любому 403
 * (участника могли отключить — тогда подсказка про вид соврала бы)
 */
export const isLookConflict = (error: unknown) =>
  error instanceof ApiRequestError && error.status === 403 && error.code === LOOK_LOCKED_CODE

const pickFields = <T extends object, K extends keyof T>(source: T, keys: readonly K[]) =>
  Object.fromEntries(keys.map((key) => [key, source[key]])) as Pick<T, K>

/** Форма шапки: вид — с сервера, тексты, ссылки, логотип и телефон — свои */
export const adoptHeaderLook = (form: Header, fresh: Header): Header => ({
  ...form,
  ...pickFields(fresh, HEADER_LOOK_FIELDS),
  // Свой вид: тот, что выбрал владелец; поля прежнего вида остаются, только если вид тот же
  custom: fresh.custom?.key === form.custom?.key ? form.custom : fresh.custom,
})

/** Форма подвала: вид — с сервера, тексты и ссылки — свои */
export const adoptFooterLook = (form: Footer, fresh: Footer): Footer => ({
  ...form,
  ...pickFields(fresh, FOOTER_LOOK_FIELDS),
  custom: fresh.custom?.key === form.custom?.key ? form.custom : fresh.custom,
})
