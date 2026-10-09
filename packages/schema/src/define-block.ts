import { z } from 'zod'

/** Id экземпляра блока на странице: по нему редактор находит и переставляет блоки */
export const BlockId = z
  .string()
  .regex(/^[\w-]{1,64}$/, 'Id блока: латиница, цифры, _ и -, не длиннее 64 символов')

/**
 * Описание блока. Схема props — единственный источник правды о блоке:
 * из неё получаются проверка в API, TS-типы, формы в админке и JSON Schema для MCP
 */
export function defineBlock<const Type extends string, Props extends z.ZodObject>(definition: {
  type: Type
  title: string
  props: Props
  /** Пример заполнения: с ним блок появляется в редакторе, его же видит нейронка в каталоге */
  example: z.input<Props>
}) {
  return {
    ...definition,
    /** Блок, поставленный на страницу: { id, type, props } */
    instance: z.strictObject({
      id: BlockId,
      type: z.literal(definition.type),
      props: definition.props,
    }),
  }
}
