import type { MediaMap } from '@averra/schema'
import type { CustomBlockMap } from '../custom/render'
import { Page } from '../Page'
import styles from './SiteWindows.module.css'
import type { SiteWindowView } from './view'

type SiteWindowsProps = {
  windows: readonly SiteWindowView[]
  media?: MediaMap
  customBlocks?: CustomBlockMap
  /** Номер счётчика Метрики: цель «заявка» из окна. Пусто — без цели */
  metrika?: string
  onCustomBlockError?: (blockId: string, message: string) => void
}

/**
 * Окна сайта: страницы-окна, на которые ведут ссылки этой страницы, — закрытыми <dialog> после
 * подвала. Открывает их скрипт поведений (behaviors-dom.ts) по ссылке с data-av-window. Без JS
 * закрытое окно не видно (и в браузерах без <dialog> — правило :not([open])), а ссылка ведёт на
 * страницу-окно обычным переходом
 */
export function SiteWindows({
  windows,
  media = {},
  customBlocks = {},
  metrika = '',
  onCustomBlockError,
}: SiteWindowsProps) {
  return windows.map((window) => {
    // «~» в id блока не бывает (BlockId), и заголовок не совпадёт с блоком окна (w-<адрес>-<id>)
    const titleId = `w-${window.slug}~title`
    const title = window.settings.title.trim()
    return (
      <dialog
        key={window.slug}
        className={styles.window}
        data-site-window={window.slug}
        data-width={window.settings.width}
        data-surface={window.settings.surface}
        data-site-window-backdrop={window.settings.closeOnBackdrop ? '' : undefined}
        data-site-window-metrika={metrika || undefined}
        {...(title ? { 'aria-labelledby': titleId } : { 'aria-label': window.label })}
      >
        <div className={styles.frame}>
          <div className={styles.bar}>
            {title && (
              // tabIndex -1: на телефоне фокус при открытии — на заголовок (behaviors-dom.ts)
              <h2 id={titleId} className={styles.title} tabIndex={-1} data-site-window-title="">
                {title}
              </h2>
            )}
            <button
              type="button"
              className={styles.close}
              data-site-window-close=""
              aria-label="Закрыть окно"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <div className={styles.content} data-site-window-content="">
            <Page
              content={window.content}
              media={media}
              formAction={window.formAction}
              customBlocks={customBlocks}
              onCustomBlockError={onCustomBlockError}
              nested
            />
          </div>
        </div>
      </dialog>
    )
  })
}
