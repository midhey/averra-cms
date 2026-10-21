import { useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { type Path, pathKey } from '../forms/path'
import type { FieldProps } from '../forms/SchemaForm'
import { mediaQuery } from '../queries'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { TextInput } from '../ui/Field'
import styles from './ImageField.module.scss'
import { MediaCard } from './MediaCard'
import { MediaLibrary } from './MediaLibrary'
import { type MediaItem, mediaFormats, thumbnailUrl } from './media-format'

type ImageValue = { mediaId?: unknown; alt?: unknown }

const asImage = (value: unknown): ImageValue | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as ImageValue)
    : undefined

/**
 * Поле «картинка»: карточка выбранной картинки (превью, имя, размеры и форматы) с «Заменить»
 * и описание (alt) — оно обязательно. Значение — { mediaId, alt }, как в схеме Image.
 * Медиатека открывается окном (Dialog): фокус остаётся в нём, Esc закрывает, а загрузить
 * новую картинку можно прямо оттуда
 */
export function ImageField({ siteId, ...props }: FieldProps & { siteId: string }) {
  const { schema, value, path, label, errors, onChange } = props
  const image = asImage(value)
  const mediaId = typeof image?.mediaId === 'string' ? image.mediaId : undefined
  const alt = typeof image?.alt === 'string' ? image.alt : ''
  const { data: library } = useQuery(mediaQuery(siteId))
  const chosen = library?.items.find((media) => media.id === mediaId)
  const [picking, setPicking] = useState(false)
  const errorId = useId()
  const hintId = useId()

  const at = (...rest: Path) => errors[pathKey([...path, ...rest])]
  const error = at() ?? at('mediaId')
  const altSchema = schema.properties?.alt

  function pick(media: MediaItem) {
    // Alt остаётся прежним: заменили фото на похожее — описание обычно то же
    onChange(path, { mediaId: media.id, alt })
    setPicking(false)
  }

  const describedBy = [schema.description && hintId, error && errorId].filter(Boolean).join(' ')

  return (
    <fieldset
      className={styles.field}
      aria-describedby={describedBy || undefined}
      // aria-invalid у группы полей не предусмотрен:
      // ошибку читает aria-describedby, рамка — по data
      data-invalid={error ? true : undefined}
    >
      {/* Без пометки «необязательно»: обязательна ли картинка, решает не сама схема поля,
          а соседние поля (у первого экрана — вариант «С картинкой»). Правило — в описании поля */}
      <legend className={styles.legend}>{label}</legend>
      {schema.description && (
        <p id={hintId} className={styles.hint}>
          {schema.description}
        </p>
      )}

      <MediaCard
        invalid={error !== undefined}
        thumbnail={mediaId && chosen ? thumbnailUrl(chosen.variants) : undefined}
        name={mediaId && chosen ? chosen.originalName : undefined}
        meta={
          mediaId && chosen ? (
            <>
              {chosen.width} × {chosen.height}
              {chosen.variants.length > 0 && ` · ${mediaFormats(chosen.variants)}`}
            </>
          ) : !mediaId ? (
            'Картинка не выбрана'
          ) : library ? (
            'Этой картинки нет в медиатеке сайта'
          ) : (
            'Загружаю…'
          )
        }
        action={
          <Button size="small" onClick={() => setPicking(true)}>
            {mediaId ? 'Заменить' : 'Выбрать картинку'}
          </Button>
        }
      />

      {error && (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}

      {image && (
        <>
          <TextInput
            label={altSchema?.title ?? 'Описание картинки (alt)'}
            hint="Что на картинке — коротко, как сказали бы вслух"
            error={at('alt')}
            value={alt}
            maxChars={altSchema?.maxLength}
            // Пустой alt храним пустой строкой: схема ответит «опишите картинку», а не «нет поля»
            onChange={(event) => onChange([...path, 'alt'], event.target.value)}
          />
          <Button
            variant="ghost"
            size="small"
            icon="trash"
            className={styles.remove}
            onClick={() => onChange(path, undefined)}
          >
            Убрать картинку
          </Button>
        </>
      )}

      <Dialog
        open={picking}
        onClose={() => setPicking(false)}
        title="Медиатека: выберите картинку"
        size="large"
      >
        {picking && (
          <MediaLibrary siteId={siteId} canDelete={false} onPick={pick} selectedId={mediaId} />
        )}
      </Dialog>
    </fieldset>
  )
}
