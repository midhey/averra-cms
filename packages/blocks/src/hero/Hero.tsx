import type { BlockComponentProps } from '../types'
import { ButtonLink } from '../ui/ButtonLink'
import { Section } from '../ui/Section'
import styles from './Hero.module.css'

export function Hero({ id, data, headingLevel }: BlockComponentProps<'hero'>) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  return (
    <Section id={id}>
      <div className={styles.hero} data-variant={data.variant}>
        <Heading className={styles.title}>{data.title}</Heading>
        {data.subtitle && <p className={styles.subtitle}>{data.subtitle}</p>}
        {data.button && <ButtonLink {...data.button} />}
      </div>
    </Section>
  )
}
