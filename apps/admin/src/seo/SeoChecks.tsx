import type { SeoCheck, SeoCheckLevel } from '@averra/schema'
import { useId } from 'react'
import { cx } from '../ui/cx'
import { Icon, type IconName } from '../ui/Icon'
import { seoLevelLabels, sortedChecks } from './page-seo-format'
import styles from './SeoChecks.module.scss'

const levelIcons: Record<SeoCheckLevel, IconName> = {
  problem: 'warning',
  warning: 'info',
  good: 'check',
}

/**
 * Проверки SEO страницы списком: сначала важное, потом что поправить, потом что хорошо. Уровень —
 * иконкой разной формы, у советов ещё и словом («Важно», «Стоит поправить»); у хорошего слово
 * только для диктора — галочки хватает глазу. Цвет только помогает. Публиковать проверки не мешают
 */
export function SeoChecks({ checks }: { checks: readonly SeoCheck[] }) {
  const headingId = useId()
  const counts = { problem: 0, warning: 0, good: 0 }
  for (const check of checks) counts[check.level] += 1
  const summary = (['problem', 'warning', 'good'] as const)
    .filter((level) => counts[level] > 0)
    .map((level) => `${seoLevelLabels[level]}: ${counts[level]}`)
    .join(' · ')

  return (
    <section className={styles.checks} aria-labelledby={headingId}>
      <div className={styles.head}>
        <h3 id={headingId} className={styles.heading}>
          Проверки
        </h3>
        <span className={styles.summary}>{summary}</span>
      </div>
      <ul className={styles.list}>
        {sortedChecks(checks).map((check) => (
          <li key={check.id} className={cx(styles.item, styles[check.level])}>
            <Icon name={levelIcons[check.level]} size={16} className={styles.icon} />
            <div className={styles.body}>
              <span className={styles.title}>
                <span className={check.level === 'good' ? 'visually-hidden' : styles.level}>
                  {seoLevelLabels[check.level]}:{' '}
                </span>
                {check.title}
              </span>
              {check.advice && <span className={styles.advice}>{check.advice}</span>}
            </div>
          </li>
        ))}
      </ul>
      <p className={styles.note}>Советы не мешают сохранить и опубликовать страницу.</p>
    </section>
  )
}
