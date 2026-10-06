import { zValidator } from '@hono/zod-validator'
import type { ValidationTargets } from 'hono'
import type { z } from 'zod'

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
      return c.json(
        { error: { code: 'validation', message: 'Данные не прошли проверку', issues } },
        400,
      )
    }
  })
