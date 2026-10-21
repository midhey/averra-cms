import { NOT_FOUND_PAGE_SLUG, type PageSeo, SEO_DESCRIPTION_MAX } from '@averra/schema'
import { pagePath } from '../pages-format'
import { Checkbox, TextArea } from '../ui/Field'
import { InlineAlert } from '../ui/InlineAlert'
import styles from './Inspector.module.scss'

type PagePanelProps = {
  id: string
  slug: string
  seo: PageSeo
  /** Ошибка описания по схеме страницы (длиннее предела) */
  descriptionError: string | undefined
  onChange: (seo: PageSeo) => void
}

/**
 * Настройки страницы для поиска и соцсетей: описание и «скрыть от поисковиков». Часть черновика:
 * на сайт попадают с публикацией, как блоки. Остальное (шаблон заголовка, картинка для соцсетей,
 * счётчики) — у сайта целиком, в разделе «SEO»
 */
export function PagePanel({ id, slug, seo, descriptionError, onChange }: PagePanelProps) {
  const notFound = slug === NOT_FOUND_PAGE_SLUG
  return (
    <aside id={id} className={styles.panel} aria-label="Страница: поиск и соцсети">
      <div className={styles.header}>
        <span className={styles.kicker}>Страница</span>
        <h2 className={styles.heading}>Поиск и соцсети</h2>
        <p className={styles.anchor}>
          Адрес: <code>{pagePath(slug)}</code>
        </p>
      </div>
      {notFound && (
        <InlineAlert tone="info" title="Служебная страница 404">
          Её показывают на адресах, где страницы нет. Поисковикам она не видна.
        </InlineAlert>
      )}
      <TextArea
        label="Описание"
        rows={4}
        value={seo.description ?? ''}
        maxChars={SEO_DESCRIPTION_MAX}
        error={descriptionError}
        onChange={(event) => onChange({ ...seo, description: event.target.value })}
        hint="1–2 предложения о том, что на странице: их покажут поиск и соцсети. Пусто — описание сайта из раздела «SEO»"
      />
      {!notFound && (
        <Checkbox
          checked={seo.noindex === true}
          onChange={(event) => onChange({ ...seo, noindex: event.target.checked })}
          label="Скрыть страницу от поисковиков"
          hint="noindex, и страницы не будет в карте сайта. Для служебных страниц: «Спасибо», политика, черновые акции"
        />
      )}
    </aside>
  )
}

/**
 * Настройки страницы в том виде, в каком их хранить: пустое описание и снятый флажок — как будто
 * их нет. Так нетронутая страница сохраняется без поля seo и не числится изменённой
 */
export function normalizedSeo(seo: PageSeo): PageSeo | undefined {
  const description = seo.description?.trim() ?? ''
  const result: PageSeo = {
    ...(description !== '' ? { description: seo.description } : {}),
    ...(seo.noindex === true ? { noindex: true } : {}),
  }
  return Object.keys(result).length > 0 ? result : undefined
}
