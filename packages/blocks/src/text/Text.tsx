import { parseTextBody } from '@averra/schema'
import type { BlockComponentProps } from '../types'
import { Section } from '../ui/Section'
import styles from './Text.module.css'

/** Текст: заголовок и абзацы, списки и подзаголовки из лёгкой разметки (parseTextBody) */
export function Text({ id, data, headingLevel }: BlockComponentProps<'text'>) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  const SubHeading = headingLevel === 1 ? 'h2' : 'h3'
  return (
    <Section id={id} density="compact">
      <div className={styles.text}>
        {data.title && <Heading className={styles.title}>{data.title}</Heading>}
        {parseTextBody(data.body).map((part, index) => {
          // Части текста не переставляются и рендерятся статично: ключ по месту
          switch (part.kind) {
            case 'heading':
              return (
                <SubHeading key={index} className={styles.subtitle}>
                  {part.text}
                </SubHeading>
              )
            case 'list':
              return (
                <ul key={index} className={styles.list}>
                  {part.items.map((item, itemIndex) => (
                    <li key={itemIndex}>{item}</li>
                  ))}
                </ul>
              )
            default:
              return <p key={index}>{part.text}</p>
          }
        })}
      </div>
    </Section>
  )
}
