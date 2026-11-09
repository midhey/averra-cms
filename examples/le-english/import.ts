import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createClient } from './src/api-client.ts'
import { importSite } from './src/import-site.ts'

// Перенос Vallex English на установку Averra. Запуск — на Node 24, без установки зависимостей:
//   node import.ts --source ../../../le-english --email owner@example.ru
// Пароль владельца — переменной AVERRA_PASSWORD или скрытым вводом, не аргументом: аргументы
// остаются в истории команд. Подробно — README.md рядом.

const here = dirname(fileURLToPath(import.meta.url))

const usage = `Перенос сайта le-english на Averra через API.

  node import.ts --source <папка le-english> --email <почта владельца> [параметры]

Параметры:
  --source <папка>   проект le-english: оттуда content.default.json и public/ (обязателен, если не
                     заданы --content и --public)
  --content <файл>   контент сайта; у живого сайта клиента — <папка>/data/content.json
  --public <папка>   public/ исходного сайта: фото из assets/images/ и uploads/
  --api <адрес>      адрес API установки; на сервере — адрес админки, там же /api (по умолчанию http://localhost:4000)
  --origin <адрес>   адрес админки установки, ADMIN_URL (по умолчанию http://localhost:5173)
  --email <почта>    владелец установки
  --site-url <адрес> адрес сайта https://домен (canonical и карта сайта)
  --logo <файл>      картинка логотипа в медиатеку про запас (по умолчанию assets/logo.svg)
  --rebuild-documents
                     заменить черновики /privacy и /consent свежим шаблоном целиком, даже если их
                     правили (опубликованное остаётся). Без флага заменяется только блок с фразой
                     шаблона «нет форм заявок», остальной текст не трогается
  --backup-dir <папка>
                     куда перед заменой черновика /privacy или /consent сохраняется его прежний
                     текст (по умолчанию ~/.averra/le-english-backup): черновики не попадают
                     в историю версий
  --reset-content    вернуть контент из исходного сайта: страницы, тексты шапки и подвала
                     перезаписываются (правки клиента в них пропадут). Без флага повторный
                     запуск обновляет только вид: блоки, тему, шапку и подвал, окно, скрипт сайта
  --publish          опубликовать страницы, тему, шапку, подвал и скрипт сайта (без флага — только черновики);
                     сработает, только когда /privacy и /consent уже опубликованы: форма записи
                     собирает персональные данные

Пароль: переменная AVERRA_PASSWORD или скрытый ввод.`

/** Пароль без эха: символы не показываются и не попадают в историю */
async function askPassword(prompt: string) {
  if (!process.stdin.isTTY) {
    throw new Error('Нет терминала для ввода пароля: задайте переменную AVERRA_PASSWORD')
  }
  process.stdout.write(prompt)
  process.stdin.setRawMode(true)
  process.stdin.resume()
  return new Promise<string>((done) => {
    let value = ''
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\r' || char === '\n') {
          process.stdin.setRawMode(false)
          process.stdin.pause()
          process.stdin.off('data', onData)
          process.stdout.write('\n')
          done(value)
          return
        }
        if (char === '\u0003') process.exit(130)
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1)
        else value += char
      }
    }
    process.stdin.on('data', onData)
  })
}

async function main() {
  const { values } = parseArgs({
    options: {
      source: { type: 'string' },
      content: { type: 'string' },
      public: { type: 'string' },
      api: { type: 'string', default: 'http://localhost:4000' },
      origin: { type: 'string', default: 'http://localhost:5173' },
      email: { type: 'string' },
      'site-url': { type: 'string' },
      logo: { type: 'string' },
      publish: { type: 'boolean', default: false },
      'rebuild-documents': { type: 'boolean', default: false },
      'reset-content': { type: 'boolean', default: false },
      'backup-dir': { type: 'string' },
      help: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  })
  if (values.help) {
    console.log(usage)
    return
  }
  const source = values.source ? resolve(values.source) : undefined
  const contentFile = values.content
    ? resolve(values.content)
    : source && join(source, 'content.default.json')
  const publicDir = values.public ? resolve(values.public) : source && join(source, 'public')
  if (!contentFile || !publicDir || !values.email) {
    console.error(
      `${usage}\n\nНе хватает параметров: нужны --source (или --content и --public) и --email.`,
    )
    process.exit(2)
  }
  const password = process.env.AVERRA_PASSWORD ?? (await askPassword('Пароль владельца: '))

  const client = createClient({ baseUrl: values.api, origin: values.origin })
  await client.signIn(values.email, password)
  const logo = values.logo ? resolve(values.logo) : join(here, 'assets', 'logo.svg')
  const result = await importSite({
    client,
    contentFile,
    publicDir,
    blocksFile: join(here, 'le-english.blocks.json'),
    ...(existsSync(logo) && { logoFile: logo }),
    grainFile: join(here, 'assets', 'grain.png'),
    siteScriptFile: join(here, 'site', 'script.js'),
    resetContent: values['reset-content'],
    ...(values['site-url'] && { siteUrl: values['site-url'] }),
    publish: values.publish,
    rebuildDocuments: values['rebuild-documents'],
    ...(values['backup-dir'] && { backupDir: resolve(values['backup-dir']) }),
    log: (line) => console.log(line),
  })

  console.log(`\nГотово. Блоки: ${result.blocks.join(', ')}.`)
  if (result.warnings.length > 0) {
    console.log(
      `Советов по блокам: ${result.warnings.length} (цвета бумаги и скотча — свои, это нормально).`,
    )
  }
  if (result.published) {
    console.log('Сайт опубликован.')
    return
  }
  console.log(
    result.siteScriptSaved
      ? 'Страницы, тема, шапка, подвал и скрипт сайта сохранены черновиками.'
      : 'Страницы, тема, шапка и подвал сохранены черновиками. Скрипт сайта не тронут (см. выше).',
  )
  if (result.missingDocuments.length > 0) {
    console.log(
      `Документы ${result.missingDocuments.join(' и ')} — черновики из шаблона: заполните реквизиты, проверьте с юристом и опубликуйте в админке. Потом запустите скрипт с --publish или опубликуйте в админке страницы, тему, шапку, подвал и «Скрипт сайта» (без него форма записи работает, но без улучшений).`,
    )
  }
}

main().catch((error: unknown) => {
  // Ошибки API и проверки параметров — понятным текстом, без стека
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
