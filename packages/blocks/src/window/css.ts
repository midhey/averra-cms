import type { MediaMap } from '@averra/schema'
import { type CompiledCss, compileCustomCss, escapeForStyleElement } from '../custom/css'
import { mediaUrlIn } from '../custom/render'

/**
 * Область CSS окон: :scope — само окно, «> .x» — блоки окна (дети содержимого). Атрибут повторён
 * не зря: стили окна по умолчанию (SiteWindows.module.css, .window[data-surface] — 0,2,0) идут на
 * странице файлом после <style> темы, и при равной специфичности победили бы. dialog[…][…] —
 * 0,2,1: свой CSS владельца перебивает вид по умолчанию
 */
export const WINDOW_CSS_SCOPE = {
  selector: 'dialog[data-site-window][data-site-window]',
  root: '[data-site-window-content]',
} as const

/**
 * Ключ CSS окон для имён @keyframes (site_window--x): «_» в ключе своего блока не бывает
 * (CustomBlockKey), поэтому анимации окон и своих блоков на одной странице не совпадут
 */
export const WINDOW_CSS_KEY = 'site_window'

/** Тексты движка CSS своих блоков — про окно: «в блоке берите :scope» здесь сбивал бы с толку */
const WINDOW_WORDING: [RegExp, string][] = [
  [/в блоке берите :scope/g, 'в окне берите :scope'],
  [/внутри блока берите/g, 'внутри окна берите'],
  [/в блоке недоступен/g, 'в CSS окон недоступен'],
  [/CSS блока/g, 'CSS окон'],
  [/вышел бы за блок/g, 'вышел бы за окно'],
  [/соседние блоки страницы/g, 'то, что вне окна'],
  [/может закрыть соседние блоки/g, 'может закрыть содержимое окна'],
]

/** z-index внутри окна действует только в окне (оно в верхнем слое): предупреждение не про него */
const NOT_ABOUT_WINDOW = /^z-index выше/

/**
 * Свой CSS окон сайта (тема, владелец): тот же движок, что у CSS своих блоков, — каждый селектор
 * внутри окна, url() — только картинки медиатеки, без @import и position: fixed. Ошибки — со
 * строкой, их показывает экран «Тема» и API при сохранении
 */
export function compileWindowCss(css: string, media?: MediaMap): CompiledCss {
  const compiled = compileCustomCss(css, WINDOW_CSS_KEY, {
    scope: WINDOW_CSS_SCOPE,
    ...(media ? { mediaUrl: mediaUrlIn(media) } : {}),
  })
  return {
    css: compiled.css,
    problems: compiled.problems
      .filter((problem) => !NOT_ABOUT_WINDOW.test(problem.message))
      .map((problem) => ({
        ...problem,
        message: WINDOW_WORDING.reduce(
          (message, [pattern, text]) => message.replace(pattern, text),
          problem.message,
        ),
      })),
  }
}

/** CSS окон для <style> страницы: только без ошибок, иначе пусто — окна в виде по умолчанию */
export function windowCssForPage(css: string | undefined, media: MediaMap) {
  if (!css || css.trim() === '') return ''
  const compiled = compileWindowCss(css, media)
  if (compiled.problems.some((problem) => problem.level === 'error')) return ''
  return escapeForStyleElement(compiled.css)
}
