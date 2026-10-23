import fontUrls from 'virtual:averra/font-files'
import type { Theme } from '@averra/schema'
import { fontFaceCss, themeFontFiles } from '@averra/tokens'

/**
 * @font-face шрифтов темы для предпросмотра — те же начертания, что попадут на сайт, но файлы
 * отдаёт админка (адреса Vite). Браузер грузит файл, только когда шрифт стоит на странице
 */
export function previewFontCss(theme: Theme) {
  const files = themeFontFiles(theme).filter((file) => fontUrls[file.file] !== undefined)
  return fontFaceCss(files, (file) => fontUrls[file.file] ?? '')
}
