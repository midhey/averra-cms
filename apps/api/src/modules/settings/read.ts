import { readSiteSettings } from '@averra/schema'

// Поля, о которых уже сказали в лог: настройки читаются на каждом 404 сайта, а сообщение нужно
// одно — после отката версии оно повторялось бы на каждый заход
const reported = new Set<string>()

/**
 * Настройки сайта из базы. Поле, которое эта версия не понимает (его записала более новая, а
 * установку откатили), читается значением по умолчанию — и один раз попадает в лог
 */
export function readStoredSettings(stored: unknown) {
  return readSiteSettings(stored, (field) => {
    if (reported.has(field)) return
    reported.add(field)
    console.warn(
      `Настройки сайта: поле «${field}» записано другой версией Averra и этой не понятно — ` +
        'до обновления действует значение по умолчанию, в базе поле не тронуто',
    )
  })
}
