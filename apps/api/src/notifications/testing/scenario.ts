import { TEST_PASSWORD, type TestApi } from '../../testing'
import { type FakeTelegram, startFakeTelegram } from './fake-telegram'

// Общие шаги тестов уведомлений: сайт с формой, отправка заявки посетителем, бот Telegram на
// фейковом Bot API. Учебные данные — только для тестов

/** Токен бота для фейкового Bot API: формат как у @BotFather */
export const TEST_BOT_TOKEN = '7000001:AAFakeTokenForTestsOnly_abcdefghijklmnop'

type Headers = Record<string, string>

export const jsonHeaders = (headers: Headers) => ({
  ...headers,
  'content-type': 'application/json',
})

/** Новый сайт с опубликованной главной, на которой форма заявки (имя, телефон, почта) */
export async function siteWithForm(api: TestApi, headers: Headers, name = 'Ремонт') {
  const siteId = await api.createSite(name)
  const blocks = [
    {
      id: 'lead',
      type: 'form',
      props: {
        title: 'Оставьте заявку',
        fields: [
          { name: 'name', type: 'name', label: 'Имя', required: true },
          { name: 'phone', type: 'phone', label: 'Телефон', required: true },
          { name: 'email', type: 'email', label: 'Почта' },
          { name: 'comment', type: 'textarea', label: 'Комментарий' },
        ],
        policyUrl: '/privacy',
      },
    },
  ]
  const draft = await api.app.request(`/api/sites/${siteId}/pages/index`, {
    method: 'PUT',
    headers: jsonHeaders(headers),
    body: JSON.stringify({ title: 'Главная', content: { blocks } }),
  })
  if (draft.status !== 200) throw new Error(`Черновик не сохранился: ${await draft.text()}`)
  const published = await api.app.request(`/api/sites/${siteId}/pages/index/publish`, {
    method: 'POST',
    headers,
  })
  if (published.status !== 200) throw new Error(`Не опубликовалось: ${published.status}`)
  return siteId
}

let visitor = 0

/** Посетитель отправляет форму (JSON-ответ, свой IP — лимиты тестов большие) */
export function submitLead(api: TestApi, siteId: string, fields: Record<string, string> = {}) {
  visitor += 1
  return api.app.request(`/api/forms/${siteId}/index/lead`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
      origin: 'https://remont.example.ru',
      'x-forwarded-for': `10.9.0.${visitor % 250}`,
    },
    body: new URLSearchParams({
      name: 'Анна',
      phone: '+7 900 123-45-67',
      consent: 'yes',
      ...fields,
    }).toString(),
  })
}

/** Фейковый Bot API и тестовый API, который в него ходит */
export async function fakeTelegram() {
  return startFakeTelegram({ token: TEST_BOT_TOKEN, pollWaitMs: 50 })
}

/** Владелец задаёт бота (токен и прокси) своим паролем */
export function saveBot(
  api: TestApi,
  headers: Headers,
  body: { token?: string; proxy?: string; currentPassword?: string } = {},
) {
  return api.app.request('/api/notifications/telegram', {
    method: 'PUT',
    headers: jsonHeaders(headers),
    body: JSON.stringify({
      token: TEST_BOT_TOKEN,
      proxy: '',
      currentPassword: TEST_PASSWORD,
      ...body,
    }),
  })
}

/**
 * Привязать чат к аудитории: код из API, «Старт» в фейковом Telegram, опрос binder.
 * siteId — заявки сайта, без него — служебные
 */
export async function bindChat(
  api: TestApi,
  fake: FakeTelegram,
  headers: Headers,
  { siteId, chat = {} }: { siteId?: string; chat?: Parameters<FakeTelegram['pushStart']>[1] } = {},
) {
  const url = siteId
    ? `/api/sites/${siteId}/notifications/telegram/link`
    : '/api/notifications/service/telegram/link'
  const res = await api.app.request(url, { method: 'POST', headers })
  if (res.status !== 201)
    throw new Error(`Код привязки не выдан: ${res.status} ${await res.text()}`)
  const link = (await res.json()) as { id: string; code: string }
  const pushed = fake.pushStart(link.code, chat)
  await api.binder.pollOnce()
  return { link, chat: pushed }
}
