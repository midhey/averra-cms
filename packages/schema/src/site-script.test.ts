import { describe, expect, it } from 'vitest'
import { CustomBlockDraft, starterCustomBlock } from './custom-blocks'
import { readSiteScript, SCRIPT_ORIGINS_MAX, ScriptOrigin, SiteScript } from './site-script'

describe('ScriptOrigin', () => {
  it.each([
    'https://widget.example.ru',
    'https://*.example.ru',
    'https://cdn.jsdelivr.net',
    'https://example.ru:8443',
  ])('принимает %s', (origin) => {
    expect(ScriptOrigin.parse(origin)).toBe(origin)
  })

  it('приводит к нижнему регистру и убирает косую черту в конце', () => {
    expect(ScriptOrigin.parse(' HTTPS://Widget.Example.ru/ ')).toBe('https://widget.example.ru')
  })

  // Строка уходит в заголовок CSP как есть: любой лишний знак — своя директива или источник
  it.each([
    'http://widget.example.ru',
    'https://widget.example.ru/path',
    "https://a.ru 'unsafe-inline'",
    'https://a.ru; script-src *',
    'https://a.ru,https://b.ru',
    '*',
    'https://*',
    'https://*.ru',
    'data:',
    "'self'",
    'https://a.ru?x',
    'https://localhost',
  ])('отклоняет %s', (origin) => {
    expect(ScriptOrigin.safeParse(origin).success).toBe(false)
  })
})

describe('SiteScript', () => {
  it('пусто по умолчанию', () => {
    expect(SiteScript.parse({})).toEqual({ script: '', origins: [] })
  })

  it('повторы и слишком много доменов — ошибка', () => {
    const twice = SiteScript.safeParse({ origins: ['https://a.ru', 'https://A.ru/'] })
    expect(twice.success).toBe(false)
    const many = Array.from({ length: SCRIPT_ORIGINS_MAX + 1 }, (_, i) => `https://s${i}.ru`)
    expect(SiteScript.safeParse({ origins: many }).success).toBe(false)
  })

  it('из базы: чужое и пустое — как будто скрипта нет', () => {
    expect(readSiteScript(null)).toEqual({ script: '', origins: [] })
    expect(readSiteScript({ script: 1 })).toEqual({ script: '', origins: [] })
    expect(readSiteScript({ script: 'a()', origins: [] })).toEqual({ script: 'a()', origins: [] })
  })
})

describe('скрипт своего блока', () => {
  it('по умолчанию пустой, длина ограничена', () => {
    const block = starterCustomBlock('tariffs', 'Тарифы')
    expect(block.script).toBe('')
    expect(CustomBlockDraft.safeParse({ ...block, script: 'x'.repeat(20_001) }).success).toBe(false)
    expect(CustomBlockDraft.parse({ ...block, script: 'blocks.length' }).script).toBe(
      'blocks.length',
    )
  })
})
