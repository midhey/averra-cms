import type { ReactNode } from 'react'
import { ShellBrand } from '../ui/AppShell'
import styles from './AuthLayout.module.scss'

type AuthLayoutProps = {
  title: string
  /** id заголовка: форма на экране подписывается им (aria-labelledby) */
  headingId?: string
  /** Под заголовком: что здесь делают */
  intro?: ReactNode
  children: ReactNode
  /** Под карточкой: «Забыли пароль?», «Ко входу» */
  footer?: ReactNode
}

/**
 * Экраны без входа (вход, «Забыли пароль?», новый пароль, приглашение): знак и карточка
 * с формой по центру. Свой <main> — у каждого экрана свой
 * (документация: Разработчику → Соглашения, «Админка»)
 */
export function AuthLayout({ title, headingId, intro, children, footer }: AuthLayoutProps) {
  return (
    <main className={styles.page}>
      <div className={styles.column}>
        <ShellBrand />
        <div className={styles.card}>
          <div className={styles.head}>
            <h1 id={headingId} className={styles.title}>
              {title}
            </h1>
            {intro && <div className={styles.intro}>{intro}</div>}
          </div>
          {children}
        </div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </main>
  )
}
