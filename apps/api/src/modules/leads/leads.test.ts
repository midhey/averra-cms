import { FORM_MAX_FIELDS, form } from '@averra/schema'
import { and, eq, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { leads, mailOutbox, sites } from '../../db/schema'
import { memoryMailer } from '../../mail/memory-mailer'
import { createTestApi, sendQueue, type TestApi } from '../../testing'
import { LEAD_BODY_LIMIT } from './public-routes'
import { leadsRepo } from './repo'

// Заявки с форм: открытый приём по опубликованной версии, антиспам, письма через очередь
// в той же транзакции и раздел «Заявки» в админке. Всё — настоящими запросами, как их шлёт
// браузер посетителя (urlencoded-форма без JS) и админка

const mailer = memoryMailer()
const api = await createTestApi({ mail: mailer })
afterAll(api.close)

type Headers = Record<string, string>
const json = (headers: Headers) => ({ ...headers, 'content-type': 'application/json' })

const owner = await api.loginAs('owner')

const SITE_ORIGIN = 'https://remont.example.ru'

/** Поля формы для тестов: имя и телефон обязательны, почта и комментарий — нет */
const formProps = {
  title: 'Оставьте заявку',
  fields: [
    { name: 'name', type: 'name', label: 'Имя', required: true },
    { name: 'phone', type: 'phone', label: 'Телефон', required: true },
    { name: 'email', type: 'email', label: 'Почта' },
    { name: 'comment', type: 'textarea', label: 'Комментарий' },
    {
      name: 'service',
      type: 'select',
      label: 'Услуга',
      options: [{ label: 'Ремонт' }, { label: 'Дизайн' }],
    },
    { name: 'call_me', type: 'checkbox', label: 'Перезвоните мне' },
  ],
  policyUrl: '/privacy',
}

const formBlock = (props: Record<string, unknown> = formProps) => ({
  id: 'lead',
  type: 'form',
  props,
})

let siteCount = 0

/** Новый сайт владельца с опубликованной главной, на которой стоит форма */
async function siteWithForm(testApi: TestApi = api, headers: Headers = owner.headers) {
  siteCount += 1
  const created = await testApi.app.request('/api/sites', {
    method: 'POST',
    headers: json(headers),
    body: JSON.stringify({ name: `Ремонт ${siteCount}` }),
  })
  if (created.status !== 201) throw new Error(`Сайт не создался: ${created.status}`)
  const { id } = (await created.json()) as { id: string }
  await saveDraft(testApi, id, [formBlock()], headers)
  await publish(testApi, id, headers)
  return id
}

async function saveDraft(
  testApi: TestApi,
  siteId: string,
  blocks: unknown[],
  headers: Headers = owner.headers,
  slug = 'index',
) {
  const res = await testApi.app.request(`/api/sites/${siteId}/pages/${slug}`, {
    method: 'PUT',
    headers: json(headers),
    body: JSON.stringify({ title: 'Главная', content: { blocks } }),
  })
  if (res.status !== 200)
    throw new Error(`Черновик не сохранился: ${res.status} ${await res.text()}`)
}

async function publish(
  testApi: TestApi,
  siteId: string,
  headers: Headers = owner.headers,
  slug = 'index',
) {
  const res = await testApi.app.request(`/api/sites/${siteId}/pages/${slug}/publish`, {
    method: 'POST',
    headers,
  })
  if (res.status !== 200) throw new Error(`Не опубликовалось: ${res.status}`)
}

let visitorCount = 0
const freshEmail = () => `visitor-${++visitorCount}@example.ru`

const validFields = (overrides: Record<string, string> = {}) => ({
  name: 'Анна',
  phone: '+7 900 123-45-67',
  consent: 'yes',
  ...overrides,
})

type SubmitOptions = {
  testApi?: TestApi
  headers?: Headers
  slug?: string
  blockId?: string
}

/**
 * Отправка формы так, как её шлёт браузер: urlencoded и Origin сайта. Referer — как по умолчанию
 * (strict-origin-when-cross-origin): в чужой источник (API) только «https://сайт/», без пути
 */
function submit(siteId: string, fields: Record<string, string>, options: SubmitOptions = {}) {
  const { testApi = api, headers = {}, slug = 'index', blockId = 'lead' } = options
  return testApi.app.request(`/api/forms/${siteId}/${slug}/${blockId}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'text/html,application/xhtml+xml',
      origin: SITE_ORIGIN,
      referer: `${SITE_ORIGIN}/`,
      ...headers,
    },
    body: new URLSearchParams(fields).toString(),
  })
}

async function leadsOf(testApi: TestApi, siteId: string) {
  return testApi.db.select().from(leads).where(eq(leads.siteId, siteId))
}

async function outboxOf(testApi: TestApi, siteId: string) {
  return testApi.db
    .select({
      template: mailOutbox.template,
      recipient: mailOutbox.recipient,
      data: mailOutbox.data,
      createdAt: mailOutbox.createdAt,
    })
    .from(mailOutbox)
    .where(eq(mailOutbox.siteId, siteId))
}

/** Отправить всю очередь: почта в памяти */
const sendAll = (testApi: TestApi = api) => sendQueue(testApi)

const leadsUrl = (siteId: string) => `/api/sites/${siteId}/leads`

describe('приём заявки', () => {
  it('принимает форму и возвращает на страницу с якорем успеха (303)', async () => {
    const siteId = await siteWithForm()
    const res = await submit(siteId, validFields({ comment: 'Нужен\r\nремонт', call_me: 'yes' }))
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(`${SITE_ORIGIN}/#lead-sent`)

    const [lead] = await leadsOf(api, siteId)
    expect(lead).toMatchObject({
      pageSlug: 'index',
      blockId: 'lead',
      formTitle: 'Оставьте заявку',
      status: 'new',
      consentText: 'Я согласен на обработку персональных данных',
      consentPolicyUrl: '/privacy',
      pageVersion: 1,
    })
    expect(lead?.consentedAt).toBeInstanceOf(Date)
    expect(lead?.data).toEqual([
      { name: 'name', label: 'Имя', type: 'name', value: 'Анна' },
      { name: 'phone', label: 'Телефон', type: 'phone', value: '+7 900 123-45-67' },
      { name: 'email', label: 'Почта', type: 'email', value: '' },
      { name: 'comment', label: 'Комментарий', type: 'textarea', value: 'Нужен\nремонт' },
      { name: 'service', label: 'Услуга', type: 'select', value: '' },
      { name: 'call_me', label: 'Перезвоните мне', type: 'checkbox', value: true },
    ])
  })

  it('с неглавной страницы — обратно на неё: путь из адреса приёма, а не из Referer', async () => {
    const siteId = await siteWithForm()
    await saveDraft(api, siteId, [formBlock()], owner.headers, 'o-nas')
    await publish(api, siteId, owner.headers, 'o-nas')
    const fromPage = (referer: string, fields = validFields()) =>
      submit(siteId, fields, { slug: 'o-nas', headers: { referer } })

    // Настоящие заголовки браузера: Referer без пути — всё равно страница «о нас», не главная
    const real = await fromPage(`${SITE_ORIGIN}/`)
    expect(real.status).toBe(303)
    expect(real.headers.get('location')).toBe(`${SITE_ORIGIN}/o-nas#lead-sent`)
    // Без Referer — так же
    expect((await fromPage('')).headers.get('location')).toBe(`${SITE_ORIGIN}/o-nas#lead-sent`)
    // Полный Referer этой страницы (политика сайта мягче) — её точный вид со слешем или .html
    expect((await fromPage(`${SITE_ORIGIN}/o-nas/?utm=1`)).headers.get('location')).toBe(
      `${SITE_ORIGIN}/o-nas/#lead-sent`,
    )
    expect((await fromPage(`${SITE_ORIGIN}/o-nas.html`)).headers.get('location')).toBe(
      `${SITE_ORIGIN}/o-nas.html#lead-sent`,
    )
    // Referer другой страницы того же сайта не уводит с этой
    expect((await fromPage(`${SITE_ORIGIN}/kontakty`)).headers.get('location')).toBe(
      `${SITE_ORIGIN}/o-nas#lead-sent`,
    )
    // Ссылка «назад» со страницы ошибки — тоже на эту страницу
    const bad = await fromPage(`${SITE_ORIGIN}/`, validFields({ phone: '12' }))
    expect(bad.status).toBe(400)
    expect(await bad.text()).toContain(`href="${SITE_ORIGIN}/o-nas#lead"`)
  })

  it('Referer чужого источника не берём; без Origin и Referer — своя страница «Заявка отправлена»', async () => {
    const siteId = await siteWithForm()
    // Возвращаем туда, откуда пришла форма (Origin), а не на чужой Referer
    const foreign = await submit(siteId, validFields(), {
      headers: { referer: 'https://evil.example/page' },
    })
    expect(foreign.headers.get('location')).toBe(`${SITE_ORIGIN}/#lead-sent`)

    const blind = await submit(siteId, validFields(), {
      headers: { origin: 'null', referer: '' },
    })
    expect(blind.status).toBe(200)
    expect(blind.headers.get('content-type')).toContain('text/html')
    expect(blind.headers.get('content-security-policy')).toContain("default-src 'none'")
    const page = await blind.text()
    expect(page).toContain('Заявка отправлена')
    expect(page).toContain('Спасибо! Заявка отправлена, мы скоро свяжемся с вами.')
    expect(await leadsOf(api, siteId)).toHaveLength(2)
  })

  it('скрипту, который просит JSON, — JSON', async () => {
    const siteId = await siteWithForm()
    const res = await submit(siteId, validFields(), { headers: { accept: 'application/json' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'accepted' })
    const bad = await submit(siteId, validFields({ phone: '' }), {
      headers: { accept: 'application/json' },
    })
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({
      error: {
        code: 'validation',
        issues: [{ path: 'phone', message: 'Телефон — Заполните поле' }],
      },
    })
  })

  it('проверяет по опубликованной версии: черновик на приём не влияет', async () => {
    const siteId = await siteWithForm()
    // В черновике — новое обязательное поле и другая подпись. Не опубликовано — не действует
    const draftProps = {
      ...formProps,
      fields: [
        { name: 'name', type: 'name', label: 'Как вас зовут', required: true },
        { name: 'city', type: 'text', label: 'Город', required: true },
      ],
    }
    await saveDraft(api, siteId, [formBlock(draftProps)])
    const res = await submit(siteId, validFields({ city: 'Москва' }))
    expect(res.status).toBe(303)
    const [lead] = await leadsOf(api, siteId)
    expect(lead?.data.map((field) => field.name)).toEqual([
      'name',
      'phone',
      'email',
      'comment',
      'service',
      'call_me',
    ])
    expect(lead?.data[0]?.label).toBe('Имя')

    // Опубликовали — теперь действует новая форма
    await publish(api, siteId)
    const old = await submit(siteId, validFields(), { headers: { accept: 'application/json' } })
    expect(old.status).toBe(400)
    expect(await old.json()).toMatchObject({ error: { issues: [{ path: 'city' }] } })
  })

  it('нет формы на опубликованном сайте — 404', async () => {
    const siteId = await siteWithForm()
    // Страница только в черновике
    await saveDraft(api, siteId, [formBlock()], owner.headers, 'draft-only')
    const cases: [string, SubmitOptions][] = [
      ['неопубликованная страница', { slug: 'draft-only' }],
      ['нет такого блока', { blockId: 'other' }],
      ['кривой адрес', { slug: 'Кривой' }],
    ]
    for (const [what, options] of cases) {
      const res = await submit(siteId, validFields(), options)
      expect(res.status, what).toBe(404)
      expect(await res.text(), what).toContain('Форма не найдена')
    }
    // Блок с таким id есть, но это не форма
    await saveDraft(api, siteId, [
      { id: 'lead', type: 'cta', props: { title: 'Звоните', button: { label: 'Да', href: '#' } } },
    ])
    await publish(api, siteId)
    expect((await submit(siteId, validFields())).status).toBe(404)
    expect((await submit(crypto.randomUUID(), validFields())).status).toBe(404)
    expect(await leadsOf(api, siteId)).toEqual([])
  })

  it('ошибки — понятная страница с подписями полей и ссылкой назад', async () => {
    const siteId = await siteWithForm()
    const res = await submit(siteId, { name: 'Анна', phone: '12' })
    expect(res.status).toBe(400)
    expect(res.headers.get('content-type')).toContain('text/html')
    const page = await res.text()
    expect(page).toContain('Заявка не отправлена')
    expect(page).toContain('Телефон — Телефон: цифры, +, пробелы, скобки и дефис, не меньше 5 цифр')
    expect(page).toContain(
      'Согласие на обработку персональных данных — Нужно согласие на обработку персональных данных',
    )
    expect(page).toContain(`href="${SITE_ORIGIN}/#lead"`)
    expect(page).not.toContain('<script')
    expect(await leadsOf(api, siteId)).toEqual([])
  })

  it('перевод строки в однострочном поле — 400, в многострочном — можно', async () => {
    const siteId = await siteWithForm()
    for (const field of ['name', 'phone', 'email', 'service']) {
      const value = field === 'phone' ? '+7 900\r\n1234567' : 'a@b.ru\r\nBcc: x@evil.ru'
      const res = await submit(siteId, validFields({ [field]: value }))
      expect(res.status, field).toBe(400)
      expect(await res.text(), field).toContain('Без переводов строки')
    }
    expect((await submit(siteId, validFields({ comment: 'а\nб\r\nв' }))).status).toBe(303)
    expect(await leadsOf(api, siteId)).toHaveLength(1)
  })

  it('без согласия — 400, заявки нет', async () => {
    const siteId = await siteWithForm()
    const { consent: _, ...withoutConsent } = validFields()
    expect((await submit(siteId, withoutConsent)).status).toBe(400)
    expect(await leadsOf(api, siteId)).toEqual([])
  })

  it('неизвестные поля отбрасываются: в заявке только поля формы', async () => {
    const siteId = await siteWithForm()
    const res = await submit(siteId, validFields({ admin: 'true', password: 'secret' }))
    expect(res.status).toBe(303)
    const [lead] = await leadsOf(api, siteId)
    expect(JSON.stringify(lead?.data)).not.toContain('secret')
    expect(lead?.data.map((field) => field.name)).not.toContain('admin')
  })

  it('только application/x-www-form-urlencoded', async () => {
    const siteId = await siteWithForm()
    const res = await api.app.request(`/api/forms/${siteId}/index/lead`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: SITE_ORIGIN },
      body: JSON.stringify(validFields()),
    })
    expect(res.status).toBe(415)
  })

  it('тело больше предела — 413, заявки нет; честная форма до maxlength проходит', async () => {
    const siteId = await siteWithForm()
    const res = await submit(siteId, validFields({ comment: 'ж'.repeat(50_000) }))
    expect(res.status).toBe(413)
    expect(await res.text()).toContain('Слишком длинная заявка')
    expect(await leadsOf(api, siteId)).toEqual([])

    // Худший честный случай: все поля многострочные и заполнены до maxlength символами,
    // которые urlencoded раздувает сильнее всего (… — 9 байт). Это не 413
    const fields = Array.from({ length: FORM_MAX_FIELDS }, (_, index) => ({
      name: `long_${index}`,
      type: 'textarea',
      label: `Поле ${index}`,
    }))
    await saveDraft(api, siteId, [formBlock({ ...formProps, fields })])
    await publish(api, siteId)
    const full = Object.fromEntries(fields.map((field) => [field.name, '…'.repeat(2000)]))
    const body = new URLSearchParams({ ...full, consent: 'yes' }).toString()
    expect(body.length).toBeGreaterThan(200_000)
    expect(body.length).toBeLessThanOrEqual(LEAD_BODY_LIMIT)
    expect((await submit(siteId, { ...full, consent: 'yes' })).status).toBe(303)
  })

  it('управляющие символы в многострочном поле — 400, а не ошибка сервера', async () => {
    const siteId = await siteWithForm()
    for (const value of ['a\u0000b', 'a\u0007b', 'a\u001bb']) {
      const res = await submit(siteId, validFields({ comment: value }))
      expect(res.status, JSON.stringify(value)).toBe(400)
      expect(await res.text()).toContain('Комментарий — Без управляющих символов')
    }
    // Табуляция и переводы строки — можно
    expect((await submit(siteId, validFields({ comment: 'а\tб\r\nв' }))).status).toBe(303)
    expect(await leadsOf(api, siteId)).toHaveLength(1)
  })

  it('поле с ключом constructor работает: тело разбирается без прототипа Object', async () => {
    const siteId = await siteWithForm()
    const fields = [
      { name: 'constructor', type: 'text', label: 'Компания', required: true },
      { name: 'tostring', type: 'text', label: 'Город' },
    ]
    await saveDraft(api, siteId, [formBlock({ ...formProps, fields })])
    await publish(api, siteId)
    const res = await submit(siteId, { constructor: 'ООО Ромашка', consent: 'yes' })
    expect(res.status).toBe(303)
    const [lead] = await leadsOf(api, siteId)
    expect(lead?.data).toEqual([
      { name: 'constructor', label: 'Компания', type: 'text', value: 'ООО Ромашка' },
      { name: 'tostring', label: 'Город', type: 'text', value: '' },
    ])
    // Не заполнено обязательное constructor — обычная ошибка «Заполните поле»
    const empty = await submit(
      siteId,
      { consent: 'yes' },
      { headers: { accept: 'application/json' } },
    )
    expect(await empty.json()).toMatchObject({
      error: { issues: [{ path: 'constructor', message: 'Компания — Заполните поле' }] },
    })
  })

  it('почта на кириллическом домене и в punycode принимается, как и в браузере', async () => {
    const siteId = await siteWithForm()
    for (const email of ['anna@пример.рф', 'anna@xn--e1afmkfd.xn--p1ai']) {
      expect((await submit(siteId, validFields({ email }))).status, email).toBe(303)
    }
    for (const email of ['a..b@example.ru', 'anna@example.r', 'a!b@example.ru']) {
      expect((await submit(siteId, validFields({ email }))).status, email).toBe(400)
    }
    const replyTo = (await outboxOf(api, siteId))
      .filter((mail) => mail.template === 'lead-new')
      .map((mail) => (mail.data as { replyTo?: string }).replyTo)
    expect(replyTo).toContain('anna@пример.рф')
    await sendAll()
    expect(mailer.sent.some((mail) => mail.to === 'anna@пример.рф')).toBe(true)
  })
})

describe('антиспам', () => {
  it('ловушка: ответ как при успехе, но заявки и писем нет', async () => {
    const siteId = await siteWithForm()
    const res = await submit(
      siteId,
      validFields({ website: 'https://spam.example', email: freshEmail() }),
    )
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(`${SITE_ORIGIN}/#lead-sent`)
    expect(await leadsOf(api, siteId)).toEqual([])
    expect(await outboxOf(api, siteId)).toEqual([])
  })

  it('лимит по IP — на все отправки, лимит сайта — только на сохраняемые заявки', async () => {
    const limited = await createTestApi({
      leadLimits: {
        perIp: { max: 2, windowMs: 60_000 },
        perSite: { max: 2, windowMs: 60_000 },
      },
    })
    try {
      const limitedOwner = await limited.loginAs('owner')
      const siteId = await siteWithForm(limited, limitedOwner.headers)
      const from = (ip: string) => ({ testApi: limited, headers: { 'x-forwarded-for': ip } })
      // Ловушка и неверная форма тратят лимит своего IP…
      expect((await submit(siteId, validFields({ website: 'x' }), from('10.0.0.1'))).status).toBe(
        303,
      )
      expect((await submit(siteId, { name: 'Анна' }, from('10.0.0.1'))).status).toBe(400)
      const blocked = await submit(siteId, validFields(), from('10.0.0.1'))
      expect(blocked.status).toBe(429)
      expect(blocked.headers.get('retry-after')).not.toBeNull()
      expect(await blocked.text()).toContain('Слишком много заявок')

      // …но не лимит сайта: бот с многих IP, который заполняет ловушку, не выбьет его
      // у настоящих посетителей
      for (let ip = 10; ip < 20; ip += 1) {
        const res = await submit(siteId, validFields({ website: 'x' }), from(`10.0.1.${ip}`))
        expect(res.status).toBe(303)
      }
      expect((await submit(siteId, validFields(), from('10.0.0.2'))).status).toBe(303)
      expect((await submit(siteId, validFields(), from('10.0.0.3'))).status).toBe(303)
      // Лимит сайта (2 за окно) кончился на сохранённых заявках
      expect((await submit(siteId, validFields(), from('10.0.0.4'))).status).toBe(429)
      expect(await leadsOf(limited, siteId)).toHaveLength(2)
    } finally {
      await limited.close()
    }
  })
})

describe('письма о заявке', () => {
  it('владельцам: все поля экранированы, Reply-To посетителя, тема без его ввода', async () => {
    const siteId = await siteWithForm()
    const email = freshEmail()
    await submit(
      siteId,
      validFields({ name: '<script>alert(1)</script>', email, comment: 'Строка 1\nСтрока 2' }),
    )
    const queued = (await outboxOf(api, siteId)).filter((mail) => mail.template === 'lead-new')
    // По умолчанию — всем владельцам админки
    expect(queued.map((mail) => mail.recipient)).toContain(owner.user.email)

    await sendAll()
    const sent = mailer.sent.find((mail) => mail.to === owner.user.email && mail.replyTo === email)
    expect(sent?.subject).toMatch(/^Новая заявка с сайта «Ремонт \d+»$/)
    expect(sent?.html).not.toContain('<script>')
    expect(sent?.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(sent?.text).toContain('Комментарий: Строка 1\n  Строка 2')
    expect(sent?.text).toContain(`/sites/${siteId}/leads/`)
  })

  it('адреса уведомлений из настроек сайта вместо владельцев', async () => {
    const siteId = await siteWithForm()
    const settings = await api.app.request(`${leadsUrl(siteId)}/settings`, {
      method: 'PUT',
      headers: json(owner.headers),
      body: JSON.stringify({
        recipients: ['Manager@Example.ru', 'boss@example.ru'],
        retentionDays: 90,
        confirmToVisitor: true,
      }),
    })
    expect(settings.status).toBe(200)
    await submit(siteId, validFields())
    const recipients = (await outboxOf(api, siteId))
      .filter((mail) => mail.template === 'lead-new')
      .map((mail) => mail.recipient)
      .sort()
    expect(recipients).toEqual(['boss@example.ru', 'manager@example.ru'])
  })

  it('смена адресов уведомлений: письмо владельцам и прежним адресам; без смены — нет', async () => {
    const siteId = await siteWithForm()
    const client = await api.loginAs('client', siteId)
    const put = (headers: Headers, recipients: string[]) =>
      api.app.request(`${leadsUrl(siteId)}/settings`, {
        method: 'PUT',
        headers: json(headers),
        body: JSON.stringify({ recipients, retentionDays: 180, confirmToVisitor: true }),
      })
    const notices = async () =>
      (await outboxOf(api, siteId)).filter((mail) => mail.template === 'lead-recipients-changed')

    expect((await put(owner.headers, ['old@example.ru'])).status).toBe(200)
    expect((await notices()).map((mail) => mail.recipient)).toContain(owner.user.email)
    const before = (await notices()).length

    // Клиент перенаправляет заявки: узнают владельцы и прежний адрес
    expect((await put(client.headers, ['new@example.ru'])).status).toBe(200)
    const after = (await notices()).slice(before)
    expect(after.map((mail) => mail.recipient)).toEqual(
      expect.arrayContaining([owner.user.email, 'old@example.ru']),
    )
    expect(after.map((mail) => mail.recipient)).not.toContain('new@example.ru')
    expect(after[0]?.data).toMatchObject({
      changedByEmail: client.user.email,
      recipients: ['new@example.ru'],
    })

    // Те же адреса (в другом регистре) — писем нет
    const count = (await notices()).length
    expect((await put(client.headers, ['NEW@example.ru'])).status).toBe(200)
    expect(await notices()).toHaveLength(count)

    await sendAll()
    const mail = mailer.sent.find(
      (sent) => sent.to === 'old@example.ru' && sent.subject.startsWith('Адреса уведомлений'),
    )
    expect(mail?.text).toContain('Теперь заявки приходят: new@example.ru')
  })

  it('подтверждение посетителю: фиксированный текст, раз в сутки на адрес и сайт', async () => {
    const siteId = await siteWithForm()
    const email = freshEmail()
    await submit(siteId, validFields({ name: 'Купите слонов: spam.example', email }))
    await submit(siteId, validFields({ email: email.toUpperCase() }))
    const confirmations = (await outboxOf(api, siteId)).filter(
      (mail) => mail.template === 'lead-received',
    )
    expect(confirmations).toHaveLength(1)
    // В данных письма — только название сайта
    expect(confirmations[0]?.data).toEqual({ siteName: expect.stringMatching(/^Ремонт \d+$/) })

    await sendAll()
    const mail = mailer.sent.find((sent) => sent.to === email)
    expect(mail?.subject).toMatch(/^Заявка получена — Ремонт \d+$/)
    expect(`${mail?.text}${mail?.html}`).not.toContain('слонов')
    expect(mail?.replyTo).toBeUndefined()

    // Сутки прошли — снова можно. Двигаем время постановки прежнего письма назад
    await api.db
      .update(mailOutbox)
      .set({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(and(eq(mailOutbox.siteId, siteId), eq(mailOutbox.template, 'lead-received')))
    await submit(siteId, validFields({ email }))
    const again = (await outboxOf(api, siteId)).filter((row) => row.template === 'lead-received')
    expect(again).toHaveLength(2)
  })

  it('подтверждения нет без почты, при выключенном подтверждении и тому же адресу с другого сайта — есть', async () => {
    const siteId = await siteWithForm()
    await submit(siteId, validFields())
    expect((await outboxOf(api, siteId)).some((mail) => mail.template === 'lead-received')).toBe(
      false,
    )

    const quiet = await siteWithForm()
    await api.db.update(sites).set({ leadConfirmation: false }).where(eq(sites.id, quiet))
    const email = freshEmail()
    await submit(quiet, validFields({ email }))
    expect((await outboxOf(api, quiet)).map((mail) => mail.template)).not.toContain('lead-received')

    const other = await siteWithForm()
    await submit(other, validFields({ email }))
    expect((await outboxOf(api, other)).map((mail) => mail.template)).toContain('lead-received')
  })

  it('почта выключена: заявка сохраняется, писем нет, раздел говорит об этом', async () => {
    const off = await createTestApi({ mail: 'off' })
    try {
      const offOwner = await off.loginAs('owner')
      const siteId = await siteWithForm(off, offOwner.headers)
      const res = await submit(siteId, validFields({ email: freshEmail() }), { testApi: off })
      expect(res.status).toBe(303)
      expect(await leadsOf(off, siteId)).toHaveLength(1)
      expect(await outboxOf(off, siteId)).toEqual([])
      const list = await off.app.request(leadsUrl(siteId), { headers: offOwner.headers })
      expect(await list.json()).toMatchObject({
        notifications: {
          enabled: false,
          reason: 'Почта не настроена (тест)',
          recipients: 'owners',
        },
      })
    } finally {
      await off.close()
    }
  })

  it('одна транзакция: не записалось письмо — нет и заявки', async () => {
    const broken = await createTestApi()
    try {
      const brokenOwner = await broken.loginAs('owner')
      const siteId = await siteWithForm(broken, brokenOwner.headers)
      await broken.db.execute(sql`CREATE FUNCTION fail_outbox() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'очередь писем сломана (тест)'; END $$ LANGUAGE plpgsql`)
      await broken.db.execute(
        sql`CREATE TRIGGER fail_outbox BEFORE INSERT ON mail_outbox FOR EACH ROW EXECUTE FUNCTION fail_outbox()`,
      )
      const res = await submit(siteId, validFields(), { testApi: broken })
      expect(res.status).toBe(500)
      expect(await res.text()).toContain('Заявка не сохранена')
      expect(await leadsOf(broken, siteId)).toEqual([])
      expect(await outboxOf(broken, siteId)).toEqual([])
    } finally {
      await broken.close()
    }
  })
})

describe('раздел «Заявки» в админке', () => {
  it('новые сверху, фильтр по статусу, «обработана», возврат в новые и удаление', async () => {
    const siteId = await siteWithForm()
    await submit(siteId, validFields({ name: 'Первая' }))
    await submit(siteId, validFields({ name: 'Вторая' }))
    const list = async (query = '') => {
      const res = await api.app.request(`${leadsUrl(siteId)}${query}`, { headers: owner.headers })
      expect(res.status).toBe(200)
      return ((await res.json()) as { items: { id: string; data: { value: unknown }[] }[] }).items
    }
    const [second, first] = await list()
    expect(second?.data[0]?.value).toBe('Вторая')
    expect(first?.data[0]?.value).toBe('Первая')

    const patch = (id: string, status: string) =>
      api.app.request(`${leadsUrl(siteId)}/${id}`, {
        method: 'PATCH',
        headers: json(owner.headers),
        body: JSON.stringify({ status }),
      })
    const processed = await patch(first?.id ?? '', 'processed')
    expect(processed.status).toBe(200)
    expect(await processed.json()).toMatchObject({
      status: 'processed',
      processedAt: expect.any(String),
    })
    expect((await list('?status=new')).map((lead) => lead.id)).toEqual([second?.id])
    expect((await list('?status=processed')).map((lead) => lead.id)).toEqual([first?.id])
    expect((await patch(first?.id ?? '', 'new')).status).toBe(200)
    expect(await list('?status=processed')).toEqual([])

    const card = await api.app.request(`${leadsUrl(siteId)}/${second?.id}`, {
      headers: owner.headers,
    })
    expect(await card.json()).toMatchObject({ id: second?.id, formTitle: 'Оставьте заявку' })

    const removed = await api.app.request(`${leadsUrl(siteId)}/${second?.id}`, {
      method: 'DELETE',
      headers: owner.headers,
    })
    expect(removed.status).toBe(204)
    expect((await list()).map((lead) => lead.id)).toEqual([first?.id])
    const again = await api.app.request(`${leadsUrl(siteId)}/${second?.id}`, {
      method: 'DELETE',
      headers: owner.headers,
    })
    expect(again.status).toBe(404)
  })

  it('счётчик новых заявок — в данных сайта (null, если роли заявки не видны)', async () => {
    const siteId = await siteWithForm()
    await submit(siteId, validFields())
    await submit(siteId, validFields())
    const site = await api.app.request(`/api/sites/${siteId}`, { headers: owner.headers })
    expect(await site.json()).toMatchObject({ newLeads: 2 })

    const editor = await api.loginAs('editor', siteId)
    const editorView = await api.app.request(`/api/sites/${siteId}`, { headers: editor.headers })
    expect(await editorView.json()).toMatchObject({ newLeads: null })
    const { token } = await api.createToken(siteId)
    const tokenView = await api.app.request(`/api/sites/${siteId}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(await tokenView.json()).toMatchObject({ newLeads: null })
  })

  it('права: владелец и клиент — да, редактор — 403, чужой сайт — 404, токен MCP — 403', async () => {
    const siteId = await siteWithForm()
    await submit(siteId, validFields())
    const [lead] = await leadsOf(api, siteId)
    const client = await api.loginAs('client', siteId)
    const editor = await api.loginAs('editor', siteId)
    const stranger = await api.loginAs('client') // клиент демо-сайта: этот сайт ему чужой
    const { token } = await api.createToken(siteId)
    const bearer = { authorization: `Bearer ${token}` }
    const settingsBody = JSON.stringify({
      recipients: [],
      retentionDays: 30,
      confirmToVisitor: false,
    })

    const requests = (headers: Headers) => [
      api.app.request(leadsUrl(siteId), { headers }),
      api.app.request(`${leadsUrl(siteId)}/export`, { headers }),
      api.app.request(`${leadsUrl(siteId)}/settings`, { headers }),
      api.app.request(`${leadsUrl(siteId)}/${lead?.id}`, { headers }),
      api.app.request(`${leadsUrl(siteId)}/settings`, {
        method: 'PUT',
        headers: json(headers),
        body: settingsBody,
      }),
      api.app.request(`${leadsUrl(siteId)}/${lead?.id}`, {
        method: 'PATCH',
        headers: json(headers),
        body: JSON.stringify({ status: 'processed' }),
      }),
    ]
    for (const res of await Promise.all(requests(client.headers))) expect(res.status).toBe(200)
    for (const res of await Promise.all(requests(editor.headers))) expect(res.status).toBe(403)
    for (const res of await Promise.all(requests(stranger.headers))) expect(res.status).toBe(404)
    for (const res of await Promise.all(requests(bearer))) {
      expect(res.status).toBe(403)
      expect(await res.json()).toMatchObject({
        error: { message: expect.stringContaining('Токену API заявки недоступны') },
      })
    }
    // Удаляет и клиент: это его заявки (в том числе по просьбе посетителя)
    const removed = await api.app.request(`${leadsUrl(siteId)}/${lead?.id}`, {
      method: 'DELETE',
      headers: client.headers,
    })
    expect(removed.status).toBe(204)
  })

  it('CSV: формулы обезврежены, BOM, разделитель «;», файл для скачивания', async () => {
    const siteId = await siteWithForm()
    await submit(
      siteId,
      validFields({ name: '=HYPERLINK("https://evil.example")', comment: '@SUM(1)' }),
    )
    const res = await api.app.request(`${leadsUrl(siteId)}/export`, { headers: owner.headers })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="leads-.+\.csv"$/)
    const bytes = new Uint8Array(await res.arrayBuffer())
    // BOM: иначе Excel прочтёт UTF-8 как Windows-1251
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const csv = new TextDecoder().decode(bytes)
    const [header, row] = csv.split('\r\n')
    expect(header).toBe(
      '"Дата (МСК)";"Статус";"Страница";"Форма";"Имя";"Телефон";"Почта";"Комментарий";"Услуга";"Перезвоните мне"',
    )
    expect(row).toContain(`"'=HYPERLINK(""https://evil.example"")"`)
    expect(row).toContain(`"'@SUM(1)"`)
    expect(row).toContain('"новая";"/";"Оставьте заявку"')
    expect(row).toContain('"нет"')
  })

  it('настройки заявок: схема, сохранение и чтение', async () => {
    const siteId = await siteWithForm()
    const url = `${leadsUrl(siteId)}/settings`
    const initial = await api.app.request(url, { headers: owner.headers })
    expect(await initial.json()).toEqual({
      recipients: [],
      retentionDays: 180,
      confirmToVisitor: true,
    })
    const bad = await api.app.request(url, {
      method: 'PUT',
      headers: json(owner.headers),
      body: JSON.stringify({
        recipients: ['a@b.ru\nBcc: x@y.ru'],
        retentionDays: 3,
        confirmToVisitor: true,
      }),
    })
    expect(bad.status).toBe(400)
    const saved = await api.app.request(url, {
      method: 'PUT',
      headers: json(owner.headers),
      body: JSON.stringify({
        recipients: ['m@example.ru'],
        retentionDays: 30,
        confirmToVisitor: false,
      }),
    })
    expect(await saved.json()).toEqual({
      recipients: ['m@example.ru'],
      retentionDays: 30,
      confirmToVisitor: false,
    })
    const list = await api.app.request(leadsUrl(siteId), { headers: owner.headers })
    expect(await list.json()).toMatchObject({ notifications: { recipients: 'custom' } })
  })
})

describe('удаление заявки и письма о ней', () => {
  it('удалили заявку — удалились и её письма в очереди: копия полей и почта посетителя', async () => {
    const siteId = await siteWithForm()
    const email = freshEmail()
    await submit(siteId, validFields({ email, comment: 'Секретный комментарий' }))
    await submit(siteId, validFields({ name: 'Другая' }))
    const all = await leadsOf(api, siteId)
    const first = all.find((lead) => lead.data[0]?.value === 'Анна')
    const second = all.find((lead) => lead.data[0]?.value === 'Другая')
    const ofLead = (leadId: string | undefined) =>
      api.db
        .select({ template: mailOutbox.template, recipient: mailOutbox.recipient })
        .from(mailOutbox)
        .where(eq(mailOutbox.leadId, leadId ?? crypto.randomUUID()))
    expect((await ofLead(first?.id)).map((mail) => mail.template)).toContain('lead-received')

    const res = await api.app.request(`${leadsUrl(siteId)}/${first?.id}`, {
      method: 'DELETE',
      headers: owner.headers,
    })
    expect(res.status).toBe(204)
    expect(await ofLead(first?.id)).toEqual([])
    const left = await outboxOf(api, siteId)
    expect(left.map((mail) => mail.recipient)).not.toContain(email)
    expect(JSON.stringify(left)).not.toContain('Секретный комментарий')
    // Письма другой заявки на месте
    expect((await ofLead(second?.id)).length).toBeGreaterThan(0)
  })
})

describe('срок хранения', () => {
  it('чистка удаляет заявки старше срока своего сайта, остальные остаются', async () => {
    const short = await siteWithForm()
    const long = await siteWithForm()
    await api.db.update(sites).set({ leadRetentionDays: 7 }).where(eq(sites.id, short))
    await api.db.update(sites).set({ leadRetentionDays: 30 }).where(eq(sites.id, long))
    for (const siteId of [short, long]) {
      await submit(siteId, validFields({ name: 'Старая' }))
      await submit(siteId, validFields({ name: 'Свежая' }))
    }
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
    await api.db
      .update(leads)
      .set({ createdAt: tenDaysAgo })
      .where(sql`${leads.data}->0->>'value' = 'Старая'`)

    const removed = await leadsRepo(api.db).cleanup(new Date())
    expect(removed).toBeGreaterThanOrEqual(1)
    // Письма о старой заявке ушли вместе с ней
    const oldMail = await api.db
      .select({ id: mailOutbox.id })
      .from(mailOutbox)
      .where(sql`${mailOutbox.data}::text like '%Старая%' and ${mailOutbox.siteId} = ${short}`)
    expect(oldMail).toEqual([])
    const names = async (siteId: string) =>
      (await leadsOf(api, siteId)).map((lead) => lead.data[0]?.value).sort()
    expect(await names(short)).toEqual(['Свежая'])
    expect(await names(long)).toEqual(['Свежая', 'Старая'])
  })
})

describe('каталог', () => {
  it('пример блока формы проходит схему страницы в API', async () => {
    const siteId = await siteWithForm()
    await saveDraft(api, siteId, [{ id: 'example', type: 'form', props: form.example }])
  })
})
