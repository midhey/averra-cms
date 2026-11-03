import { randomInt } from 'node:crypto'
import type { Browser, BrowserContext } from '@playwright/test'
import { urls } from '../urls'
import { expect, sites } from './fixtures'
import { linkFrom, waitForMail } from './mailbox'

// Настоящие участники для e2e: владелец приглашает через API, человек регистрируется по ссылке
// из письма и входит в своём браузере. Свой «IP» у каждого браузера — для лимита входа

/** Чистый браузер без сессии владельца */
export const guestContext = (browser: Browser) =>
  browser.newContext({
    storageState: { cookies: [], origins: [] },
    baseURL: urls.admin,
    locale: 'ru-RU',
    extraHTTPHeaders: { 'x-forwarded-for': `10.30.${randomInt(256)}.${randomInt(1, 255)}` },
  })

/** Войти в этом браузере почтой и паролем (как форма входа, но без экрана) */
export async function signInContext(context: BrowserContext, email: string, password: string) {
  const res = await context.request.post(`${urls.admin}/api/auth/sign-in/email`, {
    data: { email, password },
    headers: { origin: urls.admin },
  })
  return res.status()
}

export type Person = {
  email: string
  password: string
  name: string
  id: string
  context: BrowserContext
}

/**
 * Новый участник сайта с ролью: приглашение, письмо, регистрация по ссылке и вход в своём
 * браузере. Закрыть браузер — забота теста (context.close в finally)
 */
export async function newMember(
  browser: Browser,
  site: { id: string; name: string },
  role: 'client' | 'editor',
  name = role === 'client' ? 'Анна Администратор' : 'Егор Редактор',
): Promise<Person> {
  const email = `${role}-${Date.now()}-${randomInt(1_000_000)}@e2e.test`
  const password = `e2e-password-${randomInt(1_000_000_000)}`
  const invited = await sites[':siteId'].invitations.$post({
    param: { siteId: site.id },
    json: { email, role },
  })
  expect(invited.status).toBe(201)
  const mail = await waitForMail(email, `Приглашение на сайт «${site.name}» в Averra CMS`)
  const token = decodeURIComponent(linkFrom(mail, 'invite').split('#token=')[1] ?? '')
  const context = await guestContext(browser)
  const registered = await context.request.post(`${urls.admin}/api/invitations/register`, {
    data: { token, name, password },
  })
  expect(registered.status(), await registered.text()).toBe(201)
  expect(await signInContext(context, email, password)).toBe(200)
  const members = await sites[':siteId'].members.$get({ param: { siteId: site.id } })
  if (members.status !== 200) throw new Error(`Участники: ${members.status}`)
  const found = (await members.json()).find((member) => member.email === email)
  if (!found) throw new Error(`Нет участника ${email}`)
  return { email, password, name, id: found.id, context }
}

/**
 * После теста: участника отключить от имени владельца e2e — в общей базе не копятся ни лишние
 * владельцы (им уходят служебные письма), ни действующие входы
 */
export async function disablePerson(siteId: string, person: Person) {
  await sites[':siteId'].members[':userId'].disable.$post({
    param: { siteId, userId: person.id },
  })
  await person.context.close()
}
