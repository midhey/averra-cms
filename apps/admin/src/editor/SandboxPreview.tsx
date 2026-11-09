import { type CustomBlockMap, customBlocksCss, Page } from '@averra/blocks'
import baseCss from '@averra/blocks/base.css?inline'
import { customBlockKeysOf, type MediaMap, type PageContent, type Theme } from '@averra/schema'
import { themeToCss } from '@averra/tokens'
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { previewStyleNodes } from '../styles/global-style'
import { previewFontCss } from '../theme/preview-fonts'
import { InlineAlert } from '../ui/InlineAlert'
import { DEVICE_WIDTHS, type Device } from './Preview'
import styles from './Preview.module.scss'
import {
  SANDBOX_PERMISSIONS,
  type SandboxScript,
  sandboxDocument,
  sandboxGoneMessage,
} from './sandbox-document'

type SandboxPreviewProps = {
  content: PageContent
  theme: Theme
  media: MediaMap
  device: Device
  customBlocks?: CustomBlockMap | undefined
  /** Файлы скриптов, как на сайте: скрипт сайта и скрипты своих блоков */
  scripts: readonly SandboxScript[]
  title?: string
  /** Перед страницей и после неё: шапка и подвал сайта, как в обычном предпросмотре */
  before?: ReactNode
  extra?: ReactNode
  /** Ключи своих шапки и подвала: их CSS тоже нужен */
  placeKeys?: readonly string[] | undefined
}

/**
 * Метка документа — от его содержимого: другой документ (правка) — другая метка, и уход прежнего
 * не сочтут уводом нового; тот же (перерисовка без правок) — та же метка и тот же srcDoc, поэтому
 * рамка не перезагружается и скрипты не запускаются заново
 */
function documentToken(html: string) {
  let hash = 2166136261
  for (let at = 0; at < html.length; at++) {
    hash = Math.imul(hash ^ html.charCodeAt(at), 16777619)
  }
  return (hash >>> 0).toString(36)
}

const styleTag = (css: string) => `<style>${css.replaceAll('</style', '<\\/style')}</style>`

/**
 * Предпросмотр, который выполняет свои скрипты. Страница — те же блоки, что на сайте, собранные в
 * HTML, внутри <iframe sandbox="allow-scripts"> без allow-same-origin (sandbox-document.ts): скрипт
 * в нём не достанет до сессии админки, её cookie, хранилища и окна. Выбора блока щелчком и
 * подсветки нет — это обычный предпросмотр (Preview), без скриптов
 */
export function SandboxPreview(props: SandboxPreviewProps) {
  const { content, theme, media, device, customBlocks, scripts, before, extra } = props
  const placeKeys = props.placeKeys?.join(' ') ?? ''
  const stageRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  // Скрипт в рамке пытается увести её на чужой адрес (location.href): главная защита — frame-src
  // в CSP админки (index.html), браузер такой переход блокирует. Второй рубеж на случай, если
  // переход всё же состоялся (204 и подобное): сообщение рамки на pagehide и второй load —
  // тогда возвращаем свой документ и предупреждаем. document.open() обработчик pagehide стирает,
  // поэтому на одно обнаружение положиться нельзя
  const loadsRef = useRef(0)
  const [attempt, setAttempt] = useState(0)
  const [hijacked, setHijacked] = useState(false)
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

  const docs = useMemo(() => {
    const copied = previewStyleNodes(document)
      .map((node) => node.outerHTML)
      .join('')
    const keys = [
      ...new Set([...placeKeys.split(' ').filter(Boolean), ...customBlockKeysOf(content)]),
    ]
    const customCss = customBlocks ? customBlocksCss(keys, customBlocks, media) : ''
    let body: string
    try {
      body = renderToStaticMarkup(
        <>
          {before}
          <Page content={content} media={media} customBlocks={customBlocks} preview />
          {extra}
        </>,
      )
    } catch {
      body = '<p style="padding:24px;font:16px system-ui">Предпросмотр не получилось нарисовать</p>'
    }
    const build = (run: readonly SandboxScript[]) => {
      const input = {
        origin: window.location.origin,
        head: [
          copied,
          styleTag(baseCss),
          styleTag(previewFontCss(theme) + themeToCss(theme)),
          styleTag(customCss),
        ].join(''),
        body,
        scripts: run,
      }
      const token = documentToken(sandboxDocument({ ...input, token: '' }))
      return { html: sandboxDocument({ ...input, token }), token }
    }
    // Второй документ — для рамки, которую уводили с места: скрипты второй раз не запускаем
    const withScripts = build(scripts)
    const withoutScripts = build([])
    return { withScripts, withoutScripts }
  }, [content, theme, media, customBlocks, scripts, before, extra, placeKeys])
  const shown = hijacked ? docs.withoutScripts : docs.withScripts
  const shownToken = useRef(shown.token)
  shownToken.current = shown.token

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // event.source у ушедшего документа уже не рамка (после перехода это другое окно), поэтому
      // сверяем источник «null» (непрозрачный у sandbox без allow-same-origin) и метку документа
      if (event.origin !== 'null' || event.data !== sandboxGoneMessage(shownToken.current)) return
      loadsRef.current = 0
      setHijacked(true)
      setAttempt((value) => value + 1)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Новая правка — новый документ: счёт загрузок и предупреждение начинаются заново
  useEffect(() => {
    loadsRef.current = 0
    setHijacked(false)
  }, [docs.withScripts.html])

  return (
    <div className={styles.preview}>
      {hijacked && (
        <div data-sandbox-hijacked="">
          <InlineAlert tone="danger" title="Скрипт пытался увести предпросмотр">
            Предпросмотр возвращён на место. Скрипту не стоит доверять: проверьте его код.
          </InlineAlert>
        </div>
      )}
      <div ref={stageRef} className={styles.stage}>
        <div className={styles.frameBox} style={{ width: width * scale }}>
          {/* Новый документ на каждую правку: скрипты выполняются заново, как при открытии страницы */}
          <iframe
            key={attempt}
            onLoad={() => {
              loadsRef.current += 1
              if (loadsRef.current > 1) {
                loadsRef.current = 0
                setHijacked(true)
                setAttempt((value) => value + 1)
              }
            }}
            title={props.title ?? 'Предпросмотр со скриптами'}
            className={styles.frame}
            srcDoc={shown.html}
            sandbox={SANDBOX_PERMISSIONS}
            data-sandbox-preview=""
            style={{ width, height: `${100 / scale}%`, transform: `scale(${scale})` }}
          />
        </div>
      </div>
    </div>
  )
}
