import { Link } from '@tanstack/react-router'
import { useEffect, useId, useRef, useState } from 'react'
import { cx } from '../ui/cx'
import { Icon } from '../ui/Icon'
import styles from './Shell.module.scss'

type Site = { id: string; name: string }

type SiteSwitcherProps = {
  current: Site
  sites: readonly Site[]
  /** Есть куда переключиться (switcherExpandable): иначе — просто название сайта */
  expandable: boolean
}

/**
 * Какой сайт открыт и переход к другому. Раскрывашка (disclosure), а не меню: внутри обычные
 * ссылки, Tab и Enter работают как у браузера. Esc закрывает и возвращает фокус на кнопку,
 * переход по ссылке закрывает список
 */
export function SiteSwitcher({ current, sites, expandable }: SiteSwitcherProps) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Esc закрывает только список: меню телефона (AppShell) закроется следующим нажатием
      event.stopImmediatePropagation()
      setOpen(false)
      button.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown, { capture: true })
    return () => document.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [open])

  if (!expandable) {
    return (
      <div className={cx(styles.site, styles.siteStatic)}>
        <span className={styles.siteCaption}>Сайт</span>
        <span className={styles.siteName}>{current.name}</span>
      </div>
    )
  }

  return (
    <div className={styles.switcher}>
      <button
        ref={button}
        type="button"
        className={cx(styles.site, styles.siteButton)}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.siteText}>
          <span className={styles.siteCaption}>Сайт</span>
          <span className={styles.siteName}>{current.name}</span>
        </span>
        <Icon name="chevron-down" className={styles.siteChevron} />
        <span className="visually-hidden">: выбрать другой сайт</span>
      </button>
      {open && (
        <ul id={listId} className={styles.siteList} aria-label="Сайты">
          {sites.map((site) => (
            <li key={site.id}>
              <Link
                to="/sites/$siteId"
                params={{ siteId: site.id }}
                className={styles.siteLink}
                aria-current={site.id === current.id ? 'true' : undefined}
                activeOptions={{ exact: true }}
                onClick={() => setOpen(false)}
              >
                <span className={styles.siteLinkName}>{site.name}</span>
                {site.id === current.id && <Icon name="check" />}
              </Link>
            </li>
          ))}
          <li>
            <Link to="/" className={styles.siteLink} onClick={() => setOpen(false)}>
              Все сайты
            </Link>
          </li>
        </ul>
      )}
    </div>
  )
}
