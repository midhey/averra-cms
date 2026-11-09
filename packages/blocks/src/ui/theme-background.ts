import type { MediaMap, Theme } from '@averra/schema'
import { escapeForStyleElement } from '../custom/css'
import { fullSizeUrl } from './media-file'

/**
 * Фон-картинка страницы из темы — правило body для <style> темы. Узор повторяется в своём размере
 * (зерно бумаги), «на всю страницу» — растянута и стоит на месте при прокрутке (iOS прокручивает
 * её вместе со страницей). Цвет фона темы остаётся под картинкой: пока она грузится и если её нет
 * в справочнике (удалили) — фон как был. Адрес — из справочника картинок сборки, кавычки и \
 * в нём экранированы, «</style» не закроет <style> раньше времени
 */
export function themeBackgroundCss(theme: Pick<Theme, 'background'>, media: MediaMap) {
  const background = theme.background
  const file = background && media[background.mediaId]
  const url = file && fullSizeUrl(file)
  if (!background || !url) return ''
  const quoted = `"${url.replace(/[\\"]/g, '\\$&').replace(/[\n\r\f]/g, '')}"`
  return escapeForStyleElement(
    background.size === 'cover'
      ? `body{background-image:url(${quoted});background-size:cover;background-position:center;background-attachment:fixed}`
      : `body{background-image:url(${quoted});background-repeat:repeat}`,
  )
}
