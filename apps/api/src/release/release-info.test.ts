import { RELEASE_NOTES_MAX, ReleaseLatest } from '@averra/schema'
import { describe, expect, it } from 'vitest'
import {
  isBreakingRelease,
  plainReleaseNotes,
  ReleaseInfoError,
  releaseInfo,
  versionOfTag,
} from './release-info'

// Разбор ответа источника релизов (averra.sh check-update → cli/release-info.ts): из чужого
// ответа берутся только версия X.Y.Z, дата и заметки простым текстом

/** Тело релиза так, как его пишет release-please */
const RELEASE_PLEASE_BODY = `## [0.2.0](https://github.com/midhey/averra-cms/compare/v0.1.0...v0.2.0) (2026-10-20)


### Features

* **admin:** update the installation from the status screen ([4f1e2d3](https://github.com/midhey/averra-cms/commit/4f1e2d3abc)), closes [#12](https://github.com/midhey/averra-cms/issues/12)
* **blocks:** \`video\` block

### Bug Fixes

* footer contrast on dark themes ([a1b2c3d](https://github.com/midhey/averra-cms/commit/a1b2c3d))
`

const release = (overrides: Record<string, unknown> = {}) => ({
  tag_name: 'v0.2.0',
  published_at: '2026-10-20T10:00:00Z',
  body: RELEASE_PLEASE_BODY,
  draft: false,
  prerelease: false,
  html_url: 'https://github.com/midhey/averra-cms/releases/tag/v0.2.0',
  ...overrides,
})

/** Ответ GET /releases: список из одного релиза с этими полями */
const github = (overrides: Record<string, unknown> = {}) => JSON.stringify([release(overrides)])

/** Тело релиза release-please без ссылок: заголовок версии и пункт */
const body = (version: string, line: string) => `## ${version} (2026-10-20)\n\n* ${line}\n`

describe('releaseInfo: GitHub', () => {
  it('версия без «v», дата и заметки — одной строкой JSON, версия первым полем', () => {
    const line = releaseInfo('github', github())
    expect(line).not.toContain('\n')
    // По этому началу averra.sh сверяет заявку (LATEST_RE)
    expect(line).toMatch(/^\{"version":"0\.2\.0",/)
    const parsed = ReleaseLatest.parse(JSON.parse(line))
    expect(parsed).toMatchObject({
      version: '0.2.0',
      publishedAt: '2026-10-20T10:00:00Z',
      breaking: false,
    })
    expect(parsed.notes).toBe(
      [
        '0.2.0 (2026-10-20)',
        '',
        'Features',
        '',
        '• admin: update the installation from the status screen, closes #12',
        '• blocks: video block',
        '',
        'Bug Fixes',
        '',
        '• footer contrast on dark themes',
      ].join('\n'),
    )
  })

  it('в списке нет релиза X.Y.Z (тег не версия, черновик, пре-релиз), не список, не JSON — отказ', () => {
    for (const body of [
      github({ tag_name: 'v0.2.0-beta.1' }),
      github({ tag_name: 'nightly' }),
      github({ tag_name: 'v0.2.0;reboot' }),
      github({ draft: true }),
      github({ prerelease: true }),
      '[]',
      // Ответ releases/latest (один объект) и ошибка GitHub — не список
      JSON.stringify(release()),
      JSON.stringify({ message: 'Not Found' }),
      '<html>rate limit</html>',
    ]) {
      expect(() => releaseInfo('github', body), body).toThrow(ReleaseInfoError)
    }
  })

  it('без даты и заметок — null, а в заметках — версия', () => {
    const parsed = JSON.parse(releaseInfo('github', github({ published_at: null, body: null })))
    expect(parsed).toEqual({
      version: '0.2.0',
      publishedAt: null,
      breaking: false,
      releases: 1,
      notes: '0.2.0',
    })
  })

  it('последний — самый новый по версии; пре-релизы и чужие теги пропускаются', () => {
    const list = JSON.stringify([
      release({ tag_name: 'v0.3.0-beta.1', prerelease: true }),
      release({ tag_name: 'v0.2.1', body: body('0.2.1', 'fix') }),
      release({ tag_name: 'nightly' }),
      release({
        tag_name: 'v0.10.0',
        body: body('0.10.0', 'feat'),
        published_at: '2026-10-25T10:00:00Z',
      }),
    ])
    expect(JSON.parse(releaseInfo('github', list))).toMatchObject({
      version: '0.10.0',
      publishedAt: '2026-10-25T10:00:00Z',
      releases: 1,
      notes: '0.10.0 (2026-10-20)\n\n• feat',
    })
  })

  it('раздел BREAKING CHANGES — релиз ломающий, признак до заметок (по нему смотрит averra.sh)', () => {
    const body = `${RELEASE_PLEASE_BODY}\n\n### ⚠ BREAKING CHANGES\n\n* **deploy:** new .env line SOME_KEY\n`
    const line = releaseInfo('github', github({ body }))
    expect(line).toMatch(
      /^\{"version":"0\.2\.0","publishedAt":"[^"]+","breaking":true,"releases":1,"notes":/,
    )
    // Кавычки в заметках экранированы: «"breaking":true» из текста релиза хост не обманет
    const tricky = releaseInfo('github', github({ body: 'fix: "breaking":true' }))
    expect(tricky).toContain('"breaking":false')
    expect(isBreakingRelease('### ⚠ BREAKING CHANGES')).toBe(true)
    expect(isBreakingRelease('BREAKING CHANGE: add X to .env')).toBe(true)
    expect(isBreakingRelease('no breaking changes here')).toBe(false)
  })
})

describe('releaseInfo: промежуток от установленной версии', () => {
  // 0.1.0 стоит; вышли 0.2.0 с шагом на сервере и следом 0.2.1 без него
  const list = (breaking020 = true) =>
    JSON.stringify([
      release({ tag_name: 'v0.2.1', body: body('0.2.1', 'fix: footer') }),
      release({
        tag_name: 'v0.2.0',
        body: `${body('0.2.0', 'feat: video')}${breaking020 ? '\n### ⚠ BREAKING CHANGES\n\n* new .env line\n' : ''}`,
      }),
      release({ tag_name: 'v0.1.0', body: body('0.1.0', 'first') }),
    ])

  it('пропущенный ломающий релиз — обновление ломающее; заметки за все пропущенные, новые сверху', () => {
    const parsed = JSON.parse(releaseInfo('github', list(), '0.1.0'))
    expect(parsed).toMatchObject({ version: '0.2.1', breaking: true, releases: 2 })
    expect(parsed.notes).toBe(
      [
        '0.2.1 (2026-10-20)',
        '',
        '• fix: footer',
        '',
        '0.2.0 (2026-10-20)',
        '',
        '• feat: video',
        '',
        '⚠ BREAKING CHANGES',
        '',
        '• new .env line',
      ].join('\n'),
    )
    // Ломающий уже стоит — дальше обновление обычное
    expect(JSON.parse(releaseInfo('github', list(), '0.2.0'))).toMatchObject({
      breaking: false,
      releases: 1,
    })
    // Без ломающих в промежутке — обычное
    expect(JSON.parse(releaseInfo('github', list(false), '0.1.0'))).toMatchObject({
      breaking: false,
      releases: 2,
    })
  })

  it('в списке нет релиза не новее установленной — промежуток не виден целиком: ломающее', () => {
    const parsed = JSON.parse(releaseInfo('github', list(false), '0.0.9'))
    expect(parsed).toMatchObject({ version: '0.2.1', breaking: true, releases: 3 })
    expect(parsed.notes).toMatch(/^Между установленной версией 0\.0\.9 и 0\.2\.1 больше релизов/)
  })

  it('установленная не X.Y.Z (разработка) или не старше последнего — только последний релиз', () => {
    for (const current of [null, 'dev', '0.2.1', '0.3.0']) {
      expect(JSON.parse(releaseInfo('github', list(), current)), String(current)).toMatchObject({
        version: '0.2.1',
        breaking: false,
        releases: 1,
      })
    }
  })
})

describe('plainReleaseNotes', () => {
  it('HTML и скрипты — текстом без тегов, сущности раскрыты, управляющие символы убраны', () => {
    const notes = plainReleaseNotes(
      '<script>alert(1)</script><b>Жирно</b> &amp; <a href="javascript:x">ссылка</a>\u0007<br>строка',
    )
    expect(notes).toBe('alert(1)Жирно & ссылка\nстрока')
    expect(notes).not.toMatch(/[<>]/)
  })

  it('длинные — обрезаются с «…»', () => {
    const notes = plainReleaseNotes('а'.repeat(RELEASE_NOTES_MAX + 500))
    expect(notes).toHaveLength(RELEASE_NOTES_MAX + 1)
    expect(notes.endsWith('…')).toBe(true)
  })

  it('версия из тега: v0.2.0 и 0.2.0 — да, остальное — нет', () => {
    expect(versionOfTag('v0.2.0')).toBe('0.2.0')
    expect(versionOfTag('10.20.30')).toBe('10.20.30')
    for (const tag of ['v0.2', 'V0.2.0', 'v0.2.0\n', ' 0.2.0', '0.2.0.1']) {
      expect(versionOfTag(tag), tag).toBeNull()
    }
  })
})
