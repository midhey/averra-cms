import { zValidator } from '@hono/zod-validator'
import type { ValidationTargets } from 'hono'
import type { z } from 'zod'

/** Тело ответа 400: вход не прошёл проверку. issues — путь до поля и что не так */
export const validationError = (issues: { path: string; message: string }[]) => ({
  error: { code: 'validation', message: 'Данные не прошли проверку', issues },
})

/** Проверка входа Zod-схемой. При ошибке — 400 в едином формате, с путём до каждого кривого поля */
export const validate = <Target extends keyof ValidationTargets, Schema extends z.ZodType>(
  target: Target,
  schema: Schema,
) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const issues = result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      }))
      return c.json(validationError(issues), 400)
    }
  })
