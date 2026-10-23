import { splitParagraphs } from '@averra/schema'
import type { BlockComponentProps } from '../types'
import { Section } from '../ui/Section'
import styles from './Faq.module.css'

/**
 * Вопросы и ответы на <details> и <summary>: раскрываются без JavaScript, с клавиатуры (Enter,
 * пробел) и для диктора. Заголовка внутри summary нет: у роли «кнопка» он бы потерялся
 */
export function Faq({ id, data, headingLevel }: BlockComponentProps<'faq'>) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  return (
    <Section id={id} tone="muted">
      <div className={styles.faq}>
        {data.title && <Heading className={styles.title}>{data.title}</Heading>}
        <div>
          {data.items.map((item, index) => (
            // У вопросов нет id. Ключ по индексу здесь безопасен: список рендерится статично
            <details key={index} className={styles.item} open={data.openFirst && index === 0}>
              <summary className={styles.question}>
                {item.question}
                <span className={styles.marker} aria-hidden="true" />
              </summary>
              <div className={styles.answer}>
                {splitParagraphs(item.answer).map((paragraph, paragraphIndex) => (
                  <p key={paragraphIndex}>{paragraph}</p>
                ))}
              </div>
            </details>
          ))}
        </div>
      </div>
    </Section>
  )
}
