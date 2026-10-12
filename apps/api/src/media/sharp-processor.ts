import { type ImageFormat, imageFormatOf } from '@cms/schema'
import sharp, { type Metadata, type Sharp } from 'sharp'
import {
  concurrencyLimit,
  fileExtension,
  type ImageProcessor,
  MAX_PIXELS,
  PROCESSING_CONCURRENCY,
  type ProcessedFile,
  type ProcessResult,
  variantFormats,
  variantWidths,
} from './processor'

/** Варианты — для сайта: размер важнее последних процентов качества */
function encodeVariant(pipeline: Sharp, format: ImageFormat) {
  switch (format) {
    case 'avif':
      return pipeline.avif({ quality: 55, effort: 4 })
    case 'webp':
      return pipeline.webp({ quality: 80 })
    case 'jpeg':
      return pipeline.jpeg({ quality: 82, mozjpeg: true })
    case 'png':
      return pipeline.png({ compressionLevel: 9 })
  }
}

/** Оригинал — запас на будущее: качество выше, чем у вариантов */
function encodeOriginal(pipeline: Sharp, format: ImageFormat) {
  switch (format) {
    case 'avif':
      return pipeline.avif({ quality: 75 })
    case 'webp':
      return pipeline.webp({ quality: 92 })
    case 'jpeg':
      return pipeline.jpeg({ quality: 92 })
    case 'png':
      return pipeline.png()
  }
}

/**
 * Обработка на sharp. Каждый файл — новый конвейер с autoOrient: снимок сначала
 * поворачивается по EXIF, а потом кодируется без метаданных. Метаданные (EXIF с GPS, XMP,
 * IPTC, ICC) sharp не переносит в результат, пока его об этом не попросить
 * (keepMetadata/withMetadata) — мы не просим.
 *
 * Нагрузка ограничена с двух сторон: одновременно обрабатывается не больше concurrency
 * картинок на процесс (очередь общая для всех запросов), а внутри одной ширины идут по
 * очереди — одновременно не больше трёх конвейеров (форматы одной ширины)
 */
export function sharpProcessor({ concurrency = PROCESSING_CONCURRENCY } = {}): ImageProcessor {
  const queue = concurrencyLimit(concurrency)
  return {
    async process(data) {
      let metadata: Metadata
      try {
        // Только заголовок: пиксели здесь не декодируются, поэтому лимит пикселей ниже
        metadata = await sharp(data, { limitInputPixels: false }).metadata()
      } catch {
        return { ok: false, reason: 'unsupported' }
      }
      // Тип — по содержимому (mediaType из заголовка файла), а не по имени и не по
      // Content-Type из запроса: и то и другое пишет сам клиент
      const format = metadata.mediaType && imageFormatOf[metadata.mediaType]
      if (!format) return { ok: false, reason: 'unsupported' }
      if (metadata.width * metadata.height > MAX_PIXELS) {
        return { ok: false, reason: 'too_many_pixels' }
      }

      const { width, height } = metadata.autoOrient
      const input = () => sharp(data, { autoOrient: true, limitInputPixels: MAX_PIXELS })
      const encode = async (pipeline: Sharp, file: string, fileFormat: ImageFormat) => {
        const { data: bytes, info } = await pipeline.toBuffer({ resolveWithObject: true })
        const result: ProcessedFile = {
          file,
          format: fileFormat,
          width: info.width,
          height: info.height,
          data: new Uint8Array(bytes),
        }
        return result
      }

      // Проверки выше читают только заголовок и в очередь не встают: отказ приходит сразу
      return queue(async (): Promise<ProcessResult> => {
        try {
          const original = await encode(
            encodeOriginal(input(), format),
            `original.${fileExtension(format)}`,
            format,
          )
          const variants: ProcessedFile[] = []
          for (const variantWidth of variantWidths(width)) {
            variants.push(
              ...(await Promise.all(
                variantFormats(format).map((variantFormat) =>
                  encode(
                    encodeVariant(input().resize({ width: variantWidth }), variantFormat),
                    `${variantWidth}.${fileExtension(variantFormat)}`,
                    variantFormat,
                  ),
                ),
              )),
            )
          }
          return { ok: true, image: { format, width, height, original, variants } }
        } catch {
          return { ok: false, reason: 'broken' }
        }
      })
    },
  }
}
