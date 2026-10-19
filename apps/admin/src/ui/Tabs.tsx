import { type KeyboardEvent, type ReactNode, useId, useRef } from 'react'
import styles from './Tabs.module.scss'

export type TabItem<T extends string> = {
  id: T
  label: string
  /** Число в подписи вкладки: «Новые · 3» */
  count?: number | undefined
}

type TabsProps<T extends string> = {
  /** Что переключают вкладки — подпись для диктора («Фильтр заявок») */
  label: string
  items: ReadonlyArray<TabItem<T>>
  value: T
  onChange: (value: T) => void
  /** Содержимое выбранной вкладки */
  children: ReactNode
  /**
   * Панель сама в порядке Tab (по умолчанию да). По WAI-ARIA это нужно, только когда в панели
   * нет фокусируемого: экран с кнопками, полями или ссылками в панели передаёт false, чтобы
   * не было лишней пустой остановки между вкладкой и первым элементом
   */
  panelFocusable?: boolean
}

/**
 * Вкладки по шаблону WAI-ARIA: в порядке Tab только выбранная вкладка, стрелки и Home/End
 * переходят и сразу выбирают (содержимое уже загружено, ждать нечего). Панель подписана вкладкой
 */
export function Tabs<T extends string>({
  label,
  items,
  value,
  onChange,
  children,
  panelFocusable = true,
}: TabsProps<T>) {
  const base = useId()
  const refs = useRef(new Map<T, HTMLButtonElement>())
  const tabId = (id: T) => `${base}-tab-${id}`
  const panelId = `${base}-panel`

  const onKeyDown = (event: KeyboardEvent) => {
    const index = items.findIndex((item) => item.id === value)
    const last = items.length - 1
    const next = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    }[event.key]
    const item = next === undefined ? undefined : items[next]
    if (!item) return
    event.preventDefault()
    onChange(item.id)
    refs.current.get(item.id)?.focus()
  }

  return (
    <div className={styles.tabs}>
      <div role="tablist" aria-label={label} className={styles.list} onKeyDown={onKeyDown}>
        {items.map((item) => {
          const selected = item.id === value
          return (
            <button
              key={item.id}
              ref={(node) => {
                if (node) refs.current.set(item.id, node)
                else refs.current.delete(item.id)
              }}
              type="button"
              role="tab"
              id={tabId(item.id)}
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              className={styles.tab}
              onClick={() => onChange(item.id)}
            >
              {item.label}
              {item.count !== undefined && <span className={styles.count}> · {item.count}</span>}
            </button>
          )
        })}
      </div>
      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(value)}
        // Панель вкладок по WAI-ARIA доступна с Tab, если в ней нет фокусируемого
        tabIndex={panelFocusable ? 0 : undefined}
        className={styles.panel}
      >
        {children}
      </div>
    </div>
  )
}
