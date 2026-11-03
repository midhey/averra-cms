import { NewPassword, UserName } from '@averra/schema'
import { z } from 'zod'

// Новый пароль дважды: при сбросе и при принятии приглашения. Длину проверяет общая схема
// NewPassword (та же, что в API), совпадение — здесь: в API второй экземпляр не уходит

const passwordFields = { password: NewPassword, repeat: z.string() }

const samePasswords = (value: { password: string; repeat: string }) =>
  value.password === value.repeat
const mismatch = { path: ['repeat'], message: 'Пароли не совпадают' }

/** Новый пароль по ссылке сброса */
export const NewPasswordForm = z.object(passwordFields).refine(samePasswords, mismatch)

/** Смена своего пароля в профиле: текущий и новый дважды */
export const ChangePasswordForm = z
  .object({ currentPassword: z.string().min(1, 'Введите текущий пароль'), ...passwordFields })
  .refine(samePasswords, mismatch)

/** Новый пользователь по приглашению: имя и пароль */
export const InvitedUserForm = z
  .object({ name: UserName, ...passwordFields })
  .refine(samePasswords, mismatch)
