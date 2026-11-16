import { open, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import {
  fileTooLargeMessage,
  MAX_SVG_BYTES,
  mediaMimeTypes,
  SVG_MIME_TYPE,
  svgTooLargeMessage,
} from '@averra/schema'
import { z } from 'zod'

// API задаёт MEDIA_MAX_BYTES окружением: локальный предел защищает память процесса MCP.
export const MCP_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const MCP_IMAGE_MAX_BASE64 = 4 * Math.ceil(MCP_IMAGE_MAX_BYTES / 3)

export const UploadImageInput = z
  .strictObject({
    path: z.string().min(1).optional().describe('Путь к локальному файлу картинки'),
    data: z
      .string()
      .min(1)
      .max(MCP_IMAGE_MAX_BASE64, fileTooLargeMessage(MCP_IMAGE_MAX_BYTES))
      .optional()
      .describe('Обычный base64, без префикса data:'),
    fileName: z.string().min(1).max(200).optional().describe('Имя файла с расширением для base64'),
  })
  .superRefine((input, ctx) => {
    const fromPath =
      input.path !== undefined && input.data === undefined && input.fileName === undefined
    const fromData =
      input.path === undefined && input.data !== undefined && input.fileName !== undefined
    if (!fromPath && !fromData) {
      ctx.addIssue({
        code: 'custom',
        message: 'Передайте ровно один источник: path или data вместе с fileName',
      })
    }
  })
export type UploadImageInput = z.input<typeof UploadImageInput>

const mimeOf = (name: string) => {
  const extension = extname(name).slice(1).toLowerCase()
  const format = extension === 'jpg' ? 'jpeg' : extension
  const found = Object.entries(mediaMimeTypes).find(([key]) => key === format)
  if (!found) throw new Error('Можно загрузить JPEG (.jpg, .jpeg), PNG, WebP, AVIF или SVG')
  return found[1]
}

export async function imageFile(raw: UploadImageInput): Promise<File> {
  const input = UploadImageInput.parse(raw)
  const name = basename(input.path ?? input.fileName ?? '')
  const type = mimeOf(name)
  const maxBytes = type === SVG_MIME_TYPE ? MAX_SVG_BYTES : MCP_IMAGE_MAX_BYTES
  const checkSize = (size: number) => {
    if (size > maxBytes) {
      throw new Error(type === SVG_MIME_TYPE ? svgTooLargeMessage() : fileTooLargeMessage(maxBytes))
    }
  }
  let data: Uint8Array<ArrayBuffer>
  if (input.path !== undefined) {
    try {
      const info = await stat(input.path)
      if (!info.isFile()) throw new Error('Путь должен указывать на обычный файл картинки')
      checkSize(info.size)
      const handle = await open(input.path, 'r')
      try {
        const current = await handle.stat()
        if (!current.isFile()) throw new Error('Путь должен указывать на обычный файл картинки')
        checkSize(current.size)
        // Читаем ограниченно даже при росте файла между stat и чтением.
        const buffer = new Uint8Array(current.size + 1)
        let length = 0
        while (length < buffer.length) {
          const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null)
          if (bytesRead === 0) break
          length += bytesRead
        }
        checkSize(length)
        if (length > current.size)
          throw new Error('Файл меняется во время чтения. Повторите загрузку')
        data = buffer.slice(0, length)
      } finally {
        await handle.close()
      }
    } catch (cause) {
      if (cause instanceof Error && 'code' in cause) {
        throw new Error('Не удалось прочитать локальный файл картинки: проверьте путь и доступ', {
          cause,
        })
      }
      throw cause
    }
  } else {
    const encoded = input.data ?? ''
    // Длину проверяем до декодирования: Buffer.from сам по себе принимает и слишком большой ввод.
    if (encoded.length > 4 * Math.ceil(maxBytes / 3)) checkSize(maxBytes + 1)
    const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
    if (
      encoded.length % 4 !== 0 ||
      /[^A-Za-z0-9+/=]/u.test(encoded) ||
      encoded.slice(0, encoded.length - padding).includes('=')
    ) {
      throw new Error('Нужен корректный base64 без префикса data: и пробелов')
    }
    checkSize((encoded.length / 4) * 3 - padding)
    data = new Uint8Array(Buffer.from(encoded, 'base64'))
  }
  return new File([data], name, { type })
}
