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

  it('то, что скрипт разбирает, а модуль нет: HTML-комментарии и new.target в стрелке', () => {
    expect(scriptSyntaxError('let a = 1 <!-- x')).toBeTypeOf('string')
    expect(scriptSyntaxError('let a = 1\n--> x')).toBeTypeOf('string')
    expect(scriptSyntaxError('const t = new.target')).toBeTypeOf('string')
    // В тексте те же знаки допустимы, и new.target внутри своей функции тоже
    expect(scriptSyntaxError('const s = "<!-- ok -->"')).toBeUndefined()
    expect(scriptSyntaxError('const s = `\n--> text`')).toBeUndefined()
    expect(scriptSyntaxError('// <!-- note\nlet n = 3')).toBeUndefined()
    expect(scriptSyntaxError('let i = 3; while (i --> 0) {}')).toBeUndefined()
    expect(scriptSyntaxError('function F() { return new.target }')).toBeUndefined()
    const problems = scriptProblems('let a = 1 <!-- x')
    expect(problems.some((one) => one.level === 'error')).toBe(true)
  })

  it('«-->» после многострочного комментария и «await» как имя — ошибка, в тексте — нет', () => {
    expect(scriptSyntaxError('/*\n*/ --> foo')).toBeTypeOf('string')
    expect(scriptSyntaxError('function f() { const await = 1; return await }')).toBeTypeOf('string')
    expect(scriptSyntaxError('function f(await) { return 1 }')).toBeTypeOf('string')
    expect(scriptSyntaxError('const g = await => 1')).toBeTypeOf('string')
    // Деструктуринг и сокращённое свойство с именем await — модуль их не разбирает
    expect(scriptSyntaxError('function f() { const { await } = { await: 1 } }')).toBeTypeOf(
      'string',
    )
    expect(scriptSyntaxError('function f(b) { const { a, await } = b }')).toBeTypeOf('string')
    expect(scriptSyntaxError('function f(b) { const { await, a } = b }')).toBeTypeOf('string')
    // Поле класса с именем await — корректный модуль
    expect(scriptSyntaxError('class A { await = 1 }')).toBeUndefined()
    expect(scriptSyntaxError('class A { static await = 1; x = 2 }')).toBeUndefined()
    // В тексте и как ключ объекта — можно; await-выражение в async-функции — тоже
    expect(scriptSyntaxError('const s = "/* */ --> text"')).toBeUndefined()
    expect(scriptSyntaxError("const s = 'const await = 1'")).toBeUndefined()
    expect(
      scriptSyntaxError('// function (await) {}\nconst o = { await: 1 }; o.await'),
    ).toBeUndefined()
    expect(scriptSyntaxError('const f = async () => { await Promise.resolve() }')).toBeUndefined()
  })

  it('скрипт на пределе лимита с тысячами совпадений проверяется быстро', () => {
    // По пробе на совпадение это были десятки секунд синхронного процессора
    const limit = 20_000
    const cases = [
      `const s = "${'<!--'.repeat(Math.floor(limit / 4) - 10)}"`,
      `const s = [${'"await",'.repeat(Math.floor(limit / 8) - 10)}]`,
      `const s = \`${'\n-->'.repeat(Math.floor(limit / 4) - 10)}\``,
    ]
    for (const code of cases) {
      expect(code.length).toBeLessThanOrEqual(limit)
      const started = performance.now()
      expect(scriptSyntaxError(code)).toBeUndefined()
      expect(performance.now() - started).toBeLessThan(500)
    }
    // И в коде среди тысяч совпадений в тексте ошибка всё равно находится
    expect(scriptSyntaxError(`const s = "${'<!--'.repeat(2000)}"\nlet a = 1 <!-- x`)).toBeTypeOf(
      'string',
    )
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
