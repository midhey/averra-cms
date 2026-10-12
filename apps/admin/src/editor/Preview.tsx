import { Page } from '@cms/blocks'
import baseCss from '@cms/blocks/base.css?inline'
import type { PageContent, Theme } from '@cms/schema'
import { themeToCss } from '@cms/tokens'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  /** Что показано, если не черновик: например, версия из истории */
  note?: string
}

export function Preview({ content, theme, note }: PreviewProps) {
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

  // Стили в iframe: CSS блоков из админки, базовые стили лендинга и тема сайта.
  // Vite подменяет стили при правках, поэтому следим за <head> админки и копируем заново
  useEffect(() => {
    if (!frameDocument) return
    const themeCss = themeToCss(theme)
    const sync = () => {
      const copied = [...document.querySelectorAll('style, link[rel="stylesheet"]')].map((node) =>
        node.cloneNode(true),
      )
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
      {frameDocument && createPortal(<Page content={content} />, frameDocument.body)}
    </section>
  )
}

function styleElement(owner: Document, css: string) {
  const style = owner.createElement('style')
  style.textContent = css
  return style
}
