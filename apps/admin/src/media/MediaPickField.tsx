import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useId, useState } from 'react'
import { mediaQuery } from '../queries'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import styles from './ImageField.module.scss'
import { MediaCard } from './MediaCard'
import { MediaLibrary } from './MediaLibrary'
import { isSvgItem, mediaFormats, thumbnailUrl } from './media-format'

type MediaPickFieldProps = {
  siteId: string
  label: string
  hint?: ReactNode
  /** Id выбранной картинки или null */
  value: string | null
  onChange: (mediaId: string | null) => void
  error?: string | undefined
  /** Имя кнопки выбора: по нему форма переводит фокус к полю с ошибкой */
  name: string
  /** Превью квадратом — для иконки сайта */
  square?: boolean
  /** SVG можно: логотип и иконка. Картинке для соцсетей — нет, её SVG соцсети не покажут */
  allowSvg?: boolean
  /** Только просмотр: картинку видно, выбрать и убрать нельзя (у кого нет права менять) */
  disabled?: boolean
}

/**
 * Поле «картинка из медиатеки» без описания (alt): иконка сайта, картинка для соцсетей, логотип.
 * У блоков страницы своё поле — ImageField: там alt обязателен
 */
export function MediaPickField({
  siteId,
  label,
  hint,
  value,
  onChange,
  error,
  name,
  square,
  allowSvg = false,
  disabled = false,
}: MediaPickFieldProps) {
  const { data: library } = useQuery(mediaQuery(siteId))
  const chosen = library?.items.find((media) => media.id === value)
  const [picking, setPicking] = useState(false)
  const hintId = useId()
  const errorId = useId()
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ')

  return (
    <fieldset className={styles.field} aria-describedby={describedBy || undefined}>
      <legend className={styles.legend}>{label}</legend>
      {hint && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      <MediaCard
        square={square}
        whole={chosen !== undefined && isSvgItem(chosen)}
        invalid={error !== undefined}
        thumbnail={chosen && thumbnailUrl(chosen.variants)}
        name={chosen?.originalName}
        meta={
          chosen
            ? `${chosen.width} × ${chosen.height} · ${mediaFormats(chosen.variants)}`
            : !value
              ? 'Картинка не выбрана'
              : library
                ? 'Этой картинки нет в медиатеке сайта'
                : 'Загружаю…'
        }
        action={
          disabled ? undefined : (
            <Button size="small" name={name} onClick={() => setPicking(true)}>
              {value ? 'Заменить' : 'Выбрать картинку'}
            </Button>
          )
        }
      />
      {error && (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
      {value && !disabled && (
        <Button
          variant="ghost"
          size="small"
          icon="trash"
          className={styles.remove}
          onClick={() => onChange(null)}
        >
          Убрать картинку
        </Button>
      )}
      <Dialog
        open={picking}
        onClose={() => setPicking(false)}
        title={`Медиатека: ${label.toLowerCase()}`}
        size="large"
      >
        {picking && (
          <MediaLibrary
            siteId={siteId}
            canDelete={false}
            allowSvg={allowSvg}
            selectedId={value ?? undefined}
            onPick={(media) => {
              onChange(media.id)
              setPicking(false)
            }}
          />
        )}
      </Dialog>
    </fieldset>
  )
}
