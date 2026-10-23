import type { BlockComponentProps } from '../types'
import { Picture } from '../ui/Picture'
import { Section } from '../ui/Section'
import styles from './Team.module.css'

// Ширина фото по колонкам: доля контейнера (72rem) на широком экране, половина — на телефоне
const sizesFor = (columns: number) =>
  `(min-width: 72rem) ${Math.round(72 / columns)}rem, (min-width: 40rem) 33vw, 50vw`

/** Команда: фото, имя (заголовок пункта) и должность. Без фото — плашка поверхности */
export function Team({ id, data, headingLevel, media }: BlockComponentProps<'team'>) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  const NameHeading = headingLevel === 1 ? 'h2' : 'h3'
  const sizes = sizesFor(data.columns)
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
