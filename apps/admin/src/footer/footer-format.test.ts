import { emptyFooterContacts } from '@averra/schema'
import { describe, expect, it } from 'vitest'
import { footerHiddenOnText, footerStatus, organizationNote, policyNote } from './footer-format'

describe('подписи вкладки «Подвал»', () => {
  it('состояние: не сохранено, не опубликован, есть правки, опубликован', () => {
    expect(footerStatus({ unsaved: true, unpublished: true, onSite: true }).text).toBe(
      'Не сохранено',
    )
    expect(footerStatus({ unsaved: false, unpublished: true, onSite: false }).text).toBe(
      'Подвал пока не опубликован',
    )
    expect(footerStatus({ unsaved: false, unpublished: true, onSite: true }).text).toBe(
      'Сохранено · не опубликовано',
    )
    expect(footerStatus({ unsaved: false, unpublished: false, onSite: true })).toEqual({
      tone: 'success',
      text: 'Опубликован',
    })
  })

  it('чего не хватает в «Организации»: простому — реквизитов, колонкам — и контактов', () => {
    expect(organizationNote(null, 'columns')).toMatch(/когда главная страница будет опубликована/)
    expect(organizationNote(emptyFooterContacts, 'simple')).toMatch(/не заполнены: название, ИНН —/)
    expect(organizationNote(emptyFooterContacts, 'big')).toMatch(
      /не заполнены: название, ИНН, телефон, адрес, соцсети —/,
    )
    const full = {
      ...emptyFooterContacts,
      name: 'ИП Иванов',
      inn: '590000000000',
      phone: '+7 342 000-00-00',
      address: 'Пермь',
      socials: ['https://vk.com/remont'],
    }
    expect(organizationNote(full, 'columns')).toMatch(/правьте их там/)
  })

  it('политика: опубликована — молчим; нет — предупреждаем, у большого — про форму', () => {
    expect(policyNote({ slug: 'privacy', published: true }, 'big')).toBeNull()
    expect(policyNote({ slug: '', published: false }, 'simple')).toMatch(
      /^Политика конфиденциальности не выбрана — ссылки/,
    )
    expect(policyNote({ slug: 'privacy', published: false }, 'big')).toMatch(
      /не опубликована: .*большой подвал не опубликовать/,
    )
  })

  it('где подвал скрыт', () => {
    expect(footerHiddenOnText([{ title: 'Главная', hidden: false }])).toBeUndefined()
    expect(
      footerHiddenOnText([
        { title: 'Промо', hidden: true },
        { title: 'Акция', hidden: true },
      ]),
    ).toBe('Подвал скрыт на страницах: «Промо», «Акция»')
  })
})
