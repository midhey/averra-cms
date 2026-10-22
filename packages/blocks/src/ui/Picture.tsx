import { type Image, type ImageFormat, imageMimeTypes, type MediaMap } from '@averra/schema'
import styles from './Picture.module.css'

type PictureProps = {
  image: Image
  media: MediaMap
  /** Какой ширины картинка на экране: по этому браузер выбирает вариант из srcset */
  sizes: string
  /** Картинка первого экрана: грузить сразу и в первую очередь, а не лениво */
  priority: boolean
  className?: string
}

/**
 * Картинка из медиатеки: AVIF и WebP для современных браузеров и исходный формат для
 * остальных, у каждого формата — набор ширин. width и height — размеры исходника: по ним
 * браузер заранее оставляет место под картинку, и вёрстка не прыгает при загрузке
 */
export function Picture({ image, media, sizes, priority, className }: PictureProps) {
  const file = media[image.mediaId]
  // Ссылку на картинку не из медиатеки сайта не пропустит API. Если всё же нет — без картинки
  if (!file) return null

  // SVG — один файл без вариантов (логотип для будущей шапки). В блоки API его не пускает, но
  // если он здесь окажется, выводим его как есть, а не пустое место
  const vector = file.variants.find((variant) => variant.format === 'svg')
  if (vector) {
    return (
      <picture className={className}>
        <img
          className={styles.image}
          src={vector.url}
          width={file.width}
          height={file.height}
          alt={image.alt}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
        />
      </picture>
    )
  }

  const srcSet = (format: ImageFormat) =>
    file.variants
      .filter((variant) => variant.format === format)
      .toSorted((a, b) => a.width - b.width)
      .map((variant) => `${variant.url} ${variant.width}w`)
      .join(', ')

  // Запасной формат — исходный JPEG или PNG. Если исходник был WebP или AVIF, запасной — WebP
  const fallback: ImageFormat =
    file.variants
      .map((variant) => variant.format)
      .find((format): format is 'jpeg' | 'png' => format === 'jpeg' || format === 'png') ?? 'webp'
  const largest = file.variants
    .filter((variant) => variant.format === fallback)
    .reduce<(typeof file.variants)[number] | undefined>(
      (best, variant) => (!best || variant.width > best.width ? variant : best),
      undefined,
    )
  if (!largest) return null

  const sources = (['avif', 'webp'] as const).filter(
    (format) => format !== fallback && srcSet(format) !== '',
  )

  return (
    <picture className={className}>
      {sources.map((format) => (
        <source key={format} type={imageMimeTypes[format]} srcSet={srcSet(format)} sizes={sizes} />
      ))}
      <img
        className={styles.image}
        src={largest.url}
        srcSet={srcSet(fallback)}
        sizes={sizes}
        width={file.width}
        height={file.height}
        alt={image.alt}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : undefined}
        decoding="async"
      />
    </picture>
  )
}
