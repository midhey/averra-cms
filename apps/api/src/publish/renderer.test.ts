import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BuildFailure } from './queue'
import { DOT_ASTRO_CACHE, RENDER_SCRIPT, rendererProcess } from './renderer'

// Процесс сборщика без настоящего Astro: в папке «рендерера» лежит свой scripts/build-release.mjs.
// Настоящую сборку демо-сайта проходит e2e (e2e/tests/publish.spec.ts)

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function fakeRenderer(script: string) {
  const dir = join(tmpdir(), `cms-renderer-${randomUUID()}`)
  dirs.push(dir)
  await mkdir(join(dir, 'scripts'), { recursive: true })
  await writeFile(join(dir, RENDER_SCRIPT), script)
  return dir
}

async function outDir() {
  const dir = join(tmpdir(), `cms-out-${randomUUID()}`)
  dirs.push(dir)
  await mkdir(dir, { recursive: true })
  return dir
}

const options = (rendererDir: string) => ({
  rendererDir,
  apiUrl: 'http://127.0.0.1:4999',
  cacheDir: join(rendererDir, 'cache'),
  timeoutMs: 10_000,
  maxMemoryMb: 256,
})

describe('процесс сборщика', () => {
  it('передаёт сайт, адрес API и папку, читает пиковую память из последней строки', async () => {
    const dir = await fakeRenderer(`
      import { writeFileSync } from 'node:fs'
      import { join } from 'node:path'
      writeFileSync(join(process.env.AVERRA_OUT_DIR, 'env.json'), JSON.stringify(process.env))
      console.log('сборка идёт')
      console.log(JSON.stringify({ peakRssBytes: 4242 }))
    `)
    const out = await outDir()
    const previous = process.env.AUTH_SECRET
    process.env.AUTH_SECRET = 'секрет-api-который-сборщику-не-нужен'
    try {
      const result = await rendererProcess(options(dir))({ siteId: 'site-1', outDir: out })
      expect(result).toEqual({ peakRssBytes: 4242 })
    } finally {
      if (previous === undefined) delete process.env.AUTH_SECRET
      else process.env.AUTH_SECRET = previous
    }
    const env = JSON.parse(await readFile(join(out, 'env.json'), 'utf8')) as Record<string, string>
    expect(env).toMatchObject({
      CMS_SITE_ID: 'site-1',
      CMS_API_URL: 'http://127.0.0.1:4999',
      CMS_LINKS: 'relative',
      AVERRA_OUT_DIR: out,
      NODE_ENV: 'production',
      ASTRO_TELEMETRY_DISABLED: '1',
    })
    // Секреты API сборщику не передаются: в его вывод (а значит, в журнал и админку) им не попасть
    expect(env.AUTH_SECRET).toBeUndefined()
    expect(Object.keys(env).filter((key) => /SECRET|DATABASE|SMTP|MAIL_ENC/.test(key))).toEqual([])
  })

  it('кеш сборки — в cacheDir: папка для .astro образа есть до старта сборщика', async () => {
    const dir = await fakeRenderer(`
      import { existsSync, writeFileSync } from 'node:fs'
      import { join } from 'node:path'
      const ready = existsSync(join(process.env.AVERRA_CACHE_DIR, '${DOT_ASTRO_CACHE}'))
      writeFileSync(join(process.env.AVERRA_OUT_DIR, 'cache.json'), JSON.stringify({ ready }))
    `)
    const out = await outDir()
    await rendererProcess(options(dir))({ siteId: 's', outDir: out })
    expect(JSON.parse(await readFile(join(out, 'cache.json'), 'utf8'))).toEqual({ ready: true })
  })

  it('ненулевой код — BuildFailure с хвостом вывода без цветов терминала', async () => {
    const dir = await fakeRenderer(`
      console.log(JSON.stringify({ peakRssBytes: 1 }))
      console.error('\\u001b[31m[ERROR]\\u001b[39m Блок «form»: нет policyUrl')
      process.exit(3)
    `)
    const failure = rendererProcess(options(dir))({ siteId: 's', outDir: await outDir() })
    const error = await failure.catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(BuildFailure)
    const { message, peakRssBytes } = error as BuildFailure
    expect(message).toMatch(/^Сборка упала \(код выхода 3\):\n/)
    expect(message).toContain('[ERROR] Блок «form»: нет policyUrl')
    expect(message).not.toContain('\u001b')
    expect(peakRssBytes).toBe(1)
  })

  it('зависшая сборка останавливается по таймауту', async () => {
    const dir = await fakeRenderer('setInterval(() => {}, 1000)')
    const failure = rendererProcess({ ...options(dir), timeoutMs: 300 })({
      siteId: 's',
      outDir: await outDir(),
    })
    await expect(failure).rejects.toThrow('Сборка не уложилась в 0 с и остановлена')
  })

  it('остановка API убивает процесс сборки сразу', async () => {
    const dir = await fakeRenderer('setInterval(() => {}, 1000)')
    const aborter = new AbortController()
    const failure = rendererProcess(options(dir))({
      siteId: 's',
      outDir: await outDir(),
      signal: aborter.signal,
    })
    setTimeout(() => aborter.abort(), 100)
    await expect(failure).rejects.toThrow('Сборка прервана остановкой API')
  })

  it('нет Node или скрипта — понятная ошибка запуска, а не зависание', async () => {
    const dir = await fakeRenderer('')
    const failure = rendererProcess({ ...options(dir), nodePath: join(dir, 'нет-такой-node') })({
      siteId: 's',
      outDir: await outDir(),
    })
    await expect(failure).rejects.toThrow('Не удалось запустить сборку')
  })
})
