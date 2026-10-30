import type { CustomBlockInstance, MediaMap } from '@averra/schema'
import { customBlockKeyOf } from '@averra/schema'
import { Section } from '../ui/Section'
import { CUSTOM_BLOCK_ROOT_ATTRIBUTE } from './marker'
import { CustomBlockRenderError } from './problems'
import { type CustomBlockMap, renderCustomBlockHtml } from './render'

type CustomBlockProps = {
  block: CustomBlockInstance
  definitions: CustomBlockMap
  media: MediaMap
  priority: boolean
  /**
   * Что делать с ошибкой (данные не подходят, шаблон упал). На сайте — сообщить сборке и не
   * выводить блок; в предпросмотре — показать причину на месте блока
   */
  onError?: ((blockId: string, message: string) => void) | undefined
  /** Предпросмотр в админке: вместо пустого места — причина, почему блока нет */
  preview?: boolean | undefined
  /** id блоков страницы: шаблон их не повторяет */
  pageIds?: readonly string[] | undefined
}

/**
 * Свой блок: тот же Section, что у встроенных (якорь, отступы, ширина), HTML — из шаблона Liquid
 * определения. Нет определения или ошибка — на сайте блока нет, остальные блоки на месте
 */
export function CustomBlock({
  block,
  definitions,
  media,
  priority,
  onError,
  preview,
  pageIds,
}: CustomBlockProps) {
  const key = customBlockKeyOf(block.type)
  const definition = definitions[key]
  let html: string | undefined
  let problem: string | undefined
  if (!definition) {
    problem = `Своего блока «${key}» нет на сайте: его не опубликовали или удалили`
  } else {
    try {
      html = renderCustomBlockHtml(definition, block.props, {
        id: block.id,
        media,
        priority,
        pageIds,
      })
    } catch (error) {
      if (!(error instanceof CustomBlockRenderError)) throw error
      problem = error.line ? `Строка ${error.line}: ${error.message}` : error.message
    }
  }
  if (problem !== undefined) {
    onError?.(block.id, problem)
    if (!preview) return null
    return (
      <Section id={block.id} customBlock={key}>
        <p role="alert">{problem}</p>
      </Section>
    )
  }
  return (
    <Section id={block.id} customBlock={key}>
      {/* HTML собран из дерева разбора после Liquid: опасное из него уже убрано (sanitizeHtml).
          Метка обёртки: «> .a» в CSS блока — верхние элементы шаблона */}
      <div
        {...{ [CUSTOM_BLOCK_ROOT_ATTRIBUTE]: '' }}
        dangerouslySetInnerHTML={{ __html: html ?? '' }}
      />
    </Section>
  )
}
