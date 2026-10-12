import { z } from 'zod'

/**
 * Сообщения об ошибках схем по-русски: самые частые случаи — своими словами, остальное берёт
 * русская локаль Zod. Настройка глобальная для Zod, поэтому её включает каждый процесс при
 * старте — админка, API, команды терминала и MCP: одна схема — одно сообщение везде
 */
export function setupZodMessages() {
  z.config(z.locales.ru())
  z.config({
    customError: (issue) => {
      if (issue.code === 'too_small' && issue.origin === 'string' && issue.minimum === 1) {
        return 'Поле не может быть пустым'
      }
      if (issue.code === 'too_big' && issue.origin === 'string') {
        return `Не больше ${issue.maximum} символов`
      }
      if (issue.code === 'too_small' && issue.origin === 'array') {
        return `Минимум элементов: ${issue.minimum}`
      }
      if (issue.code === 'too_big' && issue.origin === 'array') {
        return `Максимум элементов: ${issue.maximum}`
      }
      return undefined
    },
  })
}
