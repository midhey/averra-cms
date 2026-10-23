import type { BlockComponentProps } from '../types'
import { Section } from '../ui/Section'
import styles from './Steps.module.css'

/**
 * Как мы работаем: нумерованный список. role="list" — Safari без маркеров списка
 * (list-style: none) иначе не говорит диктору, что это список. Номер «01» — рисунок: номер шага
 * диктор и так услышит от списка
 */
export function Steps({ id, data, headingLevel }: BlockComponentProps<'steps'>) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  const StepHeading = headingLevel === 1 ? 'h2' : 'h3'
  return (
    <Section id={id}>
      {data.title && <Heading className={styles.title}>{data.title}</Heading>}
      {/* biome-ignore lint/a11y/noRedundantRoles: Safari без маркеров списка теряет роль list */}
      <ol role="list" className={styles.list} data-count={data.items.length}>
        {data.items.map((item, index) => (
          // У шагов нет id. Ключ по индексу здесь безопасен: список рендерится статично
          <li key={index} className={styles.step}>
            <span className={styles.number} aria-hidden="true">
              {String(index + 1).padStart(2, '0')}
            </span>
            <StepHeading className={styles.stepTitle}>{item.title}</StepHeading>
            {item.text && <p className={styles.text}>{item.text}</p>}
          </li>
        ))}
      </ol>
    </Section>
  )
}
