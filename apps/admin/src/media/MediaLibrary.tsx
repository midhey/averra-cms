import { formatBytes, imageMimeTypes, mediaMimeTypes } from '@averra/schema'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ChangeEvent, useId, useState } from 'react'
import { api } from '../api'
import { apiRequestError, messageOf } from '../errors'
import { mediaQuery, queryKeys } from '../queries'
import { Button, buttonClassName, Spinner } from '../ui/Button'
import { cx } from '../ui/cx'
import { EmptyState } from '../ui/EmptyState'
import { Icon } from '../ui/Icon'
import { InlineAlert } from '../ui/InlineAlert'
import styles from './MediaLibrary.module.scss'
import {
  deleteQuestion,
  isSvgItem,
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
  /**
   * Можно ли SVG. На экране медиатеки и у логотипа с иконкой — да. В блоках, SEO-картинке страницы
   * и картинке для соцсетей — нет (их не пустит API): SVG там не показываем и не предлагаем загрузить
   */
  allowSvg?: boolean
}

type Notice = { kind: 'busy' | 'done' | 'error'; text: string }

// Браузер покажет в выборе файлов только эти типы. Это удобство: проверяет тип API по содержимому
const acceptAll = Object.values(mediaMimeTypes).join(',')
const acceptRaster = Object.values(imageMimeTypes).join(',')

/**
 * Медиатека сайта: загрузка и сетка превью. На своём экране — с удалением, в поле «картинка» —
 * с выбором. Загрузить можно и прямо из выбора, не уходя из редактора
 */
export function MediaLibrary({
  siteId,
  canDelete,
  onPick,
  selectedId,
  allowSvg = true,
}: MediaLibraryProps) {
  const queryClient = useQueryClient()
  const { data, error, isPending } = useQuery(mediaQuery(siteId))
  const items = allowSvg ? data?.items : data?.items.filter((media) => !isSvgItem(media))
  const hiddenSvg = (data?.items.length ?? 0) - (items?.length ?? 0)
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
      // SVG в выборе для блока не показываем: без пояснения он «пропал» бы сразу после загрузки
      setNotice(
        !allowSvg && isSvgItem(media)
          ? {
              kind: 'error',
              text: `SVG «${media.originalName}» загружен в медиатеку, но сюда его поставить нельзя: SVG — только для логотипа и иконки сайта`,
            }
          : { kind: 'done', text: `Картинка «${media.originalName}» загружена` },
      )
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
        {/* Поле файла — настоящее (с клавиатуры и диктором), а видна его подпись в виде кнопки:
            кольцо фокуса поля рисуется на ней */}
        <input
          id={inputId}
          className={cx(styles.fileInput, 'visually-hidden')}
          type="file"
          accept={allowSvg ? acceptAll : acceptRaster}
          aria-describedby={hintId}
          disabled={upload.isPending}
          onChange={choose}
        />
        <label htmlFor={inputId} className={cx(buttonClassName(), styles.uploadButton)}>
          {upload.isPending ? <Spinner /> : <Icon name="upload" />}
          Загрузить картинку
        </label>
        <p id={hintId} className={styles.hint}>
          JPEG, PNG, WebP или AVIF{maxBytes !== undefined && `, не больше ${formatBytes(maxBytes)}`}
          . Метаданные (в том числе место съёмки) удаляются, размеры для сайта нарезаются сами.
          {allowSvg
            ? ' SVG — для логотипа и иконки сайта: его очищают от скриптов и ссылок наружу'
            : ' SVG сюда не ставится: он только для логотипа и иконки сайта'}
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
        <InlineAlert tone="danger">
          <span className={styles.error}>{notice.text}</span>
        </InlineAlert>
      ) : (
        // Живая область есть всегда: диктор прочитает «Загружаю…» и «Загружена»
        <p role="status" className={styles.status}>
          {notice?.text}
        </p>
      )}

      {isPending && (
        <p className={styles.loading}>
          <Spinner />
          Загружаю медиатеку…
        </p>
      )}
      {error && (
        <InlineAlert tone="danger">Не удалось загрузить медиатеку: {messageOf(error)}</InlineAlert>
      )}
      {items?.length === 0 && (
        <EmptyState title="Картинок пока нет" icon="media" headingLevel={3}>
          {hiddenSvg > 0
            ? 'В медиатеке только SVG, а сюда нужна обычная картинка. Загрузите JPEG, PNG, WebP или AVIF.'
            : 'Загрузите первую — она появится здесь.'}
        </EmptyState>
      )}

      {items && items.length > 0 && (
        <ul className={styles.grid} aria-label="Картинки сайта">
          {items.map((media) => (
            <li
              key={media.id}
              className={cx(styles.card, media.id === selectedId && styles.selected)}
            >
              {/* Превью без alt: рядом подписано имя файла, а у кнопки выбора своё имя */}
              <img
                // Логотип SVG — целиком, а не обрезанный под рамку превью
                className={cx(styles.thumb, isSvgItem(media) && styles.whole)}
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
                  <Button
                    variant={media.id === selectedId ? 'secondary' : 'primary'}
                    size="small"
                    icon={media.id === selectedId ? 'check' : undefined}
                    aria-label={`Выбрать ${mediaLabel(media)}`}
                    aria-pressed={media.id === selectedId}
                    onClick={() => onPick(media)}
                  >
                    {media.id === selectedId ? 'Выбрана' : 'Выбрать'}
                  </Button>
                )}
                {canDelete && (
                  <Button
                    variant="danger"
                    size="small"
                    icon="trash"
                    aria-label={`Удалить ${mediaLabel(media)}`}
                    disabled={remove.isPending}
                    onClick={() => confirmRemove(media)}
                  >
                    Удалить
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
