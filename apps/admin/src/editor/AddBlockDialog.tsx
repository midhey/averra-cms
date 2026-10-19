import type { BlockType } from '@averra/schema'
import { Dialog } from '../ui/Dialog'
import styles from './AddBlockDialog.module.scss'
import { catalog } from './catalog'

type AddBlockDialogProps = {
  open: boolean
  onClose: () => void
  onPick: (type: BlockType) => void
  /** Куда встанет блок: после выбранного (его имя) или в конец страницы */
  after: string | null
}

/** Пример блока одной строкой — заголовок из примера заполнения, с ним блок и появится */
function exampleOf(example: unknown) {
  const title = (example as { title?: unknown } | null)?.title
  return typeof title === 'string' ? title : undefined
}

/**
 * Каталог блоков в окне: название, описание и пример. Выбор — обычная кнопка: Tab и Enter,
 * Esc закрывает, по закрытии браузер возвращает фокус на «Добавить блок»
 */
export function AddBlockDialog({ open, onClose, onPick, after }: AddBlockDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Добавить блок"
      description={
        after === null ? 'Блок встанет в конец страницы.' : `Блок встанет после «${after}».`
      }
    >
      <ul className={styles.list} aria-label="Каталог блоков">
        {catalog.map((entry) => {
          const example = exampleOf(entry.example)
          return (
            <li key={entry.type}>
              <button type="button" className={styles.option} onClick={() => onPick(entry.type)}>
                <span className={styles.title}>{entry.title}</span>
                <span className={styles.description}>{entry.description}</span>
                {example && <span className={styles.example}>Пример: «{example}»</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </Dialog>
  )
}
