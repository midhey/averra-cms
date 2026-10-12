import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import { type Path, pathKey } from '../forms/path'
import type { FieldProps } from '../forms/SchemaForm'
import { mediaQuery } from '../queries'
import styles from './ImageField.module.css'
import { MediaLibrary } from './MediaLibrary'
import type { MediaItem } from './media-format'
import { thumbnailUrl } from './media-format'

type ImageValue = { mediaId?: unknown; alt?: unknown }

const asImage = (value: unknown): ImageValue | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as ImageValue)
    : undefined

/**
 * Поле «картинка»: выбор из медиатеки сайта и описание (alt). Значение — { mediaId, alt },
 * как в схеме Image. Медиатека открывается модальным <dialog>: фокус остаётся в нём,
 * Esc закрывает, а загрузить новую картинку можно прямо оттуда
 */
export function ImageField({ siteId, ...props }: FieldProps & { siteId: string }) {
  const { schema, value, path, label, required, errors, onChange } = props
  const image = asImage(value)
  const mediaId = typeof image?.mediaId === 'string' ? image.mediaId : undefined
  const alt = typeof image?.alt === 'string' ? image.alt : ''
  const { data: library } = useQuery(mediaQuery(siteId))
  const chosen = library?.items.find((media) => media.id === mediaId)

  const [picking, setPicking] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const dialogHeadingId = useId()
  const errorId = useId()
  const altId = useId()
  const altHintId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (picking && dialog && !dialog.open) dialog.showModal()
  }, [picking])

  const at = (...rest: Path) => errors[pathKey([...path, ...rest])]
  const error = at() ?? at('mediaId')
  const altError = at('alt')
  const altSchema = schema.properties?.alt
  const altMax = altSchema?.maxLength

  function pick(media: MediaItem) {
    // Alt остаётся прежним: заменили фото на похожее — описание обычно то же
    onChange(path, { mediaId: media.id, alt })
    dialogRef.current?.close()
  }

  return (
    <fieldset
      className={styles.field}
      aria-describedby={error ? errorId : undefined}
      // aria-invalid у группы полей не предусмотрен: ошибку читает aria-describedby, рамка — по data
      data-invalid={error ? true : undefined}
    >
      <legend className={styles.legend}>
        {label}
        {!required && <span className={styles.optional}> · необязательно</span>}
      </legend>
      {schema.description && <p className={styles.hint}>{schema.description}</p>}

      {mediaId && (
        <div className={styles.chosen}>
          {chosen ? (
            <>
              <img className={styles.thumb} src={thumbnailUrl(chosen.variants)} alt="" />
              <span className={styles.name}>{chosen.originalName}</span>
            </>
          ) : (
            <span className={styles.hint}>
              {library ? 'Этой картинки нет в медиатеке сайта' : 'Загружаю…'}
            </span>
          )}
        </div>
      )}

      <div className={styles.actions}>
        <button type="button" onClick={() => setPicking(true)}>
          {mediaId ? 'Заменить картинку' : 'Выбрать картинку'}
        </button>
        {image && (
          <button type="button" onClick={() => onChange(path, undefined)}>
            Убрать картинку
          </button>
        )}
      </div>
      {error && (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}

      {image && (
        <div className={styles.alt}>
          <label htmlFor={altId} className={styles.label}>
            {altSchema?.title ?? 'Описание картинки (alt)'}
          </label>
          <input
            id={altId}
            className={styles.input}
            type="text"
            value={alt}
            maxLength={altMax}
            aria-invalid={altError ? true : undefined}
            aria-describedby={altHintId}
            // Пустой alt храним пустой строкой: схема ответит «опишите картинку», а не «нет поля»
            onChange={(event) => onChange([...path, 'alt'], event.target.value)}
          />
          <div id={altHintId} className={styles.hint}>
            <span className={altError ? styles.error : undefined}>
              {altError ?? 'Что на картинке — коротко, как сказали бы вслух'}
            </span>
            {altMax !== undefined && (
              <span>
                {alt.length}/{altMax}
              </span>
            )}
          </div>
        </div>
      )}

      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-labelledby={dialogHeadingId}
        onClose={() => setPicking(false)}
      >
        <div className={styles.dialogBar}>
          <h2 id={dialogHeadingId} className={styles.dialogHeading}>
            Медиатека: выберите картинку
          </h2>
          <button type="button" onClick={() => dialogRef.current?.close()}>
            Закрыть
          </button>
        </div>
        {picking && (
          <MediaLibrary siteId={siteId} canDelete={false} onPick={pick} selectedId={mediaId} />
        )}
      </dialog>
    </fieldset>
  )
}
