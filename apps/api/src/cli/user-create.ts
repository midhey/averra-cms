import { NewUser, usersRepo } from '../modules/users/repo'
import { args, CliError, check, openDb, readNewPassword, run } from './common'

const usage = `Создать пользователя админки:
  pnpm user:create --email anna@example.ru --name "Анна" [--role owner|member] [--if-missing]

Пароль спросит скрыто (дважды) или возьмёт из переменной CMS_USER_PASSWORD.
owner (по умолчанию) — вся админка; member — только сайты, к которым дан доступ (pnpm member:add).
--if-missing — если пользователь с этой почтой уже есть, ничего не делать и выйти без ошибки
(пароль не спрашивается): так установщик (deploy/install.sh) можно запускать повторно.`

await run(async () => {
  const values = args(
    {
      email: { type: 'string' },
      name: { type: 'string' },
      role: { type: 'string' },
      'if-missing': { type: 'boolean' },
    },
    usage,
  )
  // Почту, имя и роль проверяем до вопроса о пароле: не заставлять вводить его зря
  const { email, name, role } = check(
    NewUser.omit({ password: true }),
    { email: values.email, name: values.name, role: values.role },
    usage,
  )
  const { db, auth, config, close } = await openDb()
  try {
    const users = usersRepo(db, auth)
    // Есть ли он — до вопроса о пароле: пароль для пользователя, которого не создадут, не нужен
    if (values['if-missing'] && (await users.findByEmail(email))) {
      console.log(`Пользователь ${email} уже есть — ничего не меняю`)
      return
    }
    const password = await readNewPassword('CMS_USER_PASSWORD')
    check(NewUser.pick({ password: true }), { password }, usage)
    const user = await users.create({ email, name, role, password })
    if (!user) throw new CliError(`Пользователь с почтой ${email} уже есть`)
    const who = user.role === 'owner' ? 'владелец' : 'участник'
    console.log(`Создан ${who} ${user.name} <${user.email}>. Вход: ${config.ADMIN_URL}/login`)
    if (user.role === 'member') {
      console.log(`Дай доступ к сайту: pnpm member:add --email ${user.email} --role editor|client`)
    }
  } finally {
    await close()
  }
})
