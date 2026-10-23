import { Page } from '@averra/blocks'
import baseCss from '@averra/blocks/base.css?inline'
import type { MediaMap, PageContent, Theme } from '@averra/schema'
import { themeToCss } from '@averra/tokens'
import {
  Component,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { previewStyleNodes } from '../styles/global-style'
import { previewFontCss } from '../theme/preview-fonts'
import { InlineAlert } from '../ui/InlineAlert'
import { SegmentedControl } from '../ui/SegmentedControl'
import styles from './Preview.module.scss'
import { blockIdAt, previewSelectionCss, type SelectionColors } from './preview-selection'

const devices = { phone: 375, tablet: 768, desktop: 1280 } as const
export type Device = keyof typeof devices
const deviceLabels: Record<Device, string> = {
  phone: 'Телефон',
  tablet: 'Планшет',
  desktop: 'Десктоп',
}

/** Переключатель ширины предпросмотра: в полосе редактора, на узком экране — над предпросмотром */
export function DeviceSwitch({
  value,
  onChange,
}: {
  value: Device
  onChange: (device: Device) => void
}) {
  return (
    <SegmentedControl
      legend="Ширина предпросмотра"
      hideLegend
      options={(Object.keys(devices) as Device[]).map((name) => ({
        value: name,
        label: deviceLabels[name],
      }))}
      value={value}
      onChange={onChange}
    />
  )
}

const EMPTY_DOCUMENT = '<!doctype html><html lang="ru"><head></head><body></body></html>'

type PreviewProps = {
  content: PageContent
  theme: Theme
  /** Картинки сайта: блоки берут из справочника адреса вариантов, как на опубликованном сайте */
  media: MediaMap
  device: Device
  /** Что показано, если не черновик: например, версия из истории */
  note?: string | undefined
  /** Выбранный блок черновика: он подсвечен рамкой */
  selectedId: string | null
  /** Щелчок по блоку в предпросмотре. Без него (версия из истории) выбирать нечего */
  onSelectBlock?: ((id: string) => void) | undefined
  /** Над предпросмотром: переключатель ширины на узком экране */
  toolbar?: ReactNode
  /** После страницы в iframe: cookie-уведомление и подвал на экране «Cookie и согласие» */
  extra?: ReactNode
  /** Подпись iframe для диктора */
  title?: string
}

/** Роли темы админки для подсветки: их значения читаем из её документа */
function readSelectionColors(): SelectionColors {
  const style = getComputedStyle(document.documentElement)
  return {
    selection: style.getPropertyValue('--color-action') || 'currentcolor',
    hover: style.getPropertyValue('--color-border-strong') || 'currentcolor',
  }
}

/**
 * Предпросмотр — те же компоненты блоков, что собирают сайт, только внутри iframe.
 * Так стили лендинга не смешиваются со стилями админки, а медиазапросы срабатывают
 * по ширине выбранного устройства. Подсветка выбранного блока и выбор щелчком — свой стиль
 * и обработчик в iframe: в блоках и на опубликованном сайте их нет
 */
export function Preview(props: PreviewProps) {
  const { content, theme, media, device, note, selectedId, onSelectBlock, toolbar, extra } = props
  const [frameDocument, setFrameDocument] = useState<Document | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const width = devices[device]
  const selectionStyle = useMemo(() => frameDocument?.createElement('style'), [frameDocument])
  const blockIds = useMemo(() => new Set(content.blocks.map((block) => block.id)), [content])

  // Широкий «десктоп» ужимаем под ширину колонки, чтобы видеть страницу целиком
  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    // Скрытая вкладка (узкий экран) шириной 0: масштаб не трогаем, пока её не покажут
    const fit = (available: number) => {
      if (available > 0) setScale(Math.min(1, available / width))
    }
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

  // Стили в iframe: CSS блоков из админки (без её глобального слоя), базовые стили лендинга,
  // шрифты и тема сайта и подсветка выбранного блока. Vite подменяет стили при правках, поэтому
  // следим за <head> админки и копируем заново
  useEffect(() => {
    if (!frameDocument || !selectionStyle) return
    // Шрифты темы — перед её переменными, как в <head> сайта
    const themeCss = previewFontCss(theme) + themeToCss(theme)
    const sync = () => {
      const copied = previewStyleNodes(document).map((node) => node.cloneNode(true))
      frameDocument.head.replaceChildren(
        ...copied,
        styleElement(frameDocument, baseCss),
        styleElement(frameDocument, themeCss),
        selectionStyle,
      )
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.head, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [frameDocument, theme, selectionStyle])

  const interactive = onSelectBlock !== undefined
  useEffect(() => {
    if (!selectionStyle) return
    selectionStyle.textContent = previewSelectionCss({
      selectedId,
      scale,
      colors: readSelectionColors(),
      interactive,
    })
  }, [selectionStyle, selectedId, scale, interactive])

  // Выбранный в списке блок, которого не видно, — прокручиваем к нему
  useEffect(() => {
    const view = frameDocument?.defaultView
    if (!view || selectedId === null || !interactive) return
    const block = frameDocument.getElementById(selectedId)
    if (!block) return
    const { top, bottom } = block.getBoundingClientRect()
    if (bottom > 0 && top < view.innerHeight) return
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    view.scrollTo({ top: view.scrollY + top, behavior: calm ? 'auto' : 'smooth' })
  }, [frameDocument, selectedId, interactive])

  // Ссылки в предпросмотре никуда не уводят, кроме якорей внутри страницы. Щелчок по блоку
  // выбирает его. Элементы iframe — из другого окна, поэтому не instanceof Element, а closest
  useEffect(() => {
    if (!frameDocument) return
    const onClick = (event: MouseEvent) => {
      const target = event.target as { closest?: (selector: string) => Element | null } | null
      const link = typeof target?.closest === 'function' ? target.closest('a') : null
      if (link && !link.getAttribute('href')?.startsWith('#')) event.preventDefault()
      const id = onSelectBlock ? blockIdAt(event.target, blockIds) : null
      if (id !== null) onSelectBlock?.(id)
    }
    frameDocument.addEventListener('click', onClick)
    return () => frameDocument.removeEventListener('click', onClick)
  }, [frameDocument, onSelectBlock, blockIds])

  return (
    <div className={styles.preview}>
      {toolbar && <div className={styles.toolbar}>{toolbar}</div>}
      {/* Живая область есть всегда, даже пустая: так экранный диктор прочитает смену версии */}
      <div className={styles.note} aria-live="polite">
        {note && <InlineAlert tone="info">{note}</InlineAlert>}
      </div>
      <div ref={stageRef} className={styles.stage}>
        <div className={styles.frameBox} style={{ width: width * scale }}>
          <iframe
            title={props.title ?? 'Предпросмотр страницы'}
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
            {extra}
          </PreviewBoundary>,
          frameDocument.body,
        )}
    </div>
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
