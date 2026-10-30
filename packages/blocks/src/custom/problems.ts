/**
 * Замечание к своему блоку: где (часть определения и строка) и что. error не даёт опубликовать
 * определение, warning — совет (конкретный цвет вместо роли темы, h1 в шаблоне)
 */
export type CustomBlockProblem = {
  part: 'template' | 'css' | 'example' | 'fields'
  level: 'error' | 'warning'
  message: string
  /** Строка в шаблоне или CSS, с 1 */
  line?: number | undefined
  /** Путь до поля примера или настройки поля: example.plans.0.name */
  path?: string | undefined
}

/** Ошибка рендера своего блока: блок не выводится, сайт собирается дальше */
export class CustomBlockRenderError extends Error {
  override name = 'CustomBlockRenderError'
  constructor(
    message: string,
    readonly line?: number,
  ) {
    super(message)
  }
}
