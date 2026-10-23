import type { BlockComponentProps } from '../types'
import { gridSizes } from '../ui/grid-sizes'
import { fullSizeUrl, Picture } from '../ui/Picture'
import { Section } from '../ui/Section'
import styles from './Gallery.module.css'

// Ширина фото — как сетка в Gallery.module.css: одна колонка на телефоне, две с 40rem, с 64rem —
// сколько выбрано
const sizesFor = (columns: number) =>
  gridSizes(1, [
    [40, 2],
    [64, columns],
  ])

/**
 * Наши работы: сетка фото с подписями. Фото — ссылка на снимок целиком (без JS лайтбокса нет,
 * браузер откроет файл сам). Фото не выбрано — плашка поверхности на его месте
 */
export function Gallery({ id, data, headingLevel, media }: BlockComponentProps<'gallery'>) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  const sizes = sizesFor(data.columns)
  return (
    <Section id={id}>
      {(data.title || data.text) && (
        <div className={styles.header}>
          {data.title && <Heading className={styles.title}>{data.title}</Heading>}
          {data.text && <p className={styles.text}>{data.text}</p>}
        </div>
      )}
      {/* biome-ignore lint/a11y/noRedundantRoles: Safari без маркеров списка теряет роль list */}
      <ul role="list" className={styles.grid} data-columns={data.columns} data-aspect={data.aspect}>
        {data.items.map((item, index) => {
          const file = item.image ? media[item.image.mediaId] : undefined
          const full = data.linkToFull && file ? fullSizeUrl(file) : undefined
          const picture =
            item.image && file ? (
              <Picture
                image={item.image}
                media={media}
                sizes={sizes}
                priority={false}
                className={styles.photo}
              />
            ) : (
              <span className={styles.placeholder} aria-hidden="true" />
            )
          return (
            // У фото нет id. Ключ по индексу здесь безопасен: список рендерится статично
            <li key={index}>
              <figure className={styles.figure}>
                {full ? (
                  <a className={styles.link} href={full}>
                    {picture}
                  </a>
                ) : (
                  picture
                )}
                {item.caption && <figcaption className={styles.caption}>{item.caption}</figcaption>}
              </figure>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}
