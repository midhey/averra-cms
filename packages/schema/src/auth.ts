import { z } from 'zod'
import { hasHeaderBreak } from './mail'

const EMAIL_MESSAGE = 'Нужна почта вида name@example.ru'

/**
 * Форма входа в админку. Длину пароля здесь не проверяем: её проверили при создании
 * пользователя, а при входе любое несовпадение — просто «неверная почта или пароль»
 */
export const SignIn = z.strictObject({
  email: z.string().trim().pipe(z.email(EMAIL_MESSAGE)),
  password: z.string().min(1, 'Введите пароль'),
})
export type SignIn = z.infer<typeof SignIn>

/**
 * Почта пользователя админки: без пробелов по краям и в нижнем регистре. Так она хранится
 * в users и в приглашениях, и так её сравнивают. До 254 символов — предел адреса в письме
 */
export const UserEmail = z
  .string()
  .trim()
  .pipe(z.email(EMAIL_MESSAGE).max(254))
  .transform((email) => email.toLowerCase())

/**
 * Имя пользователя: его видно в шапке админки и в письмах («Здравствуйте, …»).
 * Одна строка: перевод строки в имени сломал бы тему и текст письма
 */
export const UserName = z
  .string()
  .refine((name) => !hasHeaderBreak(name), 'Имя — одной строкой, без переводов строки')
  .trim()
  .pipe(z.string().min(1, 'Введите имя').max(80))

/** Длина пароля — одна для API, команд, форм админки и владельца для разработки */
export const PASSWORD_LENGTH = { min: 10, max: 128 } as const

/** Новый пароль: при создании пользователя, сбросе и принятии приглашения */
export const NewPassword = z
  .string()
  .min(PASSWORD_LENGTH.min, `Пароль — от ${PASSWORD_LENGTH.min} символов`)
  .max(PASSWORD_LENGTH.max, `Пароль — до ${PASSWORD_LENGTH.max} символов`)

/** Роль участника на сайте: editor правит и публикует, client только правит черновики */
export const MemberRole = z.enum(['editor', 'client'], 'Роль на сайте — editor или client')
export type MemberRole = z.infer<typeof MemberRole>

/** «Забыли пароль?»: только почта. Куда вести после сброса, решает API, а не запрос */
export const ForgotPassword = z.strictObject({ email: UserEmail })
export type ForgotPassword = z.input<typeof ForgotPassword>

/**
 * Токен из ссылки сброса пароля: Better Auth выдаёт 24 латинские буквы и цифры. API проверяет
 * формат до Better Auth: всё прочее (в том числе хеш из базы) до поиска записи не доходит
 */
export const ResetPasswordToken = z
  .string()
  .regex(/^[A-Za-z0-9]{24}$/, 'Ссылка повреждена: откройте её из письма целиком')

/** Новый пароль по ссылке из письма */
export const ResetPassword = z.strictObject({
  token: ResetPasswordToken,
  newPassword: NewPassword,
})
export type ResetPassword = z.infer<typeof ResetPassword>

/** Пригласить участника на сайт */
export const NewInvitation = z.strictObject({ email: UserEmail, role: MemberRole })
export type NewInvitation = z.input<typeof NewInvitation>

/**
 * Токен приглашения из ссылки: inv_<id приглашения>_<секрет, 64 hex>. По id API находит
 * строку, секрет сверяет с хешем. Кривой формат — ссылку повредили при копировании
 */
export const InvitationToken = z
  .string()
  .trim()
  .regex(
    /^inv_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[0-9a-f]{64}$/,
    'Ссылка приглашения повреждена: откройте её из письма целиком',
  )

/** Что за приглашение — экран принятия спрашивает до формы */
export const InvitationLookup = z.strictObject({ token: InvitationToken })

/** Принять приглашение новым пользователем: имя и пароль задаёт он сам */
export const InvitationRegister = z.strictObject({
  token: InvitationToken,
  name: UserName,
  password: NewPassword,
})
export type InvitationRegister = z.infer<typeof InvitationRegister>

/** Принять приглашение тем, под кем вошёл */
export const InvitationAccept = z.strictObject({ token: InvitationToken })
