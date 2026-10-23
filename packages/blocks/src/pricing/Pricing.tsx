import type { BlockComponentProps } from '../types'
import { ButtonLink } from '../ui/ButtonLink'
import { Section } from '../ui/Section'
import styles from './Pricing.module.css'

/**
 * Услуги и цены: тарифы карточками на полосе поверхности. Карточки — цвета фона, поэтому всё
 * внутри них читается парами «на фоне», которые тема проверяет строго. Выделенный тариф — рамка
 * акцентом и подпись над названием: не только цветом
 */
export function Pricing({ id, data, headingLevel }: BlockComponentProps<'pricing'>) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  const PlanHeading = headingLevel === 1 ? 'h2' : 'h3'
  return (
    <Section id={id} tone="muted">
      {(data.title || data.text) && (
        <div className={styles.header}>
          {data.title && <Heading className={styles.title}>{data.title}</Heading>}
          {data.text && <p className={styles.text}>{data.text}</p>}
        </div>
      )}
      {/* biome-ignore lint/a11y/noRedundantRoles: Safari без маркеров списка теряет роль list */}
      <ul role="list" className={styles.plans} data-count={data.plans.length}>
        {data.plans.map((plan, index) => (
          // У тарифов нет id. Ключ по индексу здесь безопасен: список рендерится статично
          <li key={index} className={styles.plan} data-featured={plan.featured}>
            {plan.featured && <p className={styles.badge}>{data.featuredLabel}</p>}
            <PlanHeading className={styles.name}>{plan.name}</PlanHeading>
            <p className={styles.price}>{plan.price}</p>
            {plan.features.length > 0 && (
              <ul className={styles.features}>
                {plan.features.map((feature, featureIndex) => (
                  <li key={featureIndex}>{feature}</li>
                ))}
              </ul>
            )}
            {plan.button && (
              <div className={styles.action}>
                <ButtonLink
                  {...plan.button}
                  appearance={plan.featured ? 'filled' : 'outline'}
                  wide
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </Section>
  )
}
