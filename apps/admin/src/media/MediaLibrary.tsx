import { formatBytes, imageMimeTypes } from '@averra/schema'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ChangeEvent, useId, useState } from 'react'
import { api } from '../api'
import { apiRequestError, messageOf } from '../errors'
import { mediaQuery, queryKeys } from '../queries'
import styles from './MediaLibrary.module.css'
import {
  deleteQuestion,
  type MediaItem,
  mediaLabel,
  mediaSummary,
  thumbnailUrl,
  tooLargeMessage,
} from './media-format'
import { uploadMedia } from './upload'

type MediaLibraryProps = {
  siteId: string
  /** Удалять может владелец и редактор (решает всё равно API) */
  canDelete: boolean
  /** Режим выбора для поля «картинка»: карточка становится кнопкой «Выбрать» */
  onPick?: (media: MediaItem) => void
  /** Какая картинка уже стоит в поле */
  selectedId?: string | undefined
}

type Notice = { kind: 'busy' | 'done' | 'error'; text: string }

// Браузер покажет в выборе файлов только эти типы. Это удобство: проверяет тип API по содержимому
const accept = Object.values(imageMimeTypes).join(',')

/**
 * Медиатека сайта: загрузка и сетка превью. На своём экране — с удалением, в поле «картинка» —
 * с выбором. Загрузить можно и прямо из выбора, не уходя из редактора
 */
export function MediaLibrary({ siteId, canDelete, onPick, selectedId }: MediaLibraryProps) {
  const queryClient = useQueryClient()
  const { data, error, isPending } = useQuery(mediaQuery(siteId))
  const items = data?.items
  const maxBytes = data?.maxBytes
  const inputId = useId()
  const hintId = useId()
  const [progress, setProgress] = useState<number>()
  const [notice, setNotice] = useState<Notice>()
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.media(siteId) })

  const upload = useMutation({
    mutationFn: (file: File) => uploadMedia(siteId, file, setProgress),
    onSuccess: async (media) => {
      await refresh()
      setNotice({ kind: 'done', text: `Картинка «${media.originalName}» загружена` })
    },
    onError: (failure, file) =>
      setNotice({
        kind: 'error',
        text: `Не удалось загрузить «${file.name}»: ${messageOf(failure)}`,
      }),
    onSettled: () => setProgress(undefined),
  })

  const remove = useMutation({
    mutationFn: async (media: MediaItem) => {
      const res = await api.sites[':siteId'].media[':mediaId'].$delete({
        param: { siteId, mediaId: media.id },
      })
      if (res.status !== 204) throw await apiRequestError(res)
    },
    onSuccess: async (_, media) => {
      await refresh()
      setNotice({ kind: 'done', text: `Картинка «${media.originalName}» удалена` })
    },
    onError: (failure, media) =>
      setNotice({
        kind: 'error',
        text: `Не удалось удалить «${media.originalName}»: ${messageOf(failure)}`,
      }),
  })

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Тот же файл можно выбрать снова, например после ошибки
    event.target.value = ''
    if (!file) return
    const tooLarge = tooLargeMessage(file, maxBytes)
    if (tooLarge) {
      setNotice({ kind: 'error', text: `Не удалось загрузить «${file.name}»: ${tooLarge}` })
      return
    }
    setProgress(0)
    setNotice({ kind: 'busy', text: `Загружаю «${file.name}»…` })
    upload.mutate(file)
  }

  function confirmRemove(media: MediaItem) {
    if (!window.confirm(deleteQuestion(media))) return
    setNotice(undefined)
    remove.mutate(media)
  }

  return (
    <div className={styles.library}>
      <div className={styles.upload}>
        <label htmlFor={inputId} className={styles.label}>
          Загрузить картинку
        </label>
        <input
          id={inputId}
          className={styles.fileInput}
          type="file"
          accept={accept}
          aria-describedby={hintId}
          disabled={upload.isPending}
          onChange={choose}
        />
        <p id={hintId} className={styles.hint}>
          JPEG, PNG, WebP или AVIF{maxBytes !== undefined && `, не больше ${formatBytes(maxBytes)}`}
          . Метаданные (в том числе место съёмки) удаляются, размеры для сайта нарезаются сами
        </p>
        {progress !== undefined && (
          <progress
            className={styles.progress}
            max={1}
            value={progress}
            aria-label="Загрузка картинки"
          />
        )}
      </div>

      {notice?.kind === 'error' ? (
        <p role="alert" className={styles.error}>
          {notice.text}
        </p>
      ) : (
        // Живая область есть всегда: диктор прочитает «Загружаю…» и «Загружена»
        <p role="status" className={styles.status}>
          {notice?.text}
        </p>
      )}

      {isPending && <p className={styles.muted}>Загружаю медиатеку…</p>}
      {error && (
        <p role="alert" className={styles.error}>
          Не удалось загрузить медиатеку: {messageOf(error)}
        </p>
      )}
      {items?.length === 0 && (
        <p className={styles.muted}>Картинок пока нет. Загрузите первую — она появится здесь.</p>
      )}

      {items && items.length > 0 && (
        <ul className={styles.grid} aria-label="Картинки сайта">
          {items.map((media) => (
            <li key={media.id} className={styles.card} data-selected={media.id === selectedId}>
              {/* Превью без alt: рядом подписано имя файла, а у кнопки выбора своё имя */}
              <img
                className={styles.thumb}
                src={thumbnailUrl(media.variants)}
                alt=""
                width={media.width}
                height={media.height}
                loading="lazy"
              />
              <span className={styles.name}>{media.originalName}</span>
              <span className={styles.muted}>{mediaSummary(media)}</span>
              <div className={styles.actions}>
                {onPick && (
                  <button
                    type="button"
                    className={styles.primary}
                    aria-label={`Выбрать ${mediaLabel(media)}`}
                    aria-pressed={media.id === selectedId}
                    onClick={() => onPick(media)}
                  >
                    {media.id === selectedId ? 'Выбрана' : 'Выбрать'}
                  </button>
                )}
                {canDelete && (
                  <button
                    type="button"
                    className={styles.danger}
                    aria-label={`Удалить ${mediaLabel(media)}`}
                    disabled={remove.isPending}
                    onClick={() => confirmRemove(media)}
                  >
                    Удалить
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
