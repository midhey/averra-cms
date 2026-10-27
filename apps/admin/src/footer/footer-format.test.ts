import { emptyFooterContacts } from '@averra/schema'
import { describe, expect, it } from 'vitest'
import {
  footerHiddenOnText,
  footerStatus,
  organizationNote,
  policyNote,
  sectionsNote,
} from './footer-format'

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
      /не заполнены: название, ИНН, телефон, почта, адрес, соцсети —/,
    )
    const full = {
      ...emptyFooterContacts,
      name: 'ИП Иванов',
      inn: '590000000000',
      phone: '+7 342 000-00-00',
      email: 'info@remont.example',
      address: 'Пермь',
      socials: ['https://vk.com/remont'],
    }
    expect(organizationNote(full, 'columns')).toMatch(/правьте их там/)
    // Почта — в колонке «Контакты»: простому подвалу она не нужна
    expect(organizationNote({ ...full, email: '' }, 'columns')).toMatch(
      /Там не заполнено: почта — этого в подвале не будет/,
    )
    expect(organizationNote({ ...full, email: '', inn: '' }, 'columns')).toMatch(
      /Там не заполнены: ИНН, почта — этого в подвале не будет/,
    )
    expect(organizationNote({ ...full, email: '' }, 'simple')).toMatch(/правьте их там/)
  })

  it('разделы: подсказка — по шапке на сайте, а не по черновику меню', () => {
    // Шапка не опубликована — на сайте колонки нет, даже если в черновике меню есть
    expect(sectionsNote({ menuOnSite: null, menuEdited: true })).toMatch(
      /^Шапка не опубликована — на сайте колонки «Разделы»/,
    )
    expect(sectionsNote({ menuOnSite: 0, menuEdited: false })).toMatch(
      /^В меню шапки пока нет пунктов/,
    )
    // На сайте меню пустое, в черновике — пункты: колонка появится с публикацией шапки
    expect(sectionsNote({ menuOnSite: 0, menuEdited: true })).toMatch(
      /^В меню шапки на сайте нет пунктов — колонка «Разделы» появится, когда вы опубликуете/,
    )
    expect(sectionsNote({ menuOnSite: 3, menuEdited: false })).toMatch(
      /^Те же пункты, что в меню шапки/,
    )
    expect(sectionsNote({ menuOnSite: 3, menuEdited: true })).toMatch(
      /правки меню попадут в подвал, когда вы опубликуете шапку$/,
    )
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
