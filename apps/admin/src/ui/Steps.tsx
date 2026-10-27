import type { ReactNode } from 'react'
import { cx } from './cx'
import { Icon } from './Icon'
import styles from './Steps.module.scss'

/** Шаг: пройден, идёт сейчас, впереди, не прошёл или уже не начнётся (операция кончилась раньше) */
export type StepState = 'done' | 'current' | 'pending' | 'failed' | 'skipped'

export type StepItem = { id: string; label: string; state: StepState; hint?: ReactNode }

/** Состояние шага словами: его читает диктор, а видно оно значком, а не только цветом */
const stateWords: Record<StepState, string> = {
  done: 'пройдено',
  current: 'идёт',
  pending: 'впереди',
  failed: 'не прошло',
  skipped: 'не начиналось',
}

/**
 * Ход долгой операции по шагам (обновление установки). Нумерованный список: пройденный шаг —
 * галочка, текущий — кольцо и слово «идёт», не прошедший — значок предупреждения и слова «не
 * прошло», впереди — номер, не начавшийся — номер в пунктирном круге и слова «не начиналось».
 * Текущий отмечен aria-current="step"
 */
export function Steps({ items, label }: { items: readonly StepItem[]; label: string }) {
  return (
    <ol className={styles.steps} aria-label={label}>
      {items.map((item, index) => (
        <li
          key={item.id}
          className={cx(styles.step, styles[item.state])}
          aria-current={item.state === 'current' ? 'step' : undefined}
        >
          <span className={styles.marker} aria-hidden="true">
            {item.state === 'done' ? (
              <Icon name="check" />
            ) : item.state === 'failed' ? (
              <Icon name="warning" />
            ) : item.state === 'current' ? (
              <span className={styles.ring} />
            ) : (
              index + 1
            )}
          </span>
          <span className={styles.text}>
            <span className={styles.label}>{item.label}</span>
            {item.state === 'current' || item.state === 'failed' || item.state === 'skipped' ? (
              <span className={styles.state}>{stateWords[item.state]}</span>
            ) : (
              <span className="visually-hidden">, {stateWords[item.state]}</span>
            )}
            {item.hint && <span className={styles.hint}>{item.hint}</span>}
          </span>
        </li>
      ))}
    </ol>
  )
}
