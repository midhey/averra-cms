import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { demoSiteId } from '@averra/schema'
import { defaultTheme } from '@averra/tokens'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { parseConfig } from './config'
import { createDb } from './db/client'
import { migrateDb } from './db/migrate'
import { sites } from './db/schema'
import { prepareInstallationSite } from './installation-site'
import { sitesRepo } from './modules/sites/repo'
import { installationLinkTarget } from './publish/installation-link'

// Старт API: какой сайт у установки и что про него пишется в лог. Код старта (index.ts) только
// печатает строки — правило живёт здесь. Конфиг — настоящий, из переменных окружения: так
// проверяется и связка SITE_NAME, SITE_URL и PUBLISH_DIR с сайтом, а не только правило

/** Конфиг API на сервере из этих переменных (без --dev), как его собирает index.ts */
function serverConfig(env: Record<string, string>) {
  const parsed = parseConfig({
    NODE_ENV: 'production',
    AUTH_SECRET: 'x'.repeat(32),
    ADMIN_URL: 'https://admin.example.ru',
    API_URL: 'https://api.example.ru',
    ...env,
  })
  if (!parsed.success) throw parsed.error
  return parsed.data
}

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
})

async function emptyDb() {
  const { db, close } = createDb()
  cleanup.push(close)
  await migrateDb(db)
  return db
}

async function publishDir() {
  const dir = await mkdtemp(join(tmpdir(), 'averra-installation-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

const names = async (db: Awaited<ReturnType<typeof emptyDb>>) =>
  (await db.select({ name: sites.name }).from(sites)).map((site) => site.name)

describe('сайт установки при старте', () => {
  it('SITE_NAME важнее домена; сайт один и при повторном старте; ссылка main — на него', async () => {
    const db = await emptyDb()
    const dir = await publishDir()
    const env = {
      SITE_NAME: 'Ремонт у Ивана',
      SITE_URL: 'https://remont-ivana.ru',
      PUBLISH_DIR: dir,
    }
    const first = await prepareInstallationSite(db, serverConfig(env))
    expect(first.site.name).toBe('Ремонт у Ивана')
    expect(first.lines).toEqual(['Создан сайт установки «Ремонт у Ивана»'])
    expect(await installationLinkTarget(dir)).toBe(first.site.id)

    // Перезапуск: сайт тот же, второго нет, в логе тихо. Новое SITE_NAME название не меняет
    const again = await prepareInstallationSite(
      db,
      serverConfig({ ...env, SITE_NAME: 'Другое название' }),
    )
    expect(again).toEqual({ site: first.site, lines: [] })
    expect(await names(db)).toEqual(['Ремонт у Ивана'])
  })

  it('без SITE_NAME — домен сайта, без домена — «Мой сайт»', async () => {
    const byDomain = await prepareInstallationSite(
      await emptyDb(),
      serverConfig({ SITE_URL: 'https://remont-ivana.ru' }),
    )
    expect(byDomain.site.name).toBe('remont-ivana.ru')
    const bare = await prepareInstallationSite(await emptyDb(), serverConfig({}))
    expect(bare.site.name).toBe('Мой сайт')
    expect(bare.lines).toEqual(['Создан сайт установки «Мой сайт»'])
  })

  it('учебный режим: сайт установки — демо-сайт, второго нет ни сразу, ни после перезапуска', async () => {
    const db = await emptyDb()
    // pnpm dev: флаг --dev и адреса localhost по умолчанию
    const parsed = parseConfig({ SITE_NAME: 'Ремонт у Ивана' }, { dev: true })
    if (!parsed.success) throw parsed.error
    const config = parsed.data
    expect(config.devSeed).toBe(true)
    const first = await prepareInstallationSite(db, config)
    expect(first.site.id).toBe(demoSiteId)
    expect(first.lines).toEqual([])
    const again = await prepareInstallationSite(db, config)
    expect(again.site.id).toBe(demoSiteId)
    expect(await names(db)).toEqual(['Демо: ремонт квартир'])
  })

  it('в базе несколько сайтов: строка в лог с числом, ссылка main — на созданный первым', async () => {
    const db = await emptyDb()
    const dir = await publishDir()
    const repo = sitesRepo(db)
    const oldest = await repo.createSite('Старый', defaultTheme)
    await repo.createSite('Второй', defaultTheme)
    // Время создания — явно: два сайта подряд могут получить одну и ту же миллисекунду
    await db
      .update(sites)
      .set({ createdAt: new Date('2025-01-01T00:00:00Z') })
      .where(eq(sites.id, oldest.id))

    const two = await prepareInstallationSite(
      db,
      serverConfig({ SITE_NAME: 'Новый', PUBLISH_DIR: dir }),
    )
    expect(two.site.id).toBe(oldest.id)
    expect(two.lines).toEqual([
      `В базе 2 сайта. Averra работает с одним — «Старый» (${oldest.id}), созданным первым. ` +
        'Остальные сохранены и доступны по id через API, но в админке не видны ' +
        '(https://midhey.github.io/averra-cms/decisions/single-site/)',
    ])
    expect(await installationLinkTarget(dir)).toBe(oldest.id)

    for (const name of ['Третий', 'Четвёртый', 'Пятый']) await repo.createSite(name, defaultTheme)
    const five = await prepareInstallationSite(db, serverConfig({}))
    expect(five.lines[0]).toMatch(/^В базе 5 сайтов\. /)
    expect(await names(db)).toHaveLength(5)
  })
})
