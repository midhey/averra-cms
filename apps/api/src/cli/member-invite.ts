import { MemberRole, UserEmail, Uuid } from '@averra/schema'
import { z } from 'zod'
import { createInvitation } from '../modules/invitations/service'
import { usersRepo } from '../modules/users/repo'
import { args, CliError, check, inviteLinkNotice, openDb, queuedMailTransport, run } from './common'

const usage = `Пригласить участника на сайт письмом:
  pnpm member:invite --email anna@example.ru --site <id сайта> --role editor|client [--by <почта владельца>]

Человек получит письмо со ссылкой (действует 7 дней) и сам задаст имя и пароль. Письмо уйдёт,
когда запустится API (pnpm dev или start). --by нужен, только если владельцев несколько.`

const Args = z.object({
  email: UserEmail,
  site: Uuid('Нужен id сайта'),
  role: MemberRole,
  by: UserEmail.optional(),
})

await run(async () => {
  const { email, site, role, by } = check(
    Args,
    args(
      {
        email: { type: 'string' },
        site: { type: 'string' },
        role: { type: 'string' },
        by: { type: 'string' },
      },
      usage,
    ),
    usage,
  )
  const { db, auth, config, close } = await openDb()
  try {
    // Как в API: без почты ссылку никто не получит. SMTP из админки — тоже почта
    const mail = await queuedMailTransport(db, config.mail)
    if (mail.transport === 'off') throw new CliError(mail.reason)
    // До записи в базу: ссылку на localhost по SMTP не отправляем вовсе
    const linkNotice = inviteLinkNotice(config.ADMIN_URL, mail.transport)

    const owners = await usersRepo(db, auth).owners()
    const inviter = by ? owners.find((owner) => owner.email === by) : owners[0]
    if (by && !inviter) throw new CliError(`${by} — не владелец: приглашает только владелец`)
    if (!by && owners.length > 1) {
      throw new CliError(`Владельцев несколько: укажи --by <почта>\n\n${usage}`)
    }
    if (!inviter) throw new CliError('Сначала создай владельца: pnpm user:create')

    const result = await createInvitation(db, {
      siteId: site,
      email,
      role,
      inviter,
      adminUrl: config.ADMIN_URL,
    })
    if (!result.ok) {
      if (result.problem === 'site_not_found') throw new CliError(`Нет сайта ${site}`)
      if (result.problem === 'owner') {
        throw new CliError(`${email} — владелец, ему и так открыты все сайты`)
      }
      throw new CliError(
        `${email} уже участник этого сайта (${result.role}). Сменить роль: pnpm member:add`,
      )
    }
    console.log(
      `Приглашение для ${email} (${role}) в очереди писем. Ссылка действует до ` +
        `${result.invitation.expiresAt.toLocaleString('ru-RU')}.`,
    )
    console.log(
      'Письмо уйдёт, когда запустится API. Прежнее приглашение этого адреса отозвано, если было.',
    )
    for (const line of linkNotice) console.log(line)
  } finally {
    await close()
  }
})
