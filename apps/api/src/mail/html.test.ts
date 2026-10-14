import { describe, expect, it } from 'vitest'
import { escapeHtml, html } from './html'

describe('html`…`', () => {
  it('экранирует каждую подстановку', () => {
    const name = `<script>alert("x")</script> & 'Анна'`
    expect(html`<p>${name}</p>`.value).toBe(
      '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;Анна&#39;</p>',
    )
  })

  it('экранирует и значения атрибутов: из кавычек не выйти', () => {
    const url = 'https://example.ru/" onmouseover="alert(1)'
    expect(html`<a href="${url}">ссылка</a>`.value).toBe(
      '<a href="https://example.ru/&quot; onmouseover=&quot;alert(1)">ссылка</a>',
    )
  })

  it('вложенные html`…` и их массивы вставляются как есть, без двойного экранирования', () => {
    const items = ['a<b', 'c&d'].map((item) => html`<li>${item}</li>`)
    expect(html`<ul>${items}</ul>`.value).toBe('<ul><li>a&lt;b</li><li>c&amp;d</li></ul>')
  })

  it('объект, похожий на фрагмент, безопасным не считается', () => {
    const fake = { value: '<b>x</b>' } as unknown as string
    expect(html`${fake}`.value).toBe('[object Object]')
  })

  it('пустые значения не выводятся, числа — как текст', () => {
    expect(html`${null}${undefined}${false}${42}`.value).toBe('42')
    expect(escapeHtml('a"b')).toBe('a&quot;b')
  })
})
