import { SchemaForm, type Widgets } from '../forms/SchemaForm'
import { catalogEntry } from './catalog'
import type { EditorBlock } from './draft'
import styles from './Inspector.module.css'

type InspectorProps = {
  block: EditorBlock | undefined
  errors: Readonly<Record<string, string>>
  onChange: (props: Record<string, unknown>) => void
  /** Свои виджеты полей: выбор картинки из медиатеки сайта */
  widgets: Widgets
}

/** Поля выбранного блока. Форма строится по JSON Schema из каталога */
export function Inspector({ block, errors, onChange, widgets }: InspectorProps) {
  if (!block) {
    return (
      <aside className={styles.panel}>
        <p className={styles.empty}>Выбери блок слева или добавь новый</p>
      </aside>
    )
  }

  const entry = catalogEntry(block.type)
  return (
    <aside className={styles.panel} aria-label="Поля блока">
      <h2 className={styles.heading}>{entry.title}</h2>
      <p className={styles.anchor}>
        Якорь для ссылок: <code>#{block.id}</code>
      </p>
      {errors[''] && <p className={styles.error}>{errors['']}</p>}
      <SchemaForm
        key={block.id}
        schema={entry.schema}
        value={block.props}
        errors={errors}
        onChange={onChange}
        widgets={widgets}
      />
    </aside>
  )
}
