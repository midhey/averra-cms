import { describe, expect, it } from 'vitest'
import { text } from './blocks'
import { LEGAL_NOTE_BLOCK_ID, type LegalFacts, legalPageContent, legalPages } from './legal'
import { Organization } from './site-settings'
import { parseTextBody, plainTextValue } from './text-body'

const facts = (overrides: Partial<LegalFacts> = {}): LegalFacts => ({
  siteName: 'Ремонт у Ивана',
  siteUrl: 'https://remont-ivana.ru',
  organization: Organization.parse({
    name: 'ИП Иванов Иван Иванович',
    inn: '590212345678',
    ogrn: '312590212345678',
    email: 'info@remont-ivana.ru',
    address: { postalCode: '614000', city: 'Пермь', street: 'ул. Ленина, 1' },
  }),
  metrika: true,
  ga4: false,
  cookieMode: 'consent',
  forms: true,
  telegram: false,
  mail: true,
  visitorConfirmation: false,
  video: [],
  leadRetentionDays: 180,
  policyPage: '',
  date: '2026-10-22',
  ...overrides,
})

/** Весь текст страницы одной строкой */
function pageText(document: 'privacy' | 'consent', input: LegalFacts) {
  return legalPageContent(document, input)
    .blocks.map((block) => JSON.stringify(block.props))
    .join('\n')
}

describe('legalPageContent', () => {
  it('политика: заголовок, редакция, пометка «проверьте с юристом» и реквизиты', () => {
    const content = legalPageContent('privacy', facts())
    const [hero, note] = content.blocks
    expect(hero).toMatchObject({
      type: 'hero',
      props: { title: legalPages.privacy.title, subtitle: 'Редакция от 22.10.2026' },
    })
    expect(note).toMatchObject({ id: LEGAL_NOTE_BLOCK_ID, type: 'text' })
    expect(JSON.stringify(note)).toContain('проверьте с юристом')
    const all = pageText('privacy', facts())
    expect(all).toContain('ИП Иванов Иван Иванович')
    expect(all).toContain('ИНН: 590212345678')
    expect(all).toContain('ОГРН: 312590212345678')
    expect(all).toContain('Адрес: 614000, Пермь, ул. Ленина, 1')
    expect(all).toContain('info@remont-ivana.ru')
    expect(all).toContain('https://remont-ivana.ru')
  })

  it('пустые реквизиты — заметные заглушки, а не пустота', () => {
    const all = pageText('privacy', facts({ organization: Organization.parse({}) }))
    expect(all).toContain('[укажите название в «SEO» → «Организация»]')
    expect(all).toContain('[укажите ИНН в «SEO» → «Организация»]')
    expect(all).toContain('[укажите почту в «SEO» → «Организация»]')
  })

  it('упоминает только включённые сервисы', () => {
    const metrikaOnly = pageText('privacy', facts())
    expect(metrikaOnly).toContain('Яндекс Метрика')
    expect(metrikaOnly).not.toContain('Google Analytics')
    expect(metrikaOnly).not.toContain('Telegram')
    const everything = pageText('privacy', facts({ ga4: true, telegram: true }))
    expect(everything).toContain('Google Analytics (Google LLC, США)')
    expect(everything).toContain('Telegram (Telegram FZ-LLC, ОАЭ)')
    expect(everything).toMatch(/трансграничная передача/)
    const nothing = pageText('privacy', facts({ metrika: false, forms: false }))
    expect(nothing).toContain('Сайт не собирает персональные данные')
    expect(nothing).not.toContain('Cookie')
  })

  it('разделы нумеруются по месту', () => {
    const titles = legalPageContent('privacy', facts({ metrika: false, forms: false }))
      .blocks.flatMap((block) =>
        block.type === 'text' && block.props.title ? [block.props.title] : [],
      )
      .filter((title) => /^\d+\./.test(title))
    expect(titles.map((title) => Number.parseInt(title, 10))).toEqual(
      titles.map((_, index) => index + 1),
    )
  })

  it('срок хранения заявок и режим cookie — из настроек', () => {
    expect(pageText('privacy', facts({ leadRetentionDays: 30 }))).toContain(
      'Заявки хранятся на сервере Оператора ([укажите, где находится сервер',
    )
    expect(pageText('privacy', facts({ leadRetentionDays: 30 }))).toContain(
      '30 дней с момента получения заявки',
    )
    expect(pageText('privacy', facts())).toContain('«Настройки cookie» внизу страницы')
    expect(pageText('privacy', facts({ cookieMode: 'notice' }))).toContain('в настройках браузера')
  })

  it('место сервера — заглушка, и только при формах: без них данных на сервере нет', () => {
    expect(pageText('privacy', facts())).not.toContain('в России')
    const analyticsOnly = pageText('privacy', facts({ forms: false }))
    expect(analyticsOnly).not.toContain('сервере Оператора')
    expect(analyticsOnly).toContain('Соединение с сайтом зашифровано')
  })

  it('срок хранения в политике и согласии — одной фразой, с резервными копиями', () => {
    const phrase =
      '180 дней с момента получения заявки, затем она удаляется автоматически; из резервных копий сервера'
    expect(pageText('privacy', facts())).toContain(phrase)
    expect(pageText('consent', facts())).toContain(`Срок: ${phrase}`)
  })

  it('согласие ссылается на выбранную страницу политики', () => {
    expect(pageText('consent', facts())).toContain('на странице /privacy.')
    expect(pageText('consent', facts({ policyPage: 'politika' }))).toContain(
      'на странице /politika.',
    )
  })

  it('согласие: оператор, условия, срок, отзыв и Telegram — только когда он включён', () => {
    const consent = pageText('consent', facts())
    expect(consent).toContain('ИП Иванов Иван Иванович (ИНН 590212345678')
    expect(consent).toContain('Срок: 180 дней')
    expect(consent).toContain('info@remont-ivana.ru')
    expect(consent).not.toContain('Telegram')
    expect(pageText('consent', facts({ telegram: true }))).toContain('трансграничную передачу')
    expect(legalPageContent('consent', facts()).blocks[0]).toMatchObject({
      props: { title: legalPages.consent.title },
    })
  })

  it('почта — только когда письма правда уходят: сотрудникам и подтверждение посетителю', () => {
    const service = 'почтовый сервис [укажите почтовый сервис'
    const staff = 'письма с уведомлением о заявке и её содержимым приходят сотрудникам'
    const visitor = 'письмо-подтверждение заявки уходит на адрес почты'
    const both = pageText('privacy', facts({ visitorConfirmation: true }))
    expect(both).toContain(service)
    expect(both).toContain(staff)
    expect(both).toContain(visitor)
    // Получателей на почте нет или канал выключен — про письма сотрудникам ни слова
    const confirmationOnly = pageText('privacy', facts({ mail: false, visitorConfirmation: true }))
    expect(confirmationOnly).not.toContain(staff)
    expect(confirmationOnly).toContain(visitor)
    const noMail = pageText('privacy', facts({ mail: false }))
    expect(noMail).not.toContain('почтовый сервис')
    // Без форм писем нет, даже если получатели остались
    expect(pageText('privacy', facts({ forms: false, visitorConfirmation: true }))).not.toContain(
      'почтовый сервис',
    )
    expect(pageText('consent', facts({ visitorConfirmation: true }))).toContain(
      'Письма с заявкой и подтверждение заявки на мою почту отправляются через почтовый сервис',
    )
    expect(pageText('consent', facts({}))).toContain(
      'Письма с заявкой отправляются через почтовый сервис',
    )
    // Сотрудникам писем нет — согласие не говорит о «письмах с заявкой»
    const visitorOnly = pageText('consent', facts({ mail: false, visitorConfirmation: true }))
    expect(visitorOnly).toContain(
      'Подтверждение заявки на мою почту отправляется через почтовый сервис',
    )
    expect(visitorOnly).not.toContain('Письма с заявкой')
    expect(pageText('consent', facts({ mail: false }))).not.toContain('почтовый сервис')
  })

  it('срок хранения склоняется по числу', () => {
    expect(pageText('consent', facts({ leadRetentionDays: 21 }))).toContain('Срок: 21 день с')
    expect(pageText('consent', facts({ leadRetentionDays: 22 }))).toContain('Срок: 22 дня с')
    expect(pageText('consent', facts({ leadRetentionDays: 25 }))).toContain('Срок: 25 дней с')
    expect(pageText('privacy', facts({ leadRetentionDays: 31 }))).toContain('31 день с момента')
  })

  it('ролики: площадка — в получателях, YouTube — с трансграничной передачей, и про cookie', () => {
    const youtube = pageText('privacy', facts({ video: ['youtube'] }))
    expect(youtube).toContain('YouTube (Google LLC, США) — плеер ролика')
    expect(youtube).toContain('трансграничная передача')
    expect(youtube).toContain('плеер площадки видео ставит свои cookie')
    const russian = pageText('privacy', facts({ video: ['rutube', 'vk'] }))
    expect(russian).toContain('Rutube (Россия)')
    expect(russian).toContain('VK Видео (ООО «ВК», Россия)')
    expect(russian).not.toContain('YouTube')
    expect(pageText('privacy', facts())).not.toContain('плеер ролика')
    // Только ролики: данные всё же уходят площадке, и раздел о cookie есть
    const videoOnly = pageText('privacy', facts({ metrika: false, forms: false, video: ['vk'] }))
    expect(videoOnly).not.toContain('Сайт не собирает персональные данные')
    expect(videoOnly).toContain('Сам сайт cookie не ставит')
  })

  it('разметка из реквизитов не получается: значения — одной строкой', () => {
    const organization = Organization.parse({
      name: '## Взлом\n\n- лишний пункт',
      email: 'info@remont-ivana.ru',
    })
    const content = legalPageContent('privacy', facts({ organization }))
    for (const block of content.blocks) {
      if (block.type !== 'text') continue
      for (const part of parseTextBody(block.props.body)) {
        if (part.kind === 'heading') throw new Error(`лишний подзаголовок: ${part.text}`)
        if (part.kind === 'list') expect(part.items).not.toContain('лишний пункт')
      }
    }
    expect(pageText('privacy', facts({ organization }))).toContain('Взлом - лишний пункт')
  })

  it('каждый блок проходит схему блока «Текст»', () => {
    for (const document of ['privacy', 'consent'] as const) {
      for (const block of legalPageContent(
        document,
        facts({ ga4: true, telegram: true, visitorConfirmation: true, video: ['youtube'] }),
      ).blocks) {
        if (block.type === 'text') expect(text.props.safeParse(block.props).success).toBe(true)
      }
    }
  })
})

describe('parseTextBody', () => {
  it('абзацы, списки и подзаголовки', () => {
    expect(
      parseTextBody(
        'Первый\nабзац\n\n## Подзаголовок\n- пункт один\nпродолжение\n- пункт два\n\nКонец',
      ),
    ).toEqual([
      { kind: 'paragraph', text: 'Первый абзац' },
      { kind: 'heading', text: 'Подзаголовок' },
      { kind: 'list', items: ['пункт один продолжение', 'пункт два'] },
      { kind: 'paragraph', text: 'Конец' },
    ])
  })

  it('HTML — просто текст', () => {
    expect(parseTextBody('<script>alert(1)</script>')).toEqual([
      { kind: 'paragraph', text: '<script>alert(1)</script>' },
    ])
  })

  it('plainTextValue: одна строка без разметки в начале', () => {
    expect(plainTextValue('  ## - ООО «Ромашка»\n\nи ко ')).toBe('ООО «Ромашка» и ко')
  })
})
