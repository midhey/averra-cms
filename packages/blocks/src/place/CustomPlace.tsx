import type { MediaMap } from '@averra/schema'
import { legalFooterLinks } from '../custom/place-legal'
import { CustomBlockRenderError } from '../custom/problems'
import { type CustomBlockMap, renderCustomPlaceHtml } from '../custom/render'
import { SiteFooter } from '../footer/SiteFooter'
import type { SiteFooterView } from '../footer/view'
import { SiteHeader } from '../header/SiteHeader'
import headerStyles from '../header/SiteHeader.module.css'
import { CONTENT_ID, type CustomPlaceView, type SiteHeaderView } from '../header/view'
import styles from './CustomPlace.module.css'

// Свои шапка и подвал: свой блок с местом «шапка» или «подвал» вместо стандартных. Корень —
// разметка Averra (data-site-header / data-site-footer и data-custom-block — по нему CSS и скрипт
// определения находят свою шапку), внутри — HTML шаблона в [data-custom-block-root], как у блока
// страницы. Не вывелся свой вид — стандартная шапка или подвал по тем же данным: меню, логотип и
// ссылки на документы на сайте остаются всегда

type Place = 'header' | 'footer'

/** id своего вида на странице: id из шаблона «{{ block.id }}-menu» — свои, не занятые блоками */
const PLACE_IDS: Record<Place, string> = { header: 'site-header', footer: 'site-footer' }

type Rendered = { html: string; problem?: undefined } | { html?: undefined; problem: string }

/** HTML своего вида или причина, почему его нет */
function renderPlace(
  custom: CustomPlaceView,
  place: Place,
  definitions: CustomBlockMap,
  media: MediaMap,
  pageIds: readonly string[] | undefined,
): Rendered {
  const definition = definitions[custom.key]
  const word = place === 'header' ? 'шапки' : 'подвала'
  if (!definition) {
    return {
      problem: `Своего вида ${word} «${custom.key}» нет на сайте: его не опубликовали или удалили`,
    }
  }
  if ((definition.placement ?? 'block') !== place) {
    return { problem: `«${definition.title}» — не вид ${word}` }
  }
  try {
    const html = renderCustomPlaceHtml(definition, custom.props, custom.data, {
      id: PLACE_IDS[place],
      media,
      priority: false,
      pageIds,
    })
    return { html }
  } catch (error) {
    if (!(error instanceof CustomBlockRenderError)) throw error
    return { problem: error.line ? `Строка ${error.line}: ${error.message}` : error.message }
  }
}

/**
 * Свой вид, решённый заранее — до вёрстки <html>: выводится ли он. Не выводится — вид без custom
 * (стандартная шапка или подвал), причина — в onError. Рендерер по нему ставит метки липкой шапки,
 * CSS и скрипт своего вида: у стандартной не остаётся чужого
 */
export function settlePlace<View extends { custom: CustomPlaceView | null }>(
  view: View,
  place: Place,
  definitions: CustomBlockMap,
  media: MediaMap,
  pageIds?: readonly string[],
  onError?: (message: string) => void,
): { view: View; html: string | undefined } {
  if (!view.custom) return { view, html: undefined }
  const rendered = renderPlace(view.custom, place, definitions, media, pageIds)
  if (rendered.html !== undefined) return { view, html: rendered.html }
  onError?.(rendered.problem)
  return { view: { ...view, custom: null }, html: undefined }
}

type SlotProps<View> = {
  view: View
  media: MediaMap
  /** Опубликованные свои блоки сайта (в предпросмотре — и черновик): определения своих видов */
  definitions: CustomBlockMap
  /** Свой вид не вывелся: на сайте — в журнал сборки, шапка стандартная */
  onCustomError?: ((message: string) => void) | undefined
  /** Предпросмотр в админке: причина видна над стандартной шапкой */
  preview?: boolean | undefined
  /** id блоков страницы: шаблон их не повторяет */
  pageIds?: readonly string[] | undefined
  /** HTML своего вида, уже собранный settlePlace: второй раз шаблон не рендерим */
  html?: string | undefined
}

/** Шапка сайта: своя, если её выбрали и она выводится, иначе стандартная */
export function HeaderSlot(props: SlotProps<SiteHeaderView>) {
  const { view, media } = props
  if (!view.custom) return <SiteHeader view={view} media={media} />
  const rendered: Rendered =
    props.html !== undefined
      ? { html: props.html }
      : renderPlace(view.custom, 'header', props.definitions, media, props.pageIds)
  if (rendered.html !== undefined) {
    return <CustomSiteHeader view={view} custom={view.custom} html={rendered.html} />
  }
  props.onCustomError?.(rendered.problem)
  return (
    <>
      {props.preview && (
        <p className={styles.problem} role="alert">
          {rendered.problem}. На сайте — стандартная шапка
        </p>
      )}
      <SiteHeader view={{ ...view, custom: null }} media={media} />
    </>
  )
}

/** Подвал сайта: свой, если его выбрали и он выводится, иначе стандартный */
export function FooterSlot(props: SlotProps<SiteFooterView>) {
  const { view, media } = props
  if (!view.custom) return <SiteFooter view={view} media={media} preview={props.preview} />
  const rendered: Rendered =
    props.html !== undefined
      ? { html: props.html }
      : renderPlace(view.custom, 'footer', props.definitions, media, props.pageIds)
  if (rendered.html !== undefined) {
    return (
      <CustomSiteFooter
        custom={view.custom}
        html={rendered.html}
        preview={props.preview === true}
      />
    )
  }
  props.onCustomError?.(rendered.problem)
  return (
    <>
      {props.preview && (
        <p className={styles.problem} role="alert">
          {rendered.problem}. На сайте — стандартный подвал
        </p>
      )}
      <SiteFooter view={{ ...view, custom: null }} media={media} preview={props.preview} />
    </>
  )
}

/**
 * Своя шапка: «К содержимому» и метки прокрутки — Averra, как у стандартной. Корень липнет и
 * собирается по «Поведению» шапки: data-sticky, data-condense, а скрипт шапки ставит data-condensed
 * при прокрутке (CSS шаблона — :scope[data-condensed]) и закрывает <details> шаблона по Esc
 */
export function CustomSiteHeader({
  view,
  custom,
  html,
}: {
  view: SiteHeaderView
  custom: CustomPlaceView
  html: string
}) {
  return (
    <>
      <a className={headerStyles.skip} href={`#${CONTENT_ID}`}>
        К содержимому
      </a>
      {view.condense && (
        <>
          <div className={headerStyles.sentinel} data-header-sentinel="far" aria-hidden="true" />
          <div className={headerStyles.sentinelTop} data-header-sentinel="top" aria-hidden="true" />
        </>
      )}
      <header
        className={styles.header}
        data-site-header=""
        data-custom-block={custom.key}
        data-custom-place="header"
        data-sticky={view.sticky ? '' : undefined}
        data-condense={view.condense ? '' : undefined}
        data-short={view.short ? '' : undefined}
      >
        {/* HTML собран из дерева разбора после Liquid: опасное из него уже убрано (sanitizeHtml) */}
        <div data-custom-block-root="" dangerouslySetInnerHTML={{ __html: html }} />
      </header>
    </>
  )
}

/**
 * Свой подвал и строка документов Averra после шаблона: политика, согласие (если его включили) и
 * «Настройки cookie». Ссылку, которую шаблон уже вывел видимой (legalFooterLinks), Averra второй
 * раз не пишет — вёрстка без дублей; забытая, спрятанная разметкой или текст «href=…» дубль не
 * отменяют. «Настройки cookie» — всегда Averra: атрибут data-consent-open шаблону недоступен
 */
export function CustomSiteFooter({
  custom,
  html,
  preview,
}: {
  custom: CustomPlaceView
  html: string
  preview: boolean
}) {
  const { policy, consent, cookieSettings } = legalFooterLinks(html, custom.legal)
  const links = policy !== null || consent !== null
  return (
    <footer data-site-footer="" data-custom-block={custom.key} data-custom-place="footer">
      <div data-custom-block-root="" dangerouslySetInnerHTML={{ __html: html }} />
      {(links || cookieSettings) && (
        // Только кнопка cookie — без JS строка скрыта целиком: кнопку показывает скрипт уведомления
        <div className={styles.legal} data-legal-footer="" hidden={!links && !preview}>
          {policy && (
            <a className={styles.link} href={policy}>
              Политика конфиденциальности
            </a>
          )}
          {consent && (
            <a className={styles.link} href={consent}>
              Согласие на обработку персональных данных
            </a>
          )}
          {cookieSettings && (
            <button
              type="button"
              className={styles.button}
              data-consent-open=""
              aria-haspopup="dialog"
              hidden={!preview}
            >
              Настройки cookie
            </button>
          )}
        </div>
      )}
    </footer>
  )
}
