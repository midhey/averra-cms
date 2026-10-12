import { NewPage } from '@cms/schema'
import { beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { setupZodMessages } from '../zod-messages'
import { firstInvalidField, issueFieldErrors, zodFieldErrors } from './field-errors'

beforeAll(setupZodMessages)

describe('ошибки формы по полям', () => {
  it('из ответа API: по одному сообщению на поле, первое', () => {
    expect(
      issueFieldErrors([
        { path: 'slug', message: 'Такой адрес уже есть' },
        { path: 'slug', message: 'Второе сообщение' },
        { path: 'button.href', message: 'Кривая ссылка' },
      ]),
    ).toEqual({ slug: 'Такой адрес уже есть', 'button.href': 'Кривая ссылка' })
  })

  it('из Zod: те же пути, что пришли бы от API', () => {
    const result = NewPage.safeParse({ slug: 'O nas', title: '  ' })
    expect(zodFieldErrors(result.error)).toEqual({
      slug: 'Только латиница в нижнем регистре, цифры и дефис между ними, например o-nas',
      title: 'Поле не может быть пустым',
    })
  })

  it('вложенные пути склеиваются через точку', () => {
    const schema = z.object({ items: z.array(z.object({ title: z.string().min(1) })) })
    const result = schema.safeParse({ items: [{ title: 'ок' }, { title: '' }] })
    expect(Object.keys(zodFieldErrors(result.error))).toEqual(['items.1.title'])
  })

  it('без ошибки — пусто', () => {
    expect(zodFieldErrors(NewPage.safeParse({ slug: 'a', title: 'А' }).error)).toEqual({})
  })

  it('фокус уходит на первое поле с ошибкой в порядке формы, а не в порядке ошибок', () => {
    const errors = { slug: 'ошибка', title: 'ошибка' }
    expect(firstInvalidField(['title', 'slug'], errors)).toBe('title')
    expect(firstInvalidField(['title', 'slug'], { slug: 'ошибка' })).toBe('slug')
    expect(firstInvalidField(['title', 'slug'], {})).toBeUndefined()
  })
})
