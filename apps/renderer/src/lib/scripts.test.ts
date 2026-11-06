import { describe, expect, it, vi } from 'vitest'
import { allScriptFiles, blockScriptFileOf, pageScriptFiles, siteScriptFileOf } from './scripts'

const customBlocks = {
  tabs: { key: 'tabs', script: 'blocks.forEach((b) => b.classList.add("ready"))' },
  plain: { key: 'plain', script: '' },
  quiz: { key: 'quiz', script: 'console.log(blocks.length)' },
}
const siteScript = { script: 'document.documentElement.dataset.js = ""' }

describe('скрипты страницы', () => {
  it('скрипт сайта первым, потом блоки страницы — каждый один раз, в порядке страницы', () => {
    const files = pageScriptFiles({
      siteScript,
      blockKeys: ['quiz', 'plain', 'tabs', 'quiz'],
      customBlocks,
    })
    expect(files.map((file) => file.src.replace(/\.[0-9a-f]{10}\.js$/, ''))).toEqual([
      '/_scripts/site',
      '/_scripts/block-quiz',
      '/_scripts/block-tabs',
    ])
  })

  it('блока нет на странице — нет и его скрипта; без скриптов — ни одного файла', () => {
    expect(pageScriptFiles({ siteScript, blockKeys: [], customBlocks })).toHaveLength(1)
    expect(
      pageScriptFiles({ siteScript: { script: '  ' }, blockKeys: ['plain'], customBlocks }),
    ).toEqual([])
    // Ключ блока, которого нет среди опубликованных, ничего не добавляет
    expect(
      pageScriptFiles({ siteScript: { script: '' }, blockKeys: ['gone'], customBlocks }),
    ).toEqual([])
  })

  it('имя — хеш содержимого: новый код — новый адрес, тот же код — тот же адрес', () => {
    const a = blockScriptFileOf({ key: 'tabs', script: 'a()' })
    const same = blockScriptFileOf({ key: 'tabs', script: 'a()' })
    const b = blockScriptFileOf({ key: 'tabs', script: 'b()' })
    expect(a?.src).toMatch(/^\/_scripts\/block-tabs\.[0-9a-f]{10}\.js$/)
    expect(a?.src).toBe(same?.src)
    expect(a?.src).not.toBe(b?.src)
    expect(a?.content).toContain('[data-custom-block="tabs"]')
  })

  it('скрипт с ошибкой разбора не выводится, а в журнал сборки пишется причина', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(siteScriptFileOf({ script: 'const = 1' })).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Скрипт сайта не выведен'))
    warn.mockRestore()
  })

  it('сборка пишет все скрипты сайта', () => {
    expect(
      allScriptFiles({ siteScript, customBlocks }).map((file) => file.name.split('.')[0]),
    ).toEqual(['site', 'block-tabs', 'block-quiz'])
  })
})
