import { z } from 'zod'
import { CUSTOM_BLOCK_LIMITS } from './custom-blocks'

/**
 * Скрипт на весь сайт (экран «Скрипт сайта»): свой JS владельца на каждой странице и домены,
 * которые этому коду нужны (виджет чата, форма CRM). Черновик и публикация — как у шапки; пишет
 * владелец, токен MCP — только черновик по праву «Черновики своих блоков». Решение — документация
 * «Решения → Свой JS на сайте»
 */

/** Доменов внешних скриптов: виджету хватает одного-двух, длинный список — повод остановиться */
export const SCRIPT_ORIGINS_MAX = 20

// Только https, хост из букв, цифр, дефисов и точек (поддомены — через «*.» в начале), порт по
// желанию. Без пути, пробелов, кавычек и «;»: строка уходит в заголовок CSP как есть, и любой
// лишний знак добавил бы туда свою директиву
const ORIGIN_PATTERN =
  /^https:\/\/(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}(?::\d{1,5})?$/

/**
 * Домен, с которого скрипт сайта грузит свой код, стили, картинки, фреймы и запросы:
 * https://widget.example.ru, https://*.example.ru. Попадает в CSP сайта
 */
export const ScriptOrigin = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => value.replace(/\/$/, ''))
  .pipe(
    z
      .string()
      .max(253)
      .regex(
        ORIGIN_PATTERN,
        'Домен: https:// и имя хоста без пути, например https://widget.example.ru или https://*.example.ru',
      ),
  )

export const SiteScript = z.strictObject({
  /** Тело async-функции: выполняется на каждой странице после разбора HTML. '' — скрипта нет */
  script: z.string().max(CUSTOM_BLOCK_LIMITS.script).default(''),
  /** Домены для CSP сайта: script-src, style-src, img-src, font-src, connect-src, frame-src */
  origins: z
    .array(ScriptOrigin)
    .max(SCRIPT_ORIGINS_MAX, `Доменов не больше ${SCRIPT_ORIGINS_MAX}`)
    .default([])
    .refine(
      (origins) => new Set(origins).size === origins.length,
      'Домены повторяются: оставьте каждый один раз',
    ),
})
export type SiteScript = z.infer<typeof SiteScript>
export type SiteScriptInput = z.input<typeof SiteScript>

/** Скрипта сайта нет: ни кода, ни доменов */
export const EMPTY_SITE_SCRIPT: SiteScript = { script: '', origins: [] }

/**
 * Скрипт сайта из базы. Не подходит под схему (записан другой версией) — как будто его нет: сайт
 * без своего JS работает, а владелец увидит пустой черновик и сохранит заново
 */
export function readSiteScript(stored: unknown): SiteScript {
  if (stored === null || stored === undefined) return EMPTY_SITE_SCRIPT
  const result = SiteScript.safeParse(stored)
  return result.success ? result.data : EMPTY_SITE_SCRIPT
}

/**
 * Публикация скрипта сайта: черновик, который человек видел. Черновик пишет и токен MCP — если он
 * поменялся с тех пор, публикация отказывает, как у своих блоков
 */
export const SiteScriptPublish = z.strictObject({ draft: SiteScript })
