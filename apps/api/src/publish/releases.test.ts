import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { releaseName, siteReleases } from './releases'

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function tempSite() {
  const dir = join(tmpdir(), `cms-releases-${randomUUID()}`)
  dirs.push(dir)
  return siteReleases(dir)
}

/** Готовая сборка с одной страницей: что Caddy отдал бы по current */
async function release(releases: Awaited<ReturnType<typeof tempSite>>, name: string, text: string) {
  const tmp = await releases.prepare(name)
  await writeFile(join(tmp, 'index.html'), text)
  await releases.publish(tmp, name)
}

const served = (releases: Awaited<ReturnType<typeof tempSite>>) =>
  readFile(join(releases.currentLink, 'index.html'), 'utf8')

describe('папки версий сайта', () => {
  it('имя релиза начинается со времени и сортируется по нему', () => {
    const first = releaseName(new Date('2026-10-16T08:00:00.123Z'))
    const second = releaseName(new Date('2026-10-16T08:00:01Z'))
    expect(first).toMatch(/^20261016T080000Z-[0-9a-f]{6}$/)
    expect([second, first].sort()).toEqual([first, second])
  })

  it('до первой сборки текущей версии нет', async () => {
    const releases = await tempSite()
    expect(await releases.current()).toBeUndefined()
    expect(await releases.prune(5)).toEqual([])
  })

  it('сборка кладётся в новую папку, current переключается на неё, прежняя остаётся', async () => {
    const releases = await tempSite()
    await release(releases, '20261016T080000Z-aaaaaa', 'версия 1')
    expect(await releases.current()).toBe('20261016T080000Z-aaaaaa')
    expect(await served(releases)).toBe('версия 1')

    await release(releases, '20261016T090000Z-bbbbbb', 'версия 2')
    expect(await releases.current()).toBe('20261016T090000Z-bbbbbb')
    expect(await served(releases)).toBe('версия 2')
    expect((await readdir(releases.releasesDir)).sort()).toEqual([
      '20261016T080000Z-aaaaaa',
      '20261016T090000Z-bbbbbb',
    ])
  })

  it('неудачная сборка убирает свою временную папку и не трогает текущую версию', async () => {
    const releases = await tempSite()
    await release(releases, '20261016T080000Z-aaaaaa', 'версия 1')
    const tmp = await releases.prepare('20261016T090000Z-bbbbbb')
    await writeFile(join(tmp, 'index.html'), 'недособранная')
    await releases.discard(tmp)
    expect(await served(releases)).toBe('версия 1')
    expect(await readdir(releases.releasesDir)).toEqual(['20261016T080000Z-aaaaaa'])
  })

  it('чистка оставляет keep последних и всегда текущую, брошенные временные папки удаляет', async () => {
    const releases = await tempSite()
    const names = ['20261016T080000Z-aaaaa1', '20261016T080100Z-aaaaa2', '20261016T080200Z-aaaaa3']
    for (const [i, name] of names.entries()) await release(releases, name, `версия ${i + 1}`)
    // Текущая — самая старая (например, откатили ссылку руками): её чистка не трогает
    const old = await releases.prepare('20261016T070000Z-000000')
    await releases.publish(old, '20261016T070000Z-000000')
    // Мусор после сбоя прошлой сборки и чужая папка, которую положили руками
    await mkdir(join(releases.releasesDir, '.tmp-20261016T060000Z-dead00'))
    await mkdir(join(releases.releasesDir, 'backup'))

    const removed = await releases.prune(2)
    expect(removed.sort()).toEqual(['.tmp-20261016T060000Z-dead00', '20261016T080000Z-aaaaa1'])
    expect((await readdir(releases.releasesDir)).sort()).toEqual([
      '20261016T070000Z-000000',
      '20261016T080100Z-aaaaa2',
      '20261016T080200Z-aaaaa3',
      'backup',
    ])
    expect(await releases.current()).toBe('20261016T070000Z-000000')
  })

  it('рядом с current не остаётся временных ссылок после подмены', async () => {
    const releases = await tempSite()
    for (const name of ['20261016T080000Z-aaaaa1', '20261016T080100Z-aaaaa2']) {
      await release(releases, name, name)
    }
    expect((await readdir(releases.siteDir)).sort()).toEqual(['current', 'releases'])
  })
})
