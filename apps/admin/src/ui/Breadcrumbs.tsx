import { Link } from '@tanstack/react-router'
import styles from './ui.module.css'

type BreadcrumbsProps = {
  /** Открыт сайт или что-то внутри него */
  site?: { id: string; name: string }
  /** Открыта страница сайта: её адрес */
  page?: string
}

/** «Сайты / сайт / страница». Последний пункт — где человек сейчас, остальные — ссылки назад */
export function Breadcrumbs({ site, page }: BreadcrumbsProps) {
  return (
    <nav aria-label="Навигация по разделам" className={styles.breadcrumbs}>
      <ol>
        <li>{site ? <Link to="/">Сайты</Link> : <span aria-current="page">Сайты</span>}</li>
        {site && (
          <li>
            {page === undefined ? (
              <span aria-current="page">{site.name}</span>
            ) : (
              <Link to="/sites/$siteId" params={{ siteId: site.id }}>
                {site.name}
              </Link>
            )}
          </li>
        )}
        {page !== undefined && (
          <li>
            <span aria-current="page">{page}</span>
          </li>
        )}
      </ol>
    </nav>
  )
}
