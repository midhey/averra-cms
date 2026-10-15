import { UserEmail } from '@averra/schema'
import { z } from 'zod'
import { NewUser, usersRepo } from '../modules/users/repo'
import { args, CliError, check, openDb, readNewPassword, run } from './common'

const usage = `Задать пользователю новый пароль (если почта не настроена или забыт пароль владельца):
  pnpm user:password --email anna@example.ru

Пароль спросит скрыто (дважды) или возьмёт из переменной CMS_USER_PASSWORD.
Все входы пользователя завершатся, ссылки сброса из писем перестанут работать.`

await run(async () => {
  const { email } = check(
    z.object({ email: UserEmail }),
    args({ email: { type: 'string' } }, usage),
    usage,
  )
  const { db, auth, config, close } = await openDb()
  try {
    const users = usersRepo(db, auth)
    // Пользователя ищем до вопроса о пароле: не заставлять вводить его зря
    const user = await users.findByEmail(email)
    if (!user) throw new CliError(`Нет пользователя ${email}`)
    const password = await readNewPassword('CMS_USER_PASSWORD')
    check(NewUser.pick({ password: true }), { password }, usage)
    await users.setPassword(user.id, password)
    console.log(
      `Пароль ${user.name} <${user.email}> изменён, все входы завершены. Вход: ${config.ADMIN_URL}/login`,
    )
  } finally {
    await close()
  }
})
