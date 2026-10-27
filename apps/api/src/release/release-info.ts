import {
  isNewerVersion,
  RELEASE_NOTES_MAX,
  type ReleaseLatest,
  ReleaseVersion,
} from '@averra/schema'
import { z } from 'zod'

// Разбор ответа источника релизов для averra.sh check-update. Ответ — чужие данные из сети:
// из него берутся только версии X.Y.Z, даты и заметки простым текстом, а наружу уходит одна строка
// JSON по схеме ReleaseLatest. Источник отдаёт список релизов, а не только последний: ломающий
// релиз между установленной и последней версией (0.2.0 с шагом на сервере, следом 0.2.1 без него)
// иначе проскочил бы без шага. Без Node API: команду (cli/release-info.ts) запускает averra.sh в
// контейнере без сети, а здесь — чистые функции для тестов.
//
// Новый источник — формат здесь (RELEASE_FORMATS) и ветка в release_source в deploy/averra.sh

const IsoTime = z.iso.datetime({ offset: true })

/**
 * Релиз GitHub из списка GET /repos/:owner/:repo/releases (новые сверху, 30 на странице).
 * Черновики без входа список не отдаёт, пре-релизы — отдаёт: их пропускаем
 */
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
  return truncateNotes(plainText(source))
}

const truncateNotes = (text: string) =>
  text.length > RELEASE_NOTES_MAX ? `${text.slice(0, RELEASE_NOTES_MAX).trimEnd()}…` : text

function plainText(source: string) {
  return (
    source
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
  )
}

/**
 * Релиз ломающий для установок: release-please пишет раздел «⚠ BREAKING CHANGES» по подвалу
 * BREAKING CHANGE коммита (ручной шаг на сервере, новая строка .env — AGENTS.md). Ищем в исходном
 * тексте, до обрезки заметок: раздел мог оказаться за пределом RELEASE_NOTES_MAX
 */
export const isBreakingRelease = (source: string) => /\bBREAKING[ _-]CHANGES?\b/.test(source)

/** Релиз из ответа источника: версия X.Y.Z, дата, заметки как есть */
type FoundRelease = { version: ReleaseVersion; publishedAt: string | null; body: string }

/** Форматы ответа источника: как из него достать релизы (не пустой список) */
export const RELEASE_FORMATS = {
  github(data: unknown): FoundRelease[] {
    if (!Array.isArray(data)) throw new ReleaseInfoError('ответ GitHub — не список релизов')
    const found: FoundRelease[] = []
    for (const item of data) {
      const release = GithubRelease.safeParse(item)
      if (!release.success || release.data.draft || release.data.prerelease) continue
      const version = versionOfTag(release.data.tag_name)
      if (!version) continue
      const published = IsoTime.safeParse(release.data.published_at)
      found.push({
        version,
        publishedAt: published.success ? published.data : null,
        body: release.data.body ?? '',
      })
    }
    if (found.length === 0) throw new ReleaseInfoError('в списке нет релиза с версией X.Y.Z')
    return found
  },
} as const

/**
 * Последний релиз и всё, что между ним и установленной версией. breaking — у любого релиза
 * промежутка, заметки — за весь промежуток, новые сверху. В списке нет ни одного релиза не новее
 * установленной — промежуток виден не целиком (установка отстала больше, чем на страницу списка,
 * или стоит версия не из этого источника): тогда осторожно считаем релиз ломающим — обновит
 * студия, сверившись с CHANGELOG.md. Установленная не X.Y.Z (разработка) — только последний
 */
export function summarize(releases: FoundRelease[], current: string | null): ReleaseLatest {
  const sorted = [...releases].sort((a, b) =>
    isNewerVersion(a.version, b.version) ? -1 : isNewerVersion(b.version, a.version) ? 1 : 0,
  )
  const latest = sorted[0]
  if (!latest) throw new ReleaseInfoError('в ответе нет релизов')
  const known = current !== null && ReleaseVersion.safeParse(current).success
  const span =
    known && isNewerVersion(latest.version, current)
      ? sorted.filter((release) => isNewerVersion(release.version, current))
      : [latest]
  const gap = known && span.length === sorted.length && isNewerVersion(latest.version, current)
  const parts = span.map((release) => plainText(release.body) || release.version)
  if (gap) {
    parts.unshift(
      `Между установленной версией ${current} и ${latest.version} больше релизов, чем сервер видит за раз: что в пропущенных — в CHANGELOG.md. Такое обновление ставит студия по SSH.`,
    )
  }
  return {
    version: latest.version,
    publishedAt: latest.publishedAt,
    breaking: gap || span.some((release) => isBreakingRelease(release.body)),
    releases: span.length,
    notes: truncateNotes(parts.join('\n\n')),
  }
}

export type ReleaseFormat = keyof typeof RELEASE_FORMATS

export const isReleaseFormat = (value: string): value is ReleaseFormat =>
  Object.hasOwn(RELEASE_FORMATS, value)

/**
 * Ответ источника → одна строка JSON для release-latest.json. Версия — первым полем: по ней
 * averra.sh сверяет заявку (LATEST_RE); breaking — до заметок: averra.sh ищет «"breaking":true»,
 * а в заметках кавычки экранированы. current — установленная версия (null — неизвестна)
 */
export function releaseInfo(format: ReleaseFormat, body: string, current: string | null = null) {
  let data: unknown
  try {
    data = JSON.parse(body)
  } catch {
    throw new ReleaseInfoError('ответ источника — не JSON')
  }
  const release = summarize(RELEASE_FORMATS[format](data), current)
  return JSON.stringify({
    version: release.version,
    publishedAt: release.publishedAt,
    breaking: release.breaking,
    releases: release.releases,
    notes: release.notes,
  })
}
