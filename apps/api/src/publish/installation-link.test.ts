import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  INSTALLATION_LINK,
  installationLinkTarget,
  linkInstallationSite,
} from './installation-link'

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function publishDir() {
  const dir = await mkdtemp(join(tmpdir(), 'averra-main-link-'))
  dirs.push(dir)
  return dir
}

const first = '11111111-1111-4111-8111-111111111111'
const second = '22222222-2222-4222-8222-222222222222'

describe('ссылка main на сайт установки', () => {
  it('ставится на папку сайта, даже если сайт ещё не собирали', async () => {
    const dir = await publishDir()
    expect(await installationLinkTarget(dir)).toBeUndefined()
    expect(await linkInstallationSite(dir, first)).toBe(true)
    expect(await installationLinkTarget(dir)).toBe(first)
    // Через ссылку видно то, что сборка положит в папку сайта, — так её видит Caddy
    await writeFile(join(dir, first, 'marker.txt'), 'первый')
    expect(await readFile(join(dir, INSTALLATION_LINK, 'marker.txt'), 'utf8')).toBe('первый')
  })

  it('на тот же сайт повторно не переставляется, на другой — переставляется', async () => {
    const dir = await publishDir()
    await linkInstallationSite(dir, first)
    expect(await linkInstallationSite(dir, first)).toBe(false)

    // Восстановили бэкап, где у сайта другой id: ссылка уходит на него
    expect(await linkInstallationSite(dir, second)).toBe(true)
    expect(await installationLinkTarget(dir)).toBe(second)
    await writeFile(join(dir, second, 'marker.txt'), 'второй')
    expect(await readFile(join(dir, INSTALLATION_LINK, 'marker.txt'), 'utf8')).toBe('второй')
  })
})
