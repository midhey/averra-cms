import { describe, expect, it } from 'vitest'
import { BlockId } from './define-block'
import {
  defaultFooter,
  FOOTER_ABOUT_MAX,
  FOOTER_FORM_ID,
  Footer,
  FooterLayout,
  FooterTone,
  footerContrast,
  footerFormFields,
  footerLayoutTitles,
  footerPalette,
  footerPublishIssues,
  footerRequisites,
  leadFormLabel,
  readFooter,
  sameFooter,
  socialLinks,
  themeChecksPair,
} from './footer'
import { leadValuesSchema } from './forms'
import { PageContent } from './page'
import { ThemeInput } from './theme'
import { themePresets } from './theme-presets'

describe('Footer', () => {
  it('по умолчанию — простой на поверхности, разделы из меню, тексты формы готовы', () => {
    expect(defaultFooter).toEqual({
      layout: 'simple',
      tone: 'surface',
      about: '',
      sections: true,
      callback: {
        title: 'Остались вопросы?',
        text: 'Оставьте телефон — перезвоним в рабочее время',
        button: 'Перезвоните мне',
        successText: 'Спасибо! Мы получили номер и скоро перезвоним.',
      },
    })
  })

  it('три вида и два фона, у каждого вида подпись', () => {
    expect(FooterLayout.options).toEqual(['simple', 'columns', 'big'])
    expect(FooterTone.options).toEqual(['surface', 'accent'])
    expect(Object.keys(footerLayoutTitles)).toEqual(FooterLayout.options)
  })

  it('строка «О компании» — до предела, пустые тексты формы не проходят, лишних ключей нет', () => {
    expect(Footer.safeParse({ about: 'а'.repeat(FOOTER_ABOUT_MAX) }).success).toBe(true)
    expect(Footer.safeParse({ about: 'а'.repeat(FOOTER_ABOUT_MAX + 1) }).success).toBe(false)
    expect(Footer.safeParse({ callback: { button: '  ' } }).success).toBe(false)
    expect(Footer.safeParse({ callback: { title: '' } }).success).toBe(false)
    expect(Footer.safeParse({ layout: 'huge' }).success).toBe(false)
    expect(Footer.safeParse({ phone: '+7 900' }).success).toBe(false)
  })

  it('sameFooter сравнивает по смыслу', () => {
    expect(sameFooter(defaultFooter, Footer.parse({ layout: 'simple' }))).toBe(true)
    expect(sameFooter(defaultFooter, Footer.parse({ layout: 'big' }))).toBe(false)
  })
})

describe('readFooter', () => {
  it('незнакомые ключи отбрасывает, непонятное поле — по умолчанию с путём', () => {
    const invalid: string[] = []
    const footer = readFooter(
      {
        layout: 'mega',
        tone: 'accent',
        about: 'Ремонт квартир',
        future: true,
        callback: { title: 'Вопросы?', button: 42, extra: 'x' },
      },
      (field) => invalid.push(field),
    )
    expect(footer).toEqual({
      ...defaultFooter,
      tone: 'accent',
      about: 'Ремонт квартир',
      callback: { ...defaultFooter.callback, title: 'Вопросы?' },
    })
    expect(invalid).toEqual(['layout', 'callback.button'])
  })

  it('не объект — подвал по умолчанию', () => {
    expect(readFooter(null)).toEqual(defaultFooter)
    expect(readFooter([1, 2])).toEqual(defaultFooter)
  })
})

describe('форма подвала', () => {
  it('id формы не бывает id блока: с формой на странице не совпадёт', () => {
    expect(BlockId.safeParse(FOOTER_FORM_ID).success).toBe(false)
  })

  it('только телефон, обязательный, и согласие', () => {
    const schema = leadValuesSchema(footerFormFields)
    expect(schema.safeParse({ phone: '+7 900 123-45-67', consent: 'yes' }).success).toBe(true)
    expect(schema.safeParse({ phone: '', consent: 'yes' }).success).toBe(false)
    expect(schema.safeParse({ phone: '+7 900 123-45-67' }).success).toBe(false)
  })

  it('большой подвал без опубликованной политики не опубликовать, остальные — можно', () => {
    expect(footerPublishIssues({ layout: 'big' }, false)).toEqual([
      expect.objectContaining({ path: 'layout' }),
    ])
    expect(footerPublishIssues({ layout: 'big' }, true)).toEqual([])
    expect(footerPublishIssues({ layout: 'columns' }, false)).toEqual([])
    expect(footerPublishIssues({ layout: 'simple' }, false)).toEqual([])
  })

  it('источник заявки словами: форма подвала видна как подвал', () => {
    expect(leadFormLabel({ source: 'block', formTitle: 'Замер' })).toBe('Замер')
    expect(leadFormLabel({ source: 'footer', formTitle: 'Остались вопросы?' })).toBe(
      'Остались вопросы? (подвал сайта)',
    )
  })
})

describe('данные из «Организации»', () => {
  it('реквизиты: ОГРН у организации, ОГРНИП у ИП, пустое пропускается', () => {
    expect(
      footerRequisites({ name: 'ООО «Ремонт»', inn: '5900000000', ogrn: '1025900000000' }),
    ).toEqual(['ООО «Ремонт»', 'ИНН 5900000000', 'ОГРН 1025900000000'])
    expect(footerRequisites({ name: 'ИП Иванов И. И.', inn: '590000000000', ogrn: '' })).toEqual([
      'ИП Иванов И. И.',
      'ИНН 590000000000',
    ])
    expect(footerRequisites({ name: 'ИП Иванов И. И.', inn: '', ogrn: '304590000000000' })).toEqual(
      ['ИП Иванов И. И.', 'ОГРНИП 304590000000000'],
    )
    expect(footerRequisites({ name: '', inn: '', ogrn: '' })).toEqual([])
  })

  it('соцсети: знакомые — по названию, остальные — по домену, кривые пропускаются', () => {
    expect(
      socialLinks([
        'https://vk.com/remont',
        'https://t.me/remont',
        'https://www.youtube.com/@remont',
        'https://m.ok.ru/group/1',
        'https://example.ru/remont',
        'http://vk.com/old',
        'не ссылка',
      ]),
    ).toEqual([
      { href: 'https://vk.com/remont', label: 'ВКонтакте', short: 'VK' },
      { href: 'https://t.me/remont', label: 'Telegram', short: 'TG' },
      { href: 'https://www.youtube.com/@remont', label: 'YouTube', short: 'YT' },
      { href: 'https://m.ok.ru/group/1', label: 'Одноклассники', short: 'OK' },
      { href: 'https://example.ru/remont', label: 'example.ru', short: 'EX' },
    ])
  })
})

describe('цвета подвала', () => {
  it('каждая пара подвала — пара, которую тема проверяет на контраст', () => {
    for (const tone of FooterTone.options) {
      for (const pair of footerContrast(themePresets[0]?.theme.colors ?? ({} as never), tone)) {
        expect(themeChecksPair(pair), `${tone}: ${pair.part}`).toBe(true)
      }
    }
  })

  it('в готовых темах, включая «Ночную», подвал читается на любом фоне', () => {
    for (const preset of themePresets) {
      for (const tone of FooterTone.options) {
        for (const check of footerContrast(preset.theme.colors, tone)) {
          expect(check.ok, `${preset.title}, ${tone}: ${check.label}`).toBe(true)
        }
      }
    }
  })

  it('своя тёмная тема, которую можно сохранить, — подвал на акценте и поверхности читается', () => {
    const theme = ThemeInput.parse({
      colors: {
        background: '#0b0d12',
        surface: '#161a22',
        text: '#eef1f6',
        muted: '#a9b1bf',
        accent: '#7cc4ff',
        onAccent: '#071423',
        border: '#2a303b',
      },
      fonts: { heading: 'system', body: 'system' },
    })
    for (const tone of FooterTone.options) {
      for (const check of footerContrast(theme.colors, tone)) {
        expect(check.ok, `${tone}: ${check.label}`).toBe(true)
      }
    }
  })

  it('на акценте всё — «текст на акценте», кнопка наоборот', () => {
    expect(footerPalette.accent).toEqual({
      background: 'accent',
      text: 'onAccent',
      muted: 'onAccent',
      focus: 'onAccent',
      buttonBackground: 'onAccent',
      buttonText: 'accent',
    })
  })
})

describe('PageContent.hideFooter', () => {
  it('необязательный флажок', () => {
    expect(PageContent.parse({ blocks: [] })).not.toHaveProperty('hideFooter')
    expect(PageContent.parse({ blocks: [], hideFooter: true }).hideFooter).toBe(true)
    expect(PageContent.safeParse({ blocks: [], hideFooter: 'да' }).success).toBe(false)
  })
})
