import {
  HEADER_LABEL_MAX,
  HEADER_MENU_MAX,
  type HeaderLayout,
  type HeaderTargetPage,
  type MenuItem,
  type SiteLink,
} from '@averra/schema'
import { useId, useMemo } from 'react'
import type { FieldErrors } from '../forms/field-errors'
import { useItemKeys } from '../forms/item-keys'
import { Button, IconButton } from '../ui/Button'
import { cx } from '../ui/cx'
import { Select, TextInput } from '../ui/Field'
import { DragHandle, SortableList, useSortableItem } from '../ui/SortableList'
import { moveItem } from '../ui/sortable'
import { useMoveButtons } from '../ui/use-move-buttons'
import styles from './HeaderParts.module.scss'
import { linkOf, menuItemName, newMenuItem, targetGroups, targetValue } from './header-format'

/**
 * Миниатюра раскладки шапки (концепт Main): полосы логотипа, меню и кнопки. Только рисунок —
 * подпись варианта рядом
 */
export function HeaderLayoutSketch({ layout }: { layout: HeaderLayout }) {
  return (
    <span className={styles.sketch} data-layout={layout}>
      {layout === 'double' && <span className={styles.sketchTopbar} />}
      <span className={styles.sketchRow}>
        <span className={cx(styles.sketchBar, styles.sketchLogo)} />
        {layout !== 'minimal' && <span className={cx(styles.sketchBar, styles.sketchMenu)} />}
        <span className={cx(styles.sketchBar, styles.sketchButton)} />
      </span>
    </span>
  )
}

type LinkSelectProps = {
  label: string
  name: string
  link: SiteLink
  pages: readonly HeaderTargetPage[]
  error?: string | undefined
  hint?: string | undefined
  disabled?: boolean
  onChange: (link: SiteLink) => void
}

/** «Куда ведёт»: страница сайта целиком или блок на ней, по группам страниц */
export function LinkSelect({
  label,
  name,
  link,
  pages,
  error,
  hint,
  disabled,
  onChange,
}: LinkSelectProps) {
  const groups = useMemo(() => targetGroups(pages, link), [pages, link])
  return (
    <Select
      label={label}
      name={name}
      value={targetValue(link)}
      error={error}
      hint={hint}
      disabled={disabled}
      onChange={(event) => onChange(linkOf(event.target.value))}
    >
      {groups.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  )
}

type MenuEditorProps = {
  items: readonly MenuItem[]
  pages: readonly HeaderTargetPage[]
  /** Ошибки полей по путям формы: menu.0.label, menu.2.block */
  errors: FieldErrors
  /** Предупреждения пунктов по номеру: цель не опубликована — опубликовать шапку пока нельзя */
  warnings: ReadonlyMap<number, string>
  disabled?: boolean
  onChange: (items: readonly MenuItem[]) => void
}

/**
 * Редактор меню (концепт Main, вкладка «Меню»): пункт — подпись и куда ведёт. Порядок —
 * перетаскиванием за ручку, мышью, пальцем и с клавиатуры, и стрелками, как блоки в редакторе
 */
export function MenuEditor({
  items,
  pages,
  errors,
  warnings,
  disabled,
  onChange,
}: MenuEditorProps) {
  const keys = useItemKeys(items.length)
  const headingId = useId()
  const limitId = useId()
  const full = items.length >= HEADER_MENU_MAX
  const entries = useMemo(
    () =>
      items.map((item, index) => ({
        id: keys.keys[index] ?? String(index),
        label: menuItemName(item, index),
      })),
    [items, keys.keys],
  )

  const move = (from: number, to: number) => {
    keys.move(from, to)
    onChange(moveItem(items, from, to))
  }
  const update = (index: number, item: MenuItem) => onChange(items.with(index, item))
  const remove = (index: number) => {
    keys.remove(index)
    onChange(items.toSpliced(index, 1))
  }

  return (
    <div className={styles.menu}>
      <div className={styles.menuHeader}>
        <h3 id={headingId} className={styles.menuHeading}>
          Пункты меню
        </h3>
        <span className={styles.count}>
          {items.length} из {HEADER_MENU_MAX}
        </span>
      </div>
      {items.length === 0 && (
        <p className={styles.empty}>
          Меню пока пустое. Пункт ведёт на страницу сайта или на блок на ней — например, «Цены».
        </p>
      )}
      <SortableList entries={entries} noun="пункт" onMove={move}>
        <ol className={styles.list} aria-labelledby={headingId}>
          {items.map((item, index) => (
            <MenuRow
              key={entries[index]?.id}
              id={entries[index]?.id ?? String(index)}
              item={item}
              index={index}
              count={items.length}
              pages={pages}
              errors={errors}
              warning={warnings.get(index)}
              disabled={disabled}
              onMove={move}
              onChange={(next) => update(index, next)}
              onRemove={() => remove(index)}
            />
          ))}
        </ol>
      </SortableList>
      {!disabled && (
        // На пределе — aria-disabled: кнопка остаётся в порядке Tab, и диктор прочитает почему
        <Button
          icon="plus"
          className={styles.add}
          aria-disabled={full ? true : undefined}
          aria-describedby={full ? limitId : undefined}
          onClick={() => {
            if (!full) onChange([...items, newMenuItem()])
          }}
        >
          Пункт меню
        </Button>
      )}
      {full && (
        <p id={limitId} className={styles.empty}>
          В меню уже {HEADER_MENU_MAX} пунктов — больше в строку шапки не встанет.
        </p>
      )}
    </div>
  )
}

type MenuRowProps = {
  id: string
  item: MenuItem
  index: number
  count: number
  pages: readonly HeaderTargetPage[]
  errors: FieldErrors
  warning: string | undefined
  disabled: boolean | undefined
  onMove: (from: number, to: number) => void
  onChange: (item: MenuItem) => void
  onRemove: () => void
}

function MenuRow({
  id,
  item,
  index,
  count,
  pages,
  errors,
  warning,
  disabled,
  onMove,
  onChange,
  onRemove,
}: MenuRowProps) {
  const sortable = useSortableItem(id)
  const arrows = useMoveButtons(index, count, onMove)
  const name = menuItemName(item, index)
  const path = `menu.${index}`
  return (
    <li
      ref={sortable.ref}
      style={sortable.style}
      className={styles.item}
      data-dragging={sortable.dragging}
      data-invalid={
        errors[`${path}.label`] || errors[`${path}.page`] || errors[`${path}.block`]
          ? ''
          : undefined
      }
    >
      {!disabled && <DragHandle handle={sortable.handle} label={`Перетащить пункт «${name}»`} />}
      <div className={styles.fields}>
        <TextInput
          label="Подпись"
          name={`${path}.label`}
          value={item.label}
          maxChars={HEADER_LABEL_MAX}
          error={errors[`${path}.label`]}
          disabled={disabled}
          onChange={(event) => onChange({ ...item, label: event.target.value })}
        />
        <LinkSelect
          label="Куда ведёт"
          name={`${path}.target`}
          link={item}
          pages={pages}
          error={errors[`${path}.page`] ?? errors[`${path}.block`]}
          hint={warning}
          disabled={disabled}
          onChange={(link) => onChange({ label: item.label, ...link })}
        />
      </div>
      {!disabled && (
        <span className={styles.actions}>
          <IconButton
            label={`Поднять пункт «${name}»`}
            icon="arrow-up"
            size="small"
            {...arrows.up}
          />
          <IconButton
            label={`Опустить пункт «${name}»`}
            icon="arrow-down"
            size="small"
            {...arrows.down}
          />
          <IconButton
            label={`Удалить пункт «${name}»`}
            icon="trash"
            size="small"
            onClick={onRemove}
          />
        </span>
      )}
    </li>
  )
}
