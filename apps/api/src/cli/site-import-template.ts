import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { TEMPLATE_MAX_BYTES } from '@averra/schema'
import { diskStorage } from '../media/disk-storage'
import { sharpProcessor } from '../media/sharp-processor'
import { buildsRepo } from '../modules/builds/repo'
import { importTemplate, TemplateError } from '../modules/export/site-template'
import { sitesRepo } from '../modules/sites/repo'
import { createPublishQueue } from '../publish/queue'
import { defaultRendererDir, rendererProcess } from '../publish/renderer'
import { staticSiteBuilder } from '../publish/site-builder'
import { args, CliError, openDb, resolveSite, run } from './common'

await run(async () => {
  const { file } = args({ file: { type: 'string' } }, 'pnpm site:import-template --file <файл.zip>')
  if (!file) throw new CliError('Укажите --file <файл.zip>')
  let bytes: Uint8Array
  if (file === '-') {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of process.stdin) {
      const part = Buffer.from(chunk)
      size += part.length
      if (size > TEMPLATE_MAX_BYTES) throw new CliError('Архив шаблона больше 256 МБ')
      chunks.push(part)
    }
    bytes = Buffer.concat(chunks)
  } else {
    if ((await stat(file)).size > TEMPLATE_MAX_BYTES)
      throw new CliError('Архив шаблона больше 256 МБ')
    bytes = new Uint8Array(await readFile(file))
  }
  const { db, config, close } = await openDb()
  try {
    const site = await resolveSite(db, undefined)
    const storage = diskStorage(config.MEDIA_DIR)
    const result = await importTemplate({
      db,
      storage,
      images: sharpProcessor(),
      maxBytes: config.MEDIA_MAX_BYTES,
      siteId: site.id,
      bytes,
    })
    console.log(`Шаблон импортирован: страниц — ${result.pages}, картинок — ${result.media}`)
    if (config.PUBLISH_DIR) {
      // На сервере API уже отвечает снимками; сборщик и журнал — те же, что при публикации.
      const queue = createPublishQueue({
        db,
        log: console.log,
        build: staticSiteBuilder({
          publishDir: config.PUBLISH_DIR,
          keepReleases: config.PUBLISH_KEEP_RELEASES,
          storage,
          publishedMedia: (id) => sitesRepo(db).publishedMediaIds(id),
          log: console.log,
          render: rendererProcess({
            rendererDir: config.RENDERER_DIR ?? defaultRendererDir(),
            apiUrl: `http://127.0.0.1:${config.PORT}`,
            cacheDir: join(config.PUBLISH_DIR, '.cache'),
            timeoutMs: config.PUBLISH_TIMEOUT_SECONDS * 1000,
            maxMemoryMb: config.PUBLISH_MAX_MEMORY_MB,
          }),
        }),
      })
      try {
        await queue.request(site.id)
        await queue.idle()
        const build = await buildsRepo(db).latest(site.id)
        if (build?.status !== 'succeeded')
          throw new CliError(
            'Шаблон импортирован, но сборка не удалась. Причина — в журнале сборок; повторите «Собрать заново» в админке',
          )
      } finally {
        await queue.stop()
      }
    }
  } catch (error) {
    if (error instanceof TemplateError) throw new CliError(error.message)
    throw error
  } finally {
    await close()
  }
})
