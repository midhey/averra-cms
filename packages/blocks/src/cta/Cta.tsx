import type { BlockComponentProps } from '../types'
import { ButtonLink } from '../ui/ButtonLink'
import { Section } from '../ui/Section'
import styles from './Cta.module.css'

export function Cta({ id, data, headingLevel }: BlockComponentProps<'cta'>) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  return (
    <Section id={id}>
      <div className={styles.box}>
        <Heading className={styles.title}>{data.title}</Heading>
        {data.text && <p className={styles.text}>{data.text}</p>}
        <ButtonLink {...data.button} />
      </div>
    </Section>
  )
}
