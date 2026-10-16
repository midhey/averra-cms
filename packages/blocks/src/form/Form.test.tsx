import { form, PageContent } from '@averra/schema'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Page } from '../Page'

const action = (blockId: string) => `https://api.example.ru/api/forms/site/index/${blockId}`

const render = (props: unknown, formAction?: (blockId: string) => string) =>
  renderToStaticMarkup(
    <Page
      content={PageContent.parse({ blocks: [{ id: 'lead', type: 'form', props }] })}
      formAction={formAction}
    />,
  )

const withSelect = {
  ...form.example,
  fields: [
    ...form.example.fields,
    {
      name: 'service',
      type: 'select',
      label: 'Услуга',
      required: true,
      options: [{ label: 'Ремонт' }, { label: 'Дизайн' }],
    },
    { name: 'call_me', type: 'checkbox', label: 'Перезвоните мне' },
  ],
}

/** Открывающий тег элемента с этим id. Порядок атрибутов React не обещает — ищем по одному */
function tag(html: string, id: string) {
  const found = new RegExp(`<[a-z]+ [^>]*id="${id}"[^>]*>`).exec(html)?.[0]
  if (!found) throw new Error(`Нет элемента #${id}`)
  return found.toLowerCase()
}

describe('блок «Форма»', () => {
  const html = render(withSelect, action)

  it('обычная HTML-форма POST в API, без скриптов', () => {
    const formTag = /<form[^>]*>/.exec(html)?.[0] ?? ''
    expect(formTag).toContain('method="post"')
    expect(formTag).toContain('action="https://api.example.ru/api/forms/site/index/lead"')
    expect(html).not.toContain('<script')
  })

  it('атрибуты проверки — из схемы полей', () => {
    const name = tag(html, 'lead-name')
    for (const part of ['type="text"', 'name="name"', 'required=""', 'maxlength="100"']) {
      expect(name).toContain(part)
    }
    const phone = tag(html, 'lead-phone')
    for (const part of [
      'type="tel"',
      'required=""',
      'maxlength="30"',
      'pattern="',
      'inputmode="tel"',
    ]) {
      expect(phone).toContain(part)
    }
    const email = tag(html, 'lead-email')
    expect(email).toContain('type="email"')
    expect(email).not.toContain('required')
    expect(tag(html, 'lead-comment')).toContain('maxlength="2000"')
    expect(tag(html, 'lead-service')).toContain('required=""')
    expect(html).toContain('<option value="" selected="">Выберите…</option>')
    const check = tag(html, 'lead-call_me')
    expect(check).toContain('type="checkbox"')
    expect(check).toContain('value="yes"')
  })

  it('подписи связаны с полями, подсказки — через aria-describedby', () => {
    expect(html).toContain('<label for="lead-phone"')
    expect(tag(html, 'lead-phone')).toContain('aria-describedby="lead-phone-hint"')
    expect(html).toContain('id="lead-phone-hint"')
  })

  it('ловушка скрыта от людей и диктора и не в порядке Tab', () => {
    expect(html).toMatch(/<div[^>]*aria-hidden="true"[^>]*><label for="lead-website"/)
    const trap = tag(html, 'lead-website')
    expect(trap).toContain('name="website"')
    expect(trap).toContain('tabindex="-1"')
    expect(trap).toContain('autocomplete="off"')
  })

  it('согласие обязательно и ведёт на политику', () => {
    const consent = tag(html, 'lead-consent')
    for (const part of ['type="checkbox"', 'name="consent"', 'value="yes"', 'required=""']) {
      expect(consent).toContain(part)
    }
    expect(html).toContain('href="/privacy"')
    expect(html).toContain('Я согласен на обработку персональных данных')
  })

  it('текст успеха — у элемента #<id>-sent перед формой: его показывает :target', () => {
    expect(html).toMatch(/<p id="lead-sent"[^>]*role="status"[^>]*>Спасибо!.*<\/p><form/)
  })

  it('без адреса приёма (предпросмотр) у формы нет action', () => {
    expect(render(withSelect)).not.toMatch(/<form[^>]*action=/)
  })
})
