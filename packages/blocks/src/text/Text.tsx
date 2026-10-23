import type { BlockComponentProps } from '../types'
import { Section } from '../ui/Section'
import { TextBody } from '../ui/TextBody'
import styles from './Text.module.css'

/** Текст: заголовок и абзацы, списки и подзаголовки из лёгкой разметки (TextBody) */
export function Text({ id, data, headingLevel }: BlockComponentProps<'text'>) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  return (
    <Section id={id} density="compact">
      <div className={styles.text}>
        {data.title && <Heading className={styles.title}>{data.title}</Heading>}
        <TextBody body={data.body} headingLevel={headingLevel} />
      </div>
    </Section>
  )
}
