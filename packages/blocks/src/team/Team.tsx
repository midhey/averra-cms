import type { BlockComponentProps } from '../types'
import { gridSizes } from '../ui/grid-sizes'
import { Picture } from '../ui/Picture'
import { Section } from '../ui/Section'
import styles from './Team.module.css'

/**
 * Ширина фото — как сетка в Team.module.css: на телефоне по двое, с 40rem — три колонки (две, если
 * выбрано две), с 64rem — сколько выбрано. Круглое фото не шире 10rem при любой колонке
 */
function sizesFor(columns: number, shape: 'portrait' | 'round') {
  if (shape === 'round') return '10rem'
  return gridSizes(2, [
    [40, Math.min(columns, 3)],
    [64, columns],
  ])
}

/** Команда: фото, имя (заголовок пункта) и должность. Без фото — плашка поверхности */
export function Team({ id, data, headingLevel, media }: BlockComponentProps<'team'>) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  const NameHeading = headingLevel === 1 ? 'h2' : 'h3'
  const sizes = sizesFor(data.columns, data.photoShape)
  return (
    <Section id={id}>
      {(data.title || data.text) && (
        <div className={styles.header}>
          {data.title && <Heading className={styles.title}>{data.title}</Heading>}
          {data.text && <p className={styles.text}>{data.text}</p>}
        </div>
      )}
      <ul
        // biome-ignore lint/a11y/noRedundantRoles: Safari без маркеров списка теряет роль list
        role="list"
        className={styles.grid}
        data-columns={data.columns}
        data-shape={data.photoShape}
      >
        {data.members.map((member, index) => (
          // У людей нет id. Ключ по индексу здесь безопасен: список рендерится статично
          <li key={index} className={styles.member}>
            {member.photo && media[member.photo.mediaId] ? (
              <Picture
                image={member.photo}
                media={media}
                sizes={sizes}
                priority={false}
                className={styles.photo}
              />
            ) : (
              <span className={styles.placeholder} aria-hidden="true" />
            )}
            <NameHeading className={styles.name}>{member.name}</NameHeading>
            {member.role && <p className={styles.role}>{member.role}</p>}
          </li>
        ))}
      </ul>
    </Section>
  )
}
