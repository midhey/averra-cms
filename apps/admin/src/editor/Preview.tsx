import { Page } from '@averra/blocks'
import baseCss from '@averra/blocks/base.css?inline'
import type { MediaMap, PageContent, Theme } from '@averra/schema'
import { themeToCss } from '@averra/tokens'
import { Component, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { previewStyleNodes } from '../styles/global-style'
import styles from './Preview.module.css'

const devices = { phone: 375, tablet: 768, desktop: 1280 } as const
type Device = keyof typeof devices
const deviceLabels: Record<Device, string> = {
  phone: 'Телефон',
  tablet: 'Планшет',
  desktop: 'Десктоп',
}

const EMPTY_DOCUMENT = '<!doctype html><html lang="ru"><head></head><body></body></html>'

/**
 * Предпросмотр — те же компоненты блоков, что собирают сайт, только внутри iframe.
 * Так стили лендинга не смешиваются со стилями админки, а медиазапросы срабатывают
 * по ширине выбранного устройства
 */
type PreviewProps = {
  content: PageContent
  theme: Theme
  /** Картинки сайта: блоки берут из справочника адреса вариантов, как на опубликованном сайте */
  media: MediaMap
  /** Что показано, если не черновик: например, версия из истории */
  note?: string
}

export function Preview({ content, theme, media, note }: PreviewProps) {
  const [device, setDevice] = useState<Device>('desktop')
  const [frameDocument, setFrameDocument] = useState<Document | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const width = devices[device]

  // Широкий «десктоп» ужимаем под ширину колонки, чтобы видеть страницу целиком
  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const fit = (available: number) => setScale(Math.min(1, available / width))
    // Первый замер делаем сами: ResizeObserver присылает размеры только на кадре отрисовки,
    // а в фоновой вкладке кадров нет
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

  // Стили в iframe: CSS блоков из админки (без её глобального слоя), базовые стили лендинга и тема сайта.
  // Vite подменяет стили при правках, поэтому следим за <head> админки и копируем заново
  useEffect(() => {
    if (!frameDocument) return
    const themeCss = themeToCss(theme)
    const sync = () => {
      const copied = previewStyleNodes(document).map((node) => node.cloneNode(true))
      frameDocument.head.replaceChildren(
        ...copied,
        styleElement(frameDocument, baseCss),
        styleElement(frameDocument, themeCss),
      )
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.head, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [frameDocument, theme])

  // Ссылки в предпросмотре никуда не уводят, кроме якорей внутри страницы
  useEffect(() => {
    if (!frameDocument) return
    const stay = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest('a') : null
      if (link && !link.getAttribute('href')?.startsWith('#')) event.preventDefault()
    }
    frameDocument.addEventListener('click', stay)
    return () => frameDocument.removeEventListener('click', stay)
  }, [frameDocument])

  return (
    <section className={styles.preview} aria-label="Предпросмотр">
      <fieldset className={styles.toolbar}>
        <legend className={styles.hidden}>Ширина экрана</legend>
        {(Object.keys(devices) as Device[]).map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={name === device}
            onClick={() => setDevice(name)}
          >
            {deviceLabels[name]} · {devices[name]}
          </button>
        ))}
      </fieldset>
      {/* Живая область есть всегда, даже пустая: так экранный диктор прочитает смену версии */}
      <p className={styles.note} aria-live="polite">
        {note}
      </p>
      <div ref={stageRef} className={styles.stage}>
        <div className={styles.frameBox} style={{ width: width * scale }}>
          <iframe
            title="Предпросмотр страницы"
            className={styles.frame}
            srcDoc={EMPTY_DOCUMENT}
            sandbox="allow-same-origin"
            style={{ width, height: `${100 / scale}%`, transform: `scale(${scale})` }}
            onLoad={(event) => setFrameDocument(event.currentTarget.contentDocument)}
          />
        </div>
      </div>
      {frameDocument &&
        createPortal(
          <PreviewBoundary content={content}>
            <Page content={content} media={media} />
          </PreviewBoundary>,
          frameDocument.body,
        )}
    </section>
  )
}

function styleElement(owner: Document, css: string) {
  const style = owner.createElement('style')
  style.textContent = css
  return style
}

type BoundaryProps = { content: PageContent; children: ReactNode }
type BoundaryState = { failed: boolean; content: PageContent }

/**
 * Упавший блок ломает только предпросмотр, а не весь редактор с несохранёнными правками:
 * без этой границы ошибку поймал бы экран ошибки роутера. Новое содержимое — новая попытка
 */
class PreviewBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failed: false, content: this.props.content }

  static getDerivedStateFromError(): Partial<BoundaryState> {
    return { failed: true }
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState) {
    return props.content === state.content ? null : { failed: false, content: props.content }
  }

  override render() {
    if (!this.state.failed) return this.props.children
    return (
      <p style={{ padding: 24, font: '16px system-ui' }}>Предпросмотр не получилось нарисовать</p>
    )
  }
}
