import { SchemaForm, type Widgets } from '../forms/SchemaForm'
import { EmptyState } from '../ui/EmptyState'
import { InlineAlert } from '../ui/InlineAlert'
import { type CatalogEntry, catalog, findEntry } from './catalog'
import type { EditorBlock } from './draft'
import styles from './Inspector.module.scss'

type InspectorProps = {
  block: EditorBlock | undefined
  errors: Readonly<Record<string, string>>
  onChange: (props: Record<string, unknown>) => void
  /** Свои виджеты полей: выбор картинки из медиатеки сайта */
  widgets: Widgets
  /** Каталог со своими блоками сайта: из него форма своего блока */
  entries?: readonly CatalogEntry[]
}

/** Поля выбранного блока. Форма строится по JSON Schema из каталога */
export function Inspector({ block, errors, onChange, widgets, entries = catalog }: InspectorProps) {
  if (!block) {
    return (
      <aside className={styles.panel} aria-label="Поля блока">
        <EmptyState title="Блок не выбран" icon="pages">
          Выберите блок в списке или в предпросмотре — здесь появятся его поля.
        </EmptyState>
      </aside>
    )
  }

  const entry = findEntry(block.type, entries)
  return (
    <aside className={styles.panel} aria-label="Поля блока">
      <div className={styles.header}>
        <span className={styles.kicker}>{entry?.custom ? 'Свой блок' : 'Блок'}</span>
        <h2 className={styles.heading}>{entry?.title ?? block.type}</h2>
        <p className={styles.anchor}>
          Якорь для ссылок: <code>#{block.id}</code>
        </p>
      </div>
      {errors[''] && <InlineAlert tone="danger">{errors['']}</InlineAlert>}
      {entry ? (
        <SchemaForm
          key={block.id}
          schema={entry.schema}
          value={block.props}
          errors={errors}
          onChange={onChange}
          widgets={widgets}
        />
      ) : (
        // Свой блок, определение которого сняли с публикации или удалили: полей нет, а сам блок
        // можно только убрать со страницы
        <InlineAlert tone="warning" title="Определения блока нет на сайте">
          Его удалили или ещё не опубликовали в разделе «Свои блоки». Уберите блок со страницы или
          попросите владельца опубликовать его.
        </InlineAlert>
      )}
    </aside>
  )
}
