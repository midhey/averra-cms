import { parseArgs } from 'node:util'
import { isReleaseFormat, ReleaseInfoError, releaseInfo } from '../release/release-info'

// Разбор ответа источника релизов: averra.sh check-update передаёт ответ на stdin и запускает
// команду в образе установленной версии без сети, без прав и с файловой системой только на
// чтение. Ни базы, ни конфига API она не трогает. --current — установленная версия: заметки и
// признак «ломающий» считаются за все релизы новее неё. Код 0 — одна строка JSON на stdout, 2 — в
// ответе нет подходящего релиза (причина — в stderr)

const usage = `Разбор ответа источника релизов для averra.sh check-update.
  node dist/server/release-info.js --format github [--current 0.1.0] < ответ.json`

/** Ответ больше этого — не релиз: averra.sh ограничивает его так же */
const MAX_BYTES = 2_000_000

async function readStdin() {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += buffer.length
    if (size > MAX_BYTES) throw new ReleaseInfoError('ответ источника слишком большой')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

try {
  const { values } = parseArgs({
    options: { format: { type: 'string' }, current: { type: 'string' } },
    strict: true,
    allowPositionals: false,
  })
  const format = values.format ?? ''
  if (!isReleaseFormat(format))
    throw new ReleaseInfoError(`непонятный формат «${format}»\n${usage}`)
  process.stdout.write(`${releaseInfo(format, await readStdin(), values.current ?? null)}\n`)
} catch (error) {
  console.error(error instanceof ReleaseInfoError ? error.message : String(error))
  process.exitCode = 2
}
