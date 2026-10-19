import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Витрина компонентов (/dev/ui) — только для разработки: в рабочую сборку админки она не
 * попадает. Держит это условие import.meta.env.DEV в router.tsx; тест собирает админку
 * во временную папку и ищет следы витрины в каждом выходном файле
 */

const adminDir = resolve(import.meta.dirname, '../..')

/** Текст в сборке может остаться как есть или стать \uXXXX-последовательностью */
function forms(text: string) {
  const escaped = [...text]
    .map((char) => {
      const code = char.codePointAt(0) ?? 0
      return code > 0x7e ? `\\u${code.toString(16).padStart(4, '0')}` : char
    })
    .join('')
  return [text, escaped, escaped.toUpperCase().replaceAll('\\U', '\\u')]
}

async function filesIn(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
}

describe('рабочая сборка админки', () => {
  let outDir: string
  let output: { file: string; text: string }[]

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'averra-admin-build-'))
    // Vitest ставит NODE_ENV=test, а Vite по нему решает, что import.meta.env.DEV = true, и
    // витрина попала бы в сборку. На время сборки — как у vite build: production
    const nodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      await build({
        root: adminDir,
        configFile: resolve(adminDir, 'vite.config.ts'),
        mode: 'production',
        logLevel: 'silent',
        build: { outDir, emptyOutDir: true },
      })
    } finally {
      process.env.NODE_ENV = nodeEnv
    }
    const files = (await filesIn(outDir)).filter((file) => /\.(?:js|css|html)$/u.test(file))
    output = await Promise.all(
      files.map(async (file) => ({ file, text: await readFile(file, 'utf8') })),
    )
  }, 180_000)

  afterAll(async () => {
    if (outDir) await rm(outDir, { recursive: true, force: true })
  })

  it('собралась и содержит экраны админки', () => {
    expect(output.some(({ file }) => file.endsWith('index.html'))).toBe(true)
    // Проверка не пустая: обычный текст экрана в сборке находится тем же поиском
    const screenText = forms('Опубликовать')
    expect(output.some(({ text }) => screenText.some((form) => text.includes(form)))).toBe(true)
  })

  it('витрины /dev/ui в ней нет: ни адреса, ни текстов, ни стилей', () => {
    const traces = [...forms('Витрина компонентов'), ...forms('Разделы витрины'), '/dev/ui']
    const found = output.flatMap(({ file, text }) =>
      traces.filter((trace) => text.includes(trace)).map((trace) => `${file}: ${trace}`),
    )
    expect(found).toEqual([])
  })
})
