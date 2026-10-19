import { SchemaForm, type Widgets } from '../forms/SchemaForm'
import { EmptyState } from '../ui/EmptyState'
import { InlineAlert } from '../ui/InlineAlert'
import { catalogEntry } from './catalog'
import type { EditorBlock } from './draft'
import styles from './Inspector.module.scss'

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
      <aside className={styles.panel} aria-label="Поля блока">
        <EmptyState title="Блок не выбран" icon="pages">
          Выберите блок в списке или в предпросмотре — здесь появятся его поля.
        </EmptyState>
      </aside>
    )
  }

  const entry = catalogEntry(block.type)
  return (
    <aside className={styles.panel} aria-label="Поля блока">
      <div className={styles.header}>
        <span className={styles.kicker}>Блок</span>
        <h2 className={styles.heading}>{entry.title}</h2>
        <p className={styles.anchor}>
          Якорь для ссылок: <code>#{block.id}</code>
        </p>
      </div>
      {errors[''] && <InlineAlert tone="danger">{errors['']}</InlineAlert>}
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
