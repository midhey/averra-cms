import { parseTextBody } from '@averra/schema'
import styles from './TextBody.module.css'

/**
 * Текст из лёгкой разметки (parseTextBody): абзацы, подзаголовки «## » и списки «- ». Без обёртки —
 * части встают прямо в сетку блока («Текст», «Текст с картинкой») и получают её отступы.
 * headingLevel — уровень заголовка блока: подзаголовки текста на уровень ниже
 */
export function TextBody({ body, headingLevel }: { body: string; headingLevel: 1 | 2 }) {
  const SubHeading = headingLevel === 1 ? 'h2' : 'h3'
  const parts = parseTextBody(body).map((part, index) => {
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
  })
  return <>{parts}</>
}
