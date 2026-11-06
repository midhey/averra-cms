// @vitest-environment happy-dom
import { starterCustomBlock } from '@averra/schema'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { customBlockProblems } from './render'
import { customBlockScriptFile, scriptProblems, scriptSyntaxError, siteScriptFile } from './script'

/** Выполнить файл скрипта как модуль страницы: async-функцией, без доступа к модулю теста */
async function run(file: string) {
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
  await new AsyncFunction(`'use strict';\n${file}`)()
  // Обёртка не ждёт кода автора: даём его промисам завершиться
  await new Promise((resolve) => setTimeout(resolve, 0))
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('scriptSyntaxError', () => {
  it('пустой и обычный код разбираются, await можно', () => {
    expect(scriptSyntaxError('')).toBeUndefined()
    expect(scriptSyntaxError('for (const b of blocks) b.dataset.ready = ""')).toBeUndefined()
    expect(scriptSyntaxError('await new Promise((r) => setTimeout(r, 10))')).toBeUndefined()
  })

  it('ошибка разбора, import и выход из обёртки — ошибка', () => {
    expect(scriptSyntaxError('const = 1')).toBeTypeOf('string')
    expect(scriptSyntaxError("import x from 'y'")).toBeTypeOf('string')
    // Код не может закрыть обёртку и продолжиться снаружи: тело функции разбирается само по себе
    expect(scriptSyntaxError('}); alert(1); ((async () => {')).toBeTypeOf('string')
    // Строгий режим, как у модуля
    expect(scriptSyntaxError('with (blocks) {}')).toBeTypeOf('string')
  })

  it('код не выполняется при проверке', () => {
    const spy = vi.fn()
    ;(globalThis as { spy?: unknown }).spy = spy
    scriptSyntaxError('globalThis.spy()')
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('scriptProblems', () => {
  it('ошибка разбора — error, то, что запретит CSP, — warning со строкой', () => {
    expect(scriptProblems('const = 1')).toEqual([
      expect.objectContaining({ part: 'script', level: 'error' }),
    ])
    const warnings = scriptProblems("const a = 1\neval('a')\nsetTimeout('x()', 1)")
    expect(warnings).toEqual([
      expect.objectContaining({ level: 'warning', line: 2 }),
      expect.objectContaining({ level: 'warning', line: 3 }),
    ])
  })

  it('проверка своего блока включает скрипт', () => {
    const block = { ...starterCustomBlock('tariffs', 'Тарифы'), script: 'const = 1' }
    expect(customBlockProblems(block)).toContainEqual(
      expect.objectContaining({ part: 'script', level: 'error' }),
    )
  })
})

describe('файлы скриптов', () => {
  it('скрипт блока получает только корни своих блоков, по порядку', async () => {
    document.body.innerHTML = `
      <section data-custom-block="tariffs" id="a"></section>
      <section data-custom-block="faq-x" id="b"></section>
      <section data-custom-block="tariffs" id="c"></section>`
    await run(
      customBlockScriptFile(
        'tariffs',
        'document.body.dataset.ids = blocks.map((b) => b.id).join()',
      ),
    )
    expect(document.body.dataset.ids).toBe('a,c')
  })

  it('ошибка в коде автора не выходит наружу: она в консоли с названием блока', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(
      run(customBlockScriptFile('tariffs', 'throw new Error("сломалось")')),
    ).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledWith(
      'Ошибка в скрипте своего блока «tariffs»:',
      expect.objectContaining({ message: 'сломалось' }),
    )
  })

  it('последний комментарий не съедает обёртку, многострочные строки не меняются', async () => {
    await run(siteScriptFile('document.body.dataset.text = `a\n b`\n// конец'))
    expect(document.body.dataset.text).toBe('a\n b')
  })
})
