import { createWriteStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { diskStorage } from '../media/disk-storage'
import { TemplateError, templateEntries } from '../modules/export/site-template'
import { zipStream } from '../modules/export/zip'
import { args, CliError, openDb, resolveSite, run } from './common'

await run(async () => {
  const { out } = args({ out: { type: 'string' } }, 'pnpm site:template --out <файл.zip>')
  if (!out) throw new CliError('Укажите --out <файл.zip>')
  const { db, config, close } = await openDb({ migrate: false })
  let created = false
  try {
    const site = await resolveSite(db, undefined)
    const entries = await templateEntries({
      db,
      storage: diskStorage(config.MEDIA_DIR),
      siteId: site.id,
      version: config.AVERRA_VERSION,
      siteUrl: config.SITE_URL,
    })
    async function* source() {
      yield* entries
    }
    const output = createWriteStream(out, { flags: 'wx', mode: 0o600 })
    output.once('open', () => {
      created = true
    })
    await pipeline(Readable.fromWeb(zipStream(source())), output)
    console.log(`Шаблон сайта «${site.name}» сохранён: ${out}`)
  } catch (error) {
    if (created) await unlink(out).catch(() => {})
    if (error instanceof TemplateError) throw new CliError(error.message)
    throw error
  } finally {
    await close()
  }
})
