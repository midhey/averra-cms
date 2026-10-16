import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { diskStorage } from '../media/disk-storage'
import { mediaKey } from '../media/storage'
import { BuildFailure } from './queue'
import { copyReferencedMedia, pruneUnusedAssets, referencedMedia } from './release-files'
import type { Render } from './renderer'
import { hasCurrentRelease, staticSiteBuilder } from './site-builder'

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function tempDir(prefix: string) {
  const dir = join(tmpdir(), `cms-${prefix}-${randomUUID()}`)
  dirs.push(dir)
  await mkdir(dir, { recursive: true })
  return dir
}

const siteId = 'd0000000-0000-4000-8000-000000000001'
const mediaId = 'a1111111-1111-4111-8111-111111111111'

/** Страница, как её собирает рендерер с CMS_LINKS=relative: картинка и стили от корня сайта */
const pageHtml = (title: string) => `<!doctype html><html><head>
<link rel="stylesheet" href="/_astro/page.ABC123.css"></head><body><h1>${title}</h1>
<picture><source type="image/avif" srcset="/media/${mediaId}/480.avif 480w, /media/${mediaId}/960.avif 960w">
<img src="/media/${mediaId}/960.jpg" alt=""></picture>
<form method="post" action="/api/forms/${siteId}/index/lead"></form></body></html>`

/** Рендерер-подделка: кладёт то же, что Astro, — страницу, CSS со шрифтом и лишний бандл React */
const fakeRender =
  (title = 'Главная', calls: string[] = []): Render =>
  async ({ siteId: id, outDir }) => {
    calls.push(id)
    await mkdir(join(outDir, '_astro'), { recursive: true })
    await writeFile(join(outDir, 'index.html'), pageHtml(title))
    await writeFile(join(outDir, '_astro', 'page.ABC123.css'), 'body{font:url(./font.XYZ.woff2)}')
    await writeFile(join(outDir, '_astro', 'font.XYZ.woff2'), 'шрифт')
    await writeFile(join(outDir, '_astro', 'client.DEF456.js'), 'react'.repeat(1000))
    return { peakRssBytes: 300 * 2 ** 20 }
  }

async function storageWithImage() {
  const storage = diskStorage(await tempDir('media'))
  for (const file of ['480.avif', '960.avif', '960.jpg', 'original.jpg']) {
    await storage.put(mediaKey(siteId, mediaId, file), new TextEncoder().encode(file))
  }
  return storage
}

describe('файлы релиза', () => {
  it('находит файлы картинок в srcset и src, без повторов и без оригинала', () => {
    const html = `${pageHtml('x')}<img src="/media/${mediaId}/original.jpg"><img src="/media/${mediaId}/960.jpg">`
    expect(referencedMedia(html)).toEqual([
      { mediaId, file: '480.avif' },
      { mediaId, file: '960.avif' },
      { mediaId, file: '960.jpg' },
    ])
  })

  it('кладёт в релиз только упомянутые картинки, а из прежнего релиза связывает их жёсткой ссылкой', async () => {
    const storage = await storageWithImage()
    const previous = await tempDir('prev')
    await writeFile(join(previous, 'index.html'), pageHtml('старая'))
    await copyReferencedMedia({ outDir: previous, siteId, storage })
    expect((await readdir(join(previous, 'media', mediaId))).sort()).toEqual([
      '480.avif',
      '960.avif',
      '960.jpg',
    ])

    const next = await tempDir('next')
    await writeFile(join(next, 'index.html'), pageHtml('новая'))
    await copyReferencedMedia({ outDir: next, siteId, storage, previousDir: previous })
    const file = join(next, 'media', mediaId, '960.jpg')
    expect(await readFile(file, 'utf8')).toBe('960.jpg')
    // Тот же файл на диске, а не копия: одна запись, две ссылки
    expect((await stat(file)).nlink).toBe(2)
  })

  it('нет файла в медиатеке — ошибка, а не сайт без картинки', async () => {
    const outDir = await tempDir('out')
    await writeFile(join(outDir, 'index.html'), pageHtml('x'))
    await expect(
      copyReferencedMedia({ outDir, siteId, storage: diskStorage(await tempDir('empty')) }),
    ).rejects.toThrow(`нет файла картинки ${mediaId}/480.avif`)
  })

  it('убирает из _astro то, на что не ссылается ни страница, ни её CSS', async () => {
    const outDir = await tempDir('assets')
    await fakeRender()({ siteId, outDir })
    expect(await pruneUnusedAssets(outDir)).toEqual(['client.DEF456.js'])
    expect((await readdir(join(outDir, '_astro'))).sort()).toEqual([
      'font.XYZ.woff2',
      'page.ABC123.css',
    ])
  })
})

describe('сборка сайта в релиз', () => {
  it('новая версия — новая папка с картинками, current на неё, лишний бандл убран', async () => {
    const publishDir = await tempDir('publish')
    const build = staticSiteBuilder({
      publishDir,
      keepReleases: 5,
      storage: await storageWithImage(),
      render: fakeRender('Версия 1'),
    })
    expect(await hasCurrentRelease(publishDir, siteId)).toBe(false)
    const result = await build(siteId, new AbortController().signal)
    expect(result).toEqual({ release: expect.any(String), peakRssBytes: 300 * 2 ** 20 })
    const current = join(publishDir, siteId, 'current')
    expect(await readFile(join(current, 'index.html'), 'utf8')).toContain('Версия 1')
    expect(await readdir(join(current, 'media', mediaId))).toHaveLength(3)
    expect(await readdir(join(current, '_astro'))).not.toContain('client.DEF456.js')
    expect(await hasCurrentRelease(publishDir, siteId)).toBe(true)
  })

  it('сбой сборки не трогает текущую версию и не оставляет мусора', async () => {
    const publishDir = await tempDir('publish')
    const storage = await storageWithImage()
    const options = { publishDir, keepReleases: 5, storage }
    const signal = new AbortController().signal
    const first = await staticSiteBuilder({ ...options, render: fakeRender('Версия 1') })(
      siteId,
      signal,
    )

    const broken: Render = async ({ outDir }) => {
      await writeFile(join(outDir, 'index.html'), 'половина сайта')
      throw new BuildFailure('Astro упал на странице «index»', 123)
    }
    const failure = staticSiteBuilder({ ...options, render: broken })(siteId, signal)
    await expect(failure).rejects.toMatchObject({
      message: 'Astro упал на странице «index»',
      peakRssBytes: 123,
    })
    const current = join(publishDir, siteId, 'current')
    expect(await readFile(join(current, 'index.html'), 'utf8')).toContain('Версия 1')
    expect(await readdir(join(publishDir, siteId, 'releases'))).toEqual([first.release])
  })

  it('сбой после сборки (нет картинки) — тоже прежняя версия, а пик памяти в ошибке', async () => {
    const publishDir = await tempDir('publish')
    const signal = new AbortController().signal
    const options = { publishDir, keepReleases: 5 }
    // Прежняя версия — без картинки: файла нет ни в ней, ни в медиатеке
    const textOnly: Render = async ({ outDir }) => {
      await writeFile(join(outDir, 'index.html'), '<h1>Версия 1</h1>')
      return {}
    }
    const first = await staticSiteBuilder({
      ...options,
      storage: await storageWithImage(),
      render: textOnly,
    })(siteId, signal)
    const failure = staticSiteBuilder({
      ...options,
      storage: diskStorage(await tempDir('empty')),
      render: fakeRender('Версия 2'),
    })(siteId, signal)
    await expect(failure).rejects.toBeInstanceOf(BuildFailure)
    await expect(failure).rejects.toMatchObject({ peakRssBytes: 300 * 2 ** 20 })
    expect(await readdir(join(publishDir, siteId, 'releases'))).toEqual([first.release])
  })

  it('хранит keepReleases последних версий', async () => {
    const publishDir = await tempDir('publish')
    let tick = 0
    const build = staticSiteBuilder({
      publishDir,
      keepReleases: 2,
      storage: await storageWithImage(),
      render: fakeRender(),
      // Разное время — разные и сортируемые имена релизов
      now: () => new Date(Date.UTC(2026, 9, 16, 8, 0, tick++)),
    })
    const signal = new AbortController().signal
    const results = []
    for (let i = 0; i < 4; i += 1) results.push(await build(siteId, signal))
    expect((await readdir(join(publishDir, siteId, 'releases'))).sort()).toEqual(
      results.slice(-2).map((result) => result.release),
    )
  })
})
