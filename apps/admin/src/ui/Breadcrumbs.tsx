import { Link } from '@tanstack/react-router'
import styles from './ui.module.css'

type BreadcrumbsProps = {
  /** Открыт сайт или что-то внутри него */
  site?: { id: string; name: string }
  /**
   * Открыто что-то внутри сайта (адрес страницы, «Медиатека») или раздел админки без сайта
   * («Почта») — тогда он идёт сразу после «Сайты»
   */
  current?: string
}

/** «Сайты / сайт / страница или раздел». Последний пункт — где человек сейчас, остальные — ссылки назад */
export function Breadcrumbs({ site, current }: BreadcrumbsProps) {
  const atRoot = site === undefined && current === undefined
  return (
    <nav aria-label="Навигация по разделам" className={styles.breadcrumbs}>
      <ol>
        <li>{atRoot ? <span aria-current="page">Сайты</span> : <Link to="/">Сайты</Link>}</li>
        {site && (
          <li>
            {current === undefined ? (
              <span aria-current="page">{site.name}</span>
            ) : (
              <Link to="/sites/$siteId" params={{ siteId: site.id }}>
                {site.name}
              </Link>
            )}
          </li>
        )}
        {current !== undefined && (
          <li>
            <span aria-current="page">{current}</span>
          </li>
        )}
      </ol>
    </nav>
  )
}
