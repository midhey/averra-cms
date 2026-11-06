import { type CustomBlockMap, customBlocksCss, Page } from '@averra/blocks'
import baseCss from '@averra/blocks/base.css?inline'
import { customBlockKeysOf, type MediaMap, type PageContent, type Theme } from '@averra/schema'
import { themeToCss } from '@averra/tokens'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { previewStyleNodes } from '../styles/global-style'
import { previewFontCss } from '../theme/preview-fonts'
import { DEVICE_WIDTHS, type Device } from './Preview'
import styles from './Preview.module.scss'
import { SANDBOX_PERMISSIONS, type SandboxScript, sandboxDocument } from './sandbox-document'

type SandboxPreviewProps = {
  content: PageContent
  theme: Theme
  media: MediaMap
  device: Device
  customBlocks?: CustomBlockMap | undefined
  /** Файлы скриптов, как на сайте: скрипт сайта и скрипты своих блоков */
  scripts: readonly SandboxScript[]
  title?: string
}

const styleTag = (css: string) => `<style>${css.replaceAll('</style', '<\\/style')}</style>`

/**
 * Предпросмотр, который выполняет свои скрипты. Страница — те же блоки, что на сайте, собранные в
 * HTML, внутри <iframe sandbox="allow-scripts"> без allow-same-origin (sandbox-document.ts): скрипт
 * в нём не достанет до сессии админки, её cookie, хранилища и окна. Выбора блока щелчком и
 * подсветки нет — это обычный предпросмотр (Preview), без скриптов
 */
export function SandboxPreview(props: SandboxPreviewProps) {
  const { content, theme, media, device, customBlocks, scripts } = props
  const stageRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const width = DEVICE_WIDTHS[device]

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const fit = (available: number) => {
      if (available > 0) setScale(Math.min(1, available / width))
    }
    const style = getComputedStyle(stage)
    fit(
      stage.clientWidth -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight),
    )
    const observer = new ResizeObserver(([entry]) => {
      if (entry) fit(entry.contentRect.width)
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [width])

  const html = useMemo(() => {
    const copied = previewStyleNodes(document)
      .map((node) => node.outerHTML)
      .join('')
    const customCss = customBlocks
      ? customBlocksCss(customBlockKeysOf(content), customBlocks, media)
      : ''
    let body: string
    try {
      body = renderToStaticMarkup(
        <Page content={content} media={media} customBlocks={customBlocks} preview />,
      )
    } catch {
      body = '<p style="padding:24px;font:16px system-ui">Предпросмотр не получилось нарисовать</p>'
    }
    return sandboxDocument({
      origin: window.location.origin,
      head: [
        copied,
        styleTag(baseCss),
        styleTag(previewFontCss(theme) + themeToCss(theme)),
        styleTag(customCss),
      ].join(''),
      body,
      scripts,
    })
  }, [content, theme, media, customBlocks, scripts])

  return (
    <div className={styles.preview}>
      <div ref={stageRef} className={styles.stage}>
        <div className={styles.frameBox} style={{ width: width * scale }}>
          {/* Новый документ на каждую правку: скрипты выполняются заново, как при открытии страницы */}
          <iframe
            title={props.title ?? 'Предпросмотр со скриптами'}
            className={styles.frame}
            srcDoc={html}
            sandbox={SANDBOX_PERMISSIONS}
            data-sandbox-preview=""
            style={{ width, height: `${100 / scale}%`, transform: `scale(${scale})` }}
          />
        </div>
      </div>
    </div>
  )
}
