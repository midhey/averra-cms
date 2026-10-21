// Прод-сборка API: TypeScript → JavaScript в dist/server, чтобы на сервере API
// и команды запускались обычной Node, без tsx и dev-зависимостей.
//
// В бандл входит наш код и пакеты рабочей области (@averra/schema, @averra/tokens): они
// экспортируют исходники .ts, а Node не снимает типы с файлов внутри node_modules. Остальные
// зависимости остаются внешними и ставятся в образ как обычные prod-зависимости: у sharp и PGlite
// свои бинарные файлы и wasm рядом с пакетом, их бандлить нельзя.
//
// Глубина важна: dist/server/*.js лежат на два уровня ниже apps/api, как src/db/migrate.ts
// и src/publish/renderer.ts. Пути от import.meta.url (папка миграций ../../drizzle, рендерер
// ../../../renderer) поэтому одни и те же в исходниках и в сборке — это проверяет конец скрипта.
// Запуск: pnpm --filter @averra/api build (Node 24 сама снимает типы с этого файла)
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('..', import.meta.url))
const outdir = fileURLToPath(new URL('../dist/server', import.meta.url))

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  dependencies: Record<string, string>
}
// Внешние — все prod-зависимости, кроме пакетов рабочей области, и их подпути (drizzle-orm/pglite)
const external = Object.keys(pkg.dependencies)
  .filter((name) => !pkg.dependencies[name]?.startsWith('workspace:'))
  .flatMap((name) => [name, `${name}/*`])

/** Точки входа: API и команды терминала, которые нужны на сервере */
const entryPoints = {
  index: 'src/index.ts',
  'user-create': 'src/cli/user-create.ts',
  'user-password': 'src/cli/user-password.ts',
  'member-add': 'src/cli/member-add.ts',
  'member-invite': 'src/cli/member-invite.ts',
  'token-create': 'src/cli/token-create.ts',
  'token-list': 'src/cli/token-list.ts',
  'token-revoke': 'src/cli/token-revoke.ts',
  'mail-test': 'src/cli/mail-test.ts',
  status: 'src/cli/status.ts',
}

rmSync(outdir, { recursive: true, force: true })
await build({
  absWorkingDir: root,
  entryPoints,
  outdir,
  bundle: true,
  // Общий код API и команд — в общих кусках, а не копией в каждой точке входа
  splitting: true,
  // Куски — рядом с точками входа, на той же глубине (см. начало файла)
  chunkNames: '[name]-[hash]',
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external,
  sourcemap: 'linked',
  // Имена функций и классов остаются: по ним читается стек ошибки и работают instanceof-проверки имени
  keepNames: true,
  logLevel: 'warning',
})

// Проверяем по факту: путь к миграциям из src/db/migrate.ts от файла в dist/server — это
// apps/api/drizzle, а к рендереру из src/publish/renderer.ts — apps/renderer
const entry = new URL('../dist/server/index.js', import.meta.url)
const migrations = fileURLToPath(new URL('../../drizzle', entry))
const renderer = fileURLToPath(new URL('../../../renderer/scripts/build-release.mjs', entry))
if (!existsSync(migrations)) throw new Error(`Нет папки миграций по пути из сборки: ${migrations}`)
if (!existsSync(renderer)) throw new Error(`Нет сборщика рендерера по пути из сборки: ${renderer}`)
console.log(`API собран в ${outdir}`)
