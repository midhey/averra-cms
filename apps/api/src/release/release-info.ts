import { RELEASE_NOTES_MAX, type ReleaseLatest, ReleaseVersion } from '@averra/schema'
import { z } from 'zod'

// Разбор ответа источника релизов для averra.sh check-update. Ответ — чужие данные из сети:
// из него берутся только версия X.Y.Z, дата и заметки простым текстом, а наружу уходит одна строка
// JSON по схеме ReleaseLatest. Без Node API: команду (cli/release-info.ts) запускает averra.sh в
// контейнере без сети, а здесь — чистые функции для тестов.
//
// Новый источник — формат здесь (RELEASE_FORMATS) и ветка в release_source_url в deploy/averra.sh

const IsoTime = z.iso.datetime({ offset: true })

/** Релиз GitHub (GET /repos/:owner/:repo/releases/latest): черновики и пре-релизы он не отдаёт */
const GithubRelease = z.object({
  tag_name: z.string().max(200),
  published_at: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
})

export class ReleaseInfoError extends Error {
  override name = 'ReleaseInfoError'
}

/** Тег релиза — v0.2.0 или 0.2.0; другое (v0.2.0-beta, nightly) — не релиз для установок */
export function versionOfTag(tag: string) {
  const parsed = ReleaseVersion.safeParse(tag.startsWith('v') ? tag.slice(1) : tag)
  return parsed.success ? parsed.data : null
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
}

/**
 * Заметки к релизу простым текстом: Markdown release-please и HTML превращаются в строки, ссылки —
 * в их текст, ссылки на коммиты пропадают, пункты списков — «•». Админка показывает это как текст:
 * ни разметки, ни ссылок наружу. Длиннее RELEASE_NOTES_MAX — обрезается с «…»
 */
export function plainReleaseNotes(source: string) {
  let text = source
    .replace(/\r\n?/g, '\n')
    // Управляющие символы, кроме перевода строки и табуляции
    // biome-ignore lint/suspicious/noControlCharactersInRegex: их и вырезаем
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity] ?? entity)
    // Картинки и ссылки — их текст
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Ссылки на коммиты release-please: «(abc1234)» после ссылки — шум для владельца
    .replace(/\s*\(([0-9a-f]{7,40})\)/g, '')
    // Заголовки и цитаты — без значков, пункты списков — «•»
    .replace(/^[ \t]*#{1,6}[ \t]*/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^([ \t]*)[*+-][ \t]+/gm, '$1• ')
    // Выделение и код
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/`+/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (text.length > RELEASE_NOTES_MAX) text = `${text.slice(0, RELEASE_NOTES_MAX).trimEnd()}…`
  return text
}

/**
 * Релиз ломающий для установок: release-please пишет раздел «⚠ BREAKING CHANGES» по подвалу
 * BREAKING CHANGE коммита (ручной шаг на сервере, новая строка .env — AGENTS.md). Ищем в исходном
 * тексте, до обрезки заметок: раздел мог оказаться за пределом RELEASE_NOTES_MAX
 */
export const isBreakingRelease = (source: string) => /\bBREAKING[ _-]CHANGES?\b/.test(source)

/** Форматы ответа источника: как из него достать релиз */
export const RELEASE_FORMATS = {
  github(data: unknown): ReleaseLatest {
    const release = GithubRelease.safeParse(data)
    if (!release.success) throw new ReleaseInfoError('ответ GitHub не похож на релиз')
    if (release.data.draft || release.data.prerelease) {
      throw new ReleaseInfoError('последний релиз — черновик или пре-релиз')
    }
    const version = versionOfTag(release.data.tag_name)
    if (!version) throw new ReleaseInfoError('тег последнего релиза — не версия X.Y.Z')
    const published = IsoTime.safeParse(release.data.published_at)
    return {
      version,
      publishedAt: published.success ? published.data : null,
      breaking: isBreakingRelease(release.data.body ?? ''),
      notes: plainReleaseNotes(release.data.body ?? ''),
    }
  },
} as const

export type ReleaseFormat = keyof typeof RELEASE_FORMATS

export const isReleaseFormat = (value: string): value is ReleaseFormat =>
  Object.hasOwn(RELEASE_FORMATS, value)

/**
 * Ответ источника → одна строка JSON для release-latest.json. Версия — первым полем: по ней
 * averra.sh сверяет заявку (LATEST_RE); breaking — до заметок: averra.sh ищет «"breaking":true»,
 * а в заметках кавычки экранированы
 */
export function releaseInfo(format: ReleaseFormat, body: string) {
  let data: unknown
  try {
    data = JSON.parse(body)
  } catch {
    throw new ReleaseInfoError('ответ источника — не JSON')
  }
  const release = RELEASE_FORMATS[format](data)
  return JSON.stringify({
    version: release.version,
    publishedAt: release.publishedAt,
    breaking: release.breaking,
    notes: release.notes,
  })
}
