import { z } from 'zod'

/**
 * Форма входа в админку. Длину пароля здесь не проверяем: её проверили при создании
 * пользователя, а при входе любое несовпадение — просто «неверная почта или пароль»
 */
export const SignIn = z.strictObject({
  email: z.string().trim().pipe(z.email('Нужна почта вида name@example.ru')),
  password: z.string().min(1, 'Введите пароль'),
})
export type SignIn = z.infer<typeof SignIn>
