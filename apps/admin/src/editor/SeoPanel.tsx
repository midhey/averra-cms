import {
  canonicalPath,
  NOT_FOUND_PAGE_SLUG,
  type PageSeo,
  pageDocumentTitle,
  SEO_DESCRIPTION_MAX,
  SEO_TITLE_MAX,
  type SeoCheck,
  type SiteSeo,
} from '@averra/schema'
import { useId, useState } from 'react'
import { MediaPickField } from '../media/MediaPickField'
import { type MediaItem, thumbnailUrl } from '../media/media-format'
import { pagePath } from '../pages-format'
import type { SearchEngine, SeoField } from '../seo/page-seo-format'
import { SearchSnippet } from '../seo/SearchSnippet'
import { SeoChecks } from '../seo/SeoChecks'
import { SocialCard } from '../seo/SocialCard'
import { snippetAddress } from '../seo/seo-format'
import { Checkbox, TextArea, TextInput } from '../ui/Field'
import { InlineAlert } from '../ui/InlineAlert'
import { SegmentedControl } from '../ui/SegmentedControl'
import { useDebouncedValue } from '../ui/use-debounced-value'
import styles from './Inspector.module.scss'
import panel from './SeoPanel.module.scss'

type SeoPanelProps = {
  id: string
  siteId: string
  siteName: string
  /** SEO сайта: шаблон заголовка, описание и картинка по умолчанию, адрес */
  siteSeo: SiteSeo
  slug: string
  /** Заголовок страницы из полосы редактора — как он есть сейчас */
  pageTitle: string
  seo: PageSeo
  /** Ошибки полей по схеме страницы: с ними черновик не сохранить */
  errors: Partial<Record<SeoField, string>>
  checks: readonly SeoCheck[]
  /** Медиатека сайта: превью картинки страницы и сайта */
  library: readonly MediaItem[] | undefined
  onChange: (seo: PageSeo) => void
}

const engines = [
  { value: 'yandex', label: 'Яндекс' },
  { value: 'google', label: 'Google' },
] as const

const hostOf = (url: string | null) => (url && URL.canParse(url) ? new URL(url).host : '')

/**
 * SEO страницы: проверки, заголовок и описание для поиска с примером строки в Яндексе и Google,
 * картинка для соцсетей с превью ссылки, canonical и noindex. Часть черновика: на сайт попадает с
 * публикацией, как блоки. Шаблон заголовка, картинка и описание по умолчанию — у сайта, в разделе
 * «SEO»: здесь они видны подсказками
 */
export function SeoPanel({
  id,
  siteId,
  siteName,
  siteSeo,
  slug,
  pageTitle,
  seo,
  errors,
  checks,
  library,
  onChange,
}: SeoPanelProps) {
  const ids = useId()
  const [engine, setEngine] = useState<SearchEngine>('yandex')
  const notFound = slug === NOT_FOUND_PAGE_SLUG
  const set = <K extends keyof PageSeo>(key: K, value: PageSeo[K]) =>
    onChange({ ...seo, [key]: value })

  const templated = pageDocumentTitle({ slug, title: pageTitle.trim() }, siteSeo.titleTemplate)
  const documentTitle = pageDocumentTitle(
    { slug, title: pageTitle.trim(), seo },
    siteSeo.titleTemplate,
  )
  const description = seo.description?.trim() || siteSeo.description
  const domain = hostOf(siteSeo.url)
  const ownUrl = `${siteSeo.url ?? ''}${canonicalPath(slug)}`

  // Картинка для соцсетей: своя, иначе сайта, иначе карточка из заголовка (её рисует API). Адрес
  // карточки — с заголовком, который перестали набирать: не просить картинку на каждую букву.
  // Странице 404 карточку не рисуют (на сайте её нет): у неё своя картинка, сайта или никакой
  const card = !seo.image && !siteSeo.ogImage && siteSeo.url !== null && !notFound
  const cardTitle = useDebouncedValue(pageTitle.trim(), 600)
  const pageImage = seo.image && library?.find((item) => item.id === seo.image?.mediaId)
  const siteImage = siteSeo.ogImage
    ? library?.find((item) => item.id === siteSeo.ogImage)
    : undefined
  const chosen = pageImage ?? (seo.image ? undefined : siteImage)
  const chosenUrl = chosen && thumbnailUrl(chosen.variants)
  const image = chosenUrl
    ? { src: chosenUrl, alt: `Картинка для соцсетей: ${chosen.originalName}` }
    : card && cardTitle
      ? {
          src: `/api/sites/${siteId}/og-card?title=${encodeURIComponent(cardTitle)}`,
          alt: `Карточка из заголовка «${cardTitle}» в цветах сайта`,
        }
      : undefined
  const imageNote = seo.image
    ? 'своя картинка'
    : siteSeo.ogImage
      ? 'картинка сайта'
      : card
        ? 'карточка из заголовка'
        : notFound
          ? 'у страницы 404 карточки из заголовка нет'
          : 'без адреса сайта картинки нет'

  return (
    <aside id={id} className={styles.panel} aria-label="SEO страницы">
      <div className={styles.header}>
        <span className={styles.kicker}>Страница</span>
        <h2 className={styles.heading}>SEO</h2>
        <p className={styles.anchor}>
          Адрес: <code>{pagePath(slug)}</code>
        </p>
      </div>
      {notFound && (
        <InlineAlert tone="info" title="Служебная страница 404">
          Её показывают на адресах, где страницы нет. Поисковикам она не видна.
        </InlineAlert>
      )}

      <SeoChecks checks={checks} />

      <section className={panel.group} aria-labelledby={`${ids}-search`}>
        <h3 id={`${ids}-search`} className={panel.heading}>
          Поиск
        </h3>
        <TextInput
          label="SEO-заголовок"
          name="seo.title"
          value={seo.title ?? ''}
          maxChars={SEO_TITLE_MAX}
          placeholder={templated}
          error={errors.title}
          onChange={(event) => set('title', event.target.value)}
          hint={`Заголовок во вкладке и в поиске, пишется целиком — шаблон сайта не добавляется. Пусто — «${templated}»`}
        />
        <TextArea
          label="Описание"
          name="seo.description"
          rows={4}
          value={seo.description ?? ''}
          maxChars={SEO_DESCRIPTION_MAX}
          error={errors.description}
          onChange={(event) => set('description', event.target.value)}
          hint={
            siteSeo.description
              ? '1–2 предложения о том, что на странице, 70–160 символов. Пусто — описание сайта из раздела «SEO»'
              : '1–2 предложения о том, что на странице, 70–160 символов: их покажут поиск и соцсети'
          }
        />
        <SegmentedControl
          legend="Поисковик"
          hideLegend
          options={engines}
          value={engine}
          onChange={setEngine}
        />
        <SearchSnippet
          engine={engine}
          siteName={siteName}
          address={snippetAddress('', siteSeo.url, pagePath(slug))}
          title={documentTitle}
          description={notFound ? '' : description}
        />
      </section>

      <section className={panel.group} aria-labelledby={`${ids}-social`}>
        <h3 id={`${ids}-social`} className={panel.heading}>
          Соцсети
        </h3>
        <MediaPickField
          siteId={siteId}
          label="Картинка для соцсетей"
          name="seo.image"
          value={seo.image?.mediaId ?? null}
          onChange={(mediaId) => set('image', mediaId ? { mediaId } : undefined)}
          error={errors.image}
          hint={
            siteSeo.ogImage
              ? 'JPEG или PNG, лучше 1200 × 630. Пусто — общая картинка сайта'
              : notFound
                ? 'JPEG или PNG, лучше 1200 × 630. Пусто — без картинки'
                : 'JPEG или PNG, лучше 1200 × 630. Пусто — карточка из заголовка страницы в цветах сайта'
          }
        />
        <SocialCard
          domain={domain}
          title={seo.title?.trim() || pageTitle.trim()}
          description={notFound ? '' : description}
          image={image}
          imageNote={imageNote}
        />
      </section>

      {!notFound && (
        <section className={panel.group} aria-labelledby={`${ids}-indexing`}>
          <h3 id={`${ids}-indexing`} className={panel.heading}>
            Индексация
          </h3>
          <TextInput
            label="Канонический адрес (canonical)"
            name="seo.canonical"
            mono
            inputMode="url"
            value={seo.canonical ?? ''}
            placeholder={ownUrl}
            error={errors.canonical}
            onChange={(event) => set('canonical', event.target.value)}
            hint="Пусто — адрес этой страницы. Другой адрес — если страница копирует другую (та же акция по двум адресам): поисковик покажет тот, а эту уберёт из карты сайта"
          />
          <Checkbox
            checked={seo.noindex === true}
            onChange={(event) => set('noindex', event.target.checked)}
            label="Скрыть страницу от поисковиков"
            hint="noindex, и страницы не будет в карте сайта. Для служебных страниц: «Спасибо», политика, черновые акции"
          />
        </section>
      )}
    </aside>
  )
}
