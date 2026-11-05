// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  CustomBlockDraft,
  type CustomBlockDraftInput,
  type MediaMap,
  PageContent,
} from '@averra/schema'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Page } from '../Page'
import { compileCustomCss } from './css'
import { checkTemplateHtml, maskLiquid, RAW_HTML_FILTERS, sanitizeHtml } from './html'
import { liquid, liquidLint, renderTemplate } from './liquid'
import { CUSTOM_BLOCK_ATTRIBUTE, isReservedDataAttribute } from './marker'
import { customBlockProblems, customBlocksCss, renderCustomBlockHtml } from './render'

const mediaId = '3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b'
const media: MediaMap = {
  [mediaId]: {
    width: 960,
    height: 640,
    variants: (['avif', 'webp', 'jpeg'] as const).flatMap((format) =>
      [480, 960].map((width) => ({
        format,
        width,
        height: (width * 2) / 3,
        url: `/media/${mediaId}/${width}.${format}`,
      })),
    ),
  },
}

const base: CustomBlockDraftInput = {
  key: 'tariffs',
  title: 'Тарифы с наклейкой',
  description: 'Тарифы карточками с наклейкой',
  fields: [
    { type: 'text', name: 'title', label: 'Заголовок', required: true },
    { type: 'textarea', name: 'text', label: 'Текст' },
    { type: 'link', name: 'button', label: 'Кнопка' },
    { type: 'image', name: 'photo', label: 'Фото' },
    {
      type: 'repeater',
      name: 'plans',
      label: 'Тарифы',
      fields: [
        { type: 'text', name: 'name', label: 'Название', required: true },
        { type: 'text', name: 'url', label: 'Адрес' },
      ],
    },
  ],
  template: '<h2>{{ title }}</h2>',
  example: { title: 'Тарифы' },
}

const define = (input: Partial<CustomBlockDraftInput>) =>
  CustomBlockDraft.parse({ ...base, ...input })
const render = (template: string, props: Record<string, unknown>) =>
  renderCustomBlockHtml(define({ template }), props, { id: 'b', media, priority: false })
const errors = (input: Partial<CustomBlockDraftInput>) =>
  customBlockProblems(define(input)).filter((problem) => problem.level === 'error')

describe('шаблон: рендер', () => {
  it('экранирует данные блока, raw и escape экранирование не снимают', () => {
    const title = '<script>alert(1)</script> & "x"'
    expect(render('<h2>{{ title }}</h2>', { title })).toBe(
      '<h2>&lt;script&gt;alert(1)&lt;/script&gt; &amp; "x"</h2>',
    )
    expect(render('<h2>{{ title | raw }}</h2>', { title })).toBe(
      '<h2>&lt;script&gt;alert(1)&lt;/script&gt; &amp; "x"</h2>',
    )
    // Без подмены raw клиент вставил бы на сайт ссылку на чужой адрес
    expect(
      render('<p>{{ title | raw }}</p>', { title: '<a href="https://phish.example">x</a>' }),
    ).toBe('<p>&lt;a href="https://phish.example"&gt;x&lt;/a&gt;</p>')
    expect(render('<h2>{% echo title %}</h2>', { title })).not.toContain('<script>')
    expect(render('{% raw %}<script>x</script>{% endraw %}', { title })).toBe('')
    expect(render('<p>{{ title | escape }}</p>', { title: '<b>' })).toBe('<p>&lt;b&gt;</p>')
  })

  it('echo, liquid echo и capture не обходят экранирование, cycle недоступен', () => {
    const title = '<b>x</b>'
    expect(render('{% echo title %}', { title })).toBe('&lt;b&gt;x&lt;/b&gt;')
    expect(render('{% echo title | upcase %}', { title })).toBe('&lt;B&gt;X&lt;/B&gt;')
    expect(render('{% liquid\necho title\n%}', { title })).toBe('&lt;b&gt;x&lt;/b&gt;')
    expect(render('{% echo %}', { title })).toBe('')
    // Скобки Liquid в аргументах echo прятали бы разметку между ними от проверки при сохранении
    for (const template of [
      '{% echo title }}<iframe src="https://example.org"></iframe><script>alert(1)</script>{{ title %}',
      '{% liquid\necho title }}<script>alert(1)</script>{{ title\n%}',
    ]) {
      expect(errors({ template })[0]?.message).toMatch(/без \{\{ \}\} и \{% %\}/)
    }
    expect(errors({ template: '{% cycle title, "a" %}' })[0]?.message).toMatch(/cycle/)
    // capture собирает уже экранированный текст, и вывод экранирует его ещё раз
    expect(render('{% capture c %}<b>{{ title }}</b>{% endcapture %}{{ c }}', { title: 'a' })).toBe(
      '&lt;b&gt;a&lt;/b&gt;',
    )
  })

  it('внешние картинки, style и form* не доходят до сайта', () => {
    const img = '<img src="{{ title }}">'
    expect(render(img, { title: 'https://evil.example/a.png' })).toBe('<img>')
    expect(render(img, { title: '//evil.example/a.png' })).toBe('<img>')
    expect(render(img, { title: '\\\\evil.example/a.png' })).toBe('<img>')
    expect(render(img, { title: '/media/a.png' })).toBe('<img src="/media/a.png">')
    expect(
      sanitizeHtml(
        '<div style="position:fixed"><button formaction="https://evil.example" form="f">x</button></div>',
      ),
    ).toBe('<div><button>x</button></div>')
    expect(
      sanitizeHtml(
        '<video poster="https://e.example/a"><source src="https://e.example/v"></video>',
      ),
    ).toBe('<video><source></video>')
    expect(
      sanitizeHtml(
        '<svg><image href="https://e.example/a"/><use xlink:href="https://e.example/a#b"/></svg>',
      ),
    ).toBe('<svg><image></image><use></use></svg>')
    // Адреса файлов медиатеки бывают абсолютными (медиа с адреса API): только они и остаются
    const trusted = new Set(['https://api.example/media/a.webp'])
    expect(
      sanitizeHtml(
        '<img src="https://api.example/media/a.webp" srcset="https://api.example/media/a.webp 1x"><img src="https://api.example/media/b.webp">',
        trusted,
      ),
    ).toBe(
      '<img src="https://api.example/media/a.webp" srcset="https://api.example/media/a.webp 1x"><img>',
    )
    expect(sanitizeHtml('<a href="https://example.com/">x</a>')).toBe(
      '<a href="https://example.com/">x</a>',
    )
  })

  it('ссылка javascript: из текстового поля в href не доходит до сайта', () => {
    const html = render('<a href="{{ title }}">x</a>', { title: 'javascript:alert(1)' })
    expect(html).toBe('<a>x</a>')
    expect(
      render('<a href="{{ button | link }}">{{ button.label }}</a>', {
        title: 'x',
        button: { label: 'Купить', href: '/ceny/' },
      }),
    ).toBe('<a href="/ceny/">Купить</a>')
    expect(render('<a href="{{ title | link }}">x</a>', { title: 'javascript:alert(1)' })).toBe(
      '<a href="#">x</a>',
    )
  })

  it('атрибут из {% if %} с обработчиком убирает очистка', () => {
    const html = render('<p {% if title %}onclick="x()"{% endif %}>{{ title }}</p>', { title: 'a' })
    expect(html).toBe('<p>a</p>')
  })

  it('повторитель, переносы строк и абзацы', () => {
    const html = render(
      '{% for plan in plans %}<b>{{ plan.name }}</b>{% endfor %}{{ text | paragraphs }}{{ text | newline_to_br }}',
      { title: 'x', text: 'a<b>\nb\n\nc', plans: [{ name: 'A' }, { name: 'B' }] },
    )
    expect(html).toBe(
      '<b>A</b><b>B</b><p>a&lt;b&gt;<br>\nb</p><p>c</p>a&lt;b&gt;<br>\nb<br>\n<br>\nc',
    )
  })

  it('accent: слова в звёздочках — <em>, остальное экранировано, переносы — <br>', () => {
    expect(
      render('{{ title | accent }}', { title: 'Английский, *который вписывается*\nв <жизнь>' }),
    ).toBe('Английский, <em>который вписывается</em><br>\nв &lt;жизнь&gt;')
    // Звёздочка без пары и пустая пара остаются текстом; разметка внутри пары — текст
    expect(render('{{ title | accent }}', { title: 'a *b* c * d' })).toBe('a <em>b</em> c * d')
    expect(render('{{ title | accent }}', { title: '*<b>x</b>*' })).toBe(
      '<em>&lt;b&gt;x&lt;/b&gt;</em>',
    )
  })

  it('картинка — адаптивный picture с размерами и alt из поля', () => {
    const html = render("{{ photo | image: '50vw', 'photo' }}", {
      title: 'x',
      photo: { mediaId, alt: 'Офис "у моря"' },
    })
    expect(html).toContain('<picture class="photo">')
    expect(html).toContain('type="image/avif"')
    expect(html).toContain(
      `srcset="/media/${mediaId}/480.jpeg 480w, /media/${mediaId}/960.jpeg 960w"`,
    )
    expect(html).toContain('width="960" height="640" alt="Офис &quot;у моря&quot;" loading="lazy"')
    expect(render('{{ photo | image_url }}', { title: 'x', photo: { mediaId, alt: 'a' } })).toBe(
      `/media/${mediaId}/960.jpeg`,
    )
  })

  it('ошибка данных и шаблона — исключение со строкой, а не сломанная страница', () => {
    expect(() => render('<h2>{{ title }}</h2>', {})).toThrow(/не подходят/)
    expect(() => render('<h2>\n{{ title | date: 1, 2, 3, 4 }}</h2>', { title: 'x' })).not.toThrow()
  })

  it('лимит времени рендера', () => {
    const loop = '{% for a in (1..3000) %}{% for b in (1..3000) %}{{ a }}{% endfor %}{% endfor %}'
    expect(() => render(loop, { title: 'x' })).toThrow(/слишком/)
  })
})

describe('шаблон: проверка при сохранении', () => {
  it('маска Liquid сохраняет строки и колонки', () => {
    const template = 'a{{ b }}\n{% if c %}d'
    expect(maskLiquid(template)).toBe('axxxxxxx\n          d')
  })

  it.each([
    ['<p>a</p>\n<script>alert(1)</script>', /script/, 2],
    ['<p>\n<a onclick="x()">a</a></p>', /onclick/, 2],
    ['<a href="javascript:alert(1)">a</a>', /запрещена/, 1],
    ['<iframe src="https://a.ru"></iframe>', /iframe/, 1],
    ['<object data="x"></object>', /object/, 1],
    ['<embed src="x">', /embed/, 1],
    ['<a href={{ button | link }}>a</a>', /в кавычках/, 1],
    ['<p>\n<a{{ x }}>a</a></p>', /Имя элемента/, 2],
    ['<scr{% if t %}ipt{% endif %}>x</script>', /Имя элемента/, 1],
    ['<svg><rect fill="url(https://evil.example/p.svg#p)"/></svg>', /url\(\)/, 1],
    ['<svg><rect mask="url(//evil.example/m.svg#m)"/></svg>', /url\(\)/, 1],
    ['<svg><rect clip-path="u\\72l(https://evil.example/c.svg#c)"/></svg>', /url\(\)/, 1],
    ['<svg><rect filter="url(&quot;http://evil.example/f.svg#f&quot;)"/></svg>', /url\(\)/, 1],
    ['<svg><path marker-start="url(https://evil.example/m#m)"/></svg>', /url\(\)/, 1],
    [
      '<svg style="x"><rect cursor="url(https://evil.example/c.cur), auto"/></svg>',
      /style|url\(\)/,
      1,
    ],
  ])('%s — ошибка со строкой', (template, message, line) => {
    const problems = checkTemplateHtml(template).filter((problem) => problem.level === 'error')
    expect(problems[0]?.message).toMatch(message)
    expect(problems[0]?.line).toBe(line)
  })

  it.each([
    ['<div style="color:red">a</div>', /style/],
    ['<img src="https://evil.example/a.png" alt="">', /Чужой адрес/],
    ['<img srcset="/a.png 1x, //evil.example/a.png 2x" alt="">', /Чужой адрес/],
    ['<video poster="https://evil.example/a.png"></video>', /Чужой адрес/],
    ['<svg><image href="https://evil.example/a.png"/></svg>', /Чужой адрес/],
    ['<button formaction="https://evil.example/collect">a</button>', /formaction/],
    ['<button form="contact">a</button>', /form/],
    ['<p>a</p><plaintext>b', /plaintext/],
    ['<div {{ title }}>a</div>', /Имя атрибута/],
    ['<div {{ title }}="a">a</div>', /Имя атрибута/],
    ['<{{ title }}>a</{{ title }}>', /Имя элемента/],
  ])('%s — ошибка', (template, message) => {
    const problems = checkTemplateHtml(template).filter((problem) => problem.level === 'error')
    expect(problems[0]?.message).toMatch(message)
  })

  it('картинка без alt — предупреждение, h1 — нет: свой первый экран вправе его вывести', () => {
    const problems = checkTemplateHtml('<h1>a</h1><img src="/a.png">')
    expect(problems.map((problem) => problem.level)).toEqual(['warning'])
  })

  it('неизвестные переменная, фильтр, тег, include — ошибки со строкой', () => {
    expect(errors({ template: '<h2>{{ title }}</h2>\n{{ titel }}' })[0]).toMatchObject({
      line: 2,
      message: expect.stringMatching(/Нет поля «titel»/),
    })
    expect(errors({ template: '{{ title | shout }}' })[0]?.message).toMatch(/фильтр «shout»/)
    expect(errors({ template: '\n{% include "x" %}' })[0]).toMatchObject({
      line: 2,
      message: expect.stringMatching(/недоступен/),
    })
    expect(errors({ template: '{% if title %}a' })[0]?.message).toMatch(/не закрыт/)
    expect(
      errors({ template: '{% for plan in plans %}{{ plan.name }}{{ block.id }}{% endfor %}' }),
    ).toEqual([])
  })

  it.each([
    ['{% for %}{% endfor %}', /записан не полностью/, 1],
    ['<h2>{{ title </h2>', /не закрыт/, 1],
    ['\n{% if %}a{% endif %}', /Непонятное значение/, 2],
    ['{% assign = 1 %}', /имя переменной/, 1],
    ['<h2>{{ title }}</h2>\n{{ title | }}', /нет фильтра/, 2],
    ['{{ title | upcase | }}', /нет фильтра/, 1],
    ['{% if title == %}a{% endif %}', /второго значения/, 1],
    ['{% liquid\n  if title contains\n  echo title\nendif %}', /второго значения/, 2],
    ['\n{{ title | date: }}', /у фильтра нет значения/, 2],
    ['{{ title | append: }}', /у фильтра нет значения/, 1],
  ])('%s — ошибка по-русски со строкой', (template, message, line) => {
    const problem = errors({ template })[0]
    expect(problem?.message).toMatch(message)
    expect(problem?.message).not.toMatch(/[a-z]{4,} [a-z]{4,}/)
    expect(problem?.line).toBe(line)
  })

  it('нехватка аргументов фильтра — по-русски', () => {
    const problem = errors({ template: '{{ title | append }}' })[0]
    expect(problem?.message).toMatch(/Фильтру «append» нужно аргументов/)
  })

  it('«|» в comment и raw — не код, ошибки нет; строки после них — на месте', () => {
    expect(
      errors({
        template:
          '{% comment %}{{ x | }}{% endcomment %}{% raw %}{{ y | }}{% endraw %}<h2>{{ title }}</h2>',
      }),
    ).toEqual([])
    expect(
      errors({ template: '{% comment %}\n{{ x | }}\n{% endcomment %}\n{{ title | }}' })[0]?.line,
    ).toBe(4)
  })

  it('«|» и «>» в строке — не ошибка', () => {
    expect(
      errors({ template: '{{ title | append: " | " }}{% if title != "a>" %}b{% endif %}' }),
    ).toEqual([])
  })

  it('опечатка во вложенном поле повторителя и группы — ошибка со строкой', () => {
    const fields: CustomBlockDraftInput['fields'] = [
      { type: 'text', name: 'title', label: 'Заголовок', required: true },
      {
        type: 'repeater',
        name: 'plans',
        label: 'Тарифы',
        fields: [
          { type: 'text', name: 'name', label: 'Название' },
          { type: 'link', name: 'button', label: 'Кнопка' },
          {
            type: 'repeater',
            name: 'features',
            label: 'Пункты',
            fields: [{ type: 'text', name: 'text', label: 'Пункт' }],
          },
        ],
      },
      {
        type: 'group',
        name: 'note',
        label: 'Примечание',
        fields: [{ type: 'text', name: 'text', label: 'Текст' }],
      },
    ]
    const check = (template: string) => errors({ fields, template })
    expect(check('{% for p in plans %}\n{{ p.nam }}{% endfor %}')[0]).toMatchObject({
      line: 2,
      message: expect.stringMatching(/Нет поля «nam» в «p»: ключи полей — name, button, features/),
    })
    expect(
      check('{% for p in plans %}{% for f in p.features %}{{ f.txt }}{% endfor %}{% endfor %}')[0]
        ?.message,
    ).toMatch(/Нет поля «txt» в «f»/)
    expect(check('{{ note.txt }}')[0]?.message).toMatch(/Нет поля «txt» в «note»/)
    expect(check('{{ plans.first.nam }}')[0]?.message).toMatch(/Нет поля «nam» в «plans»/)
    // Законное: поля элемента, ссылка, forloop, size, переменная из assign
    expect(
      check(
        '{% for p in plans %}{{ p.name }}<a href="{{ p.button | link }}">{{ p.button.label }}</a>' +
          '{% for f in p.features %}{{ f.text }}{{ forloop.index }}{% endfor %}{% endfor %}' +
          '{{ plans.size }}{{ note.text }}{% assign x = plans.first %}{{ x.whatever }}',
      ),
    ).toEqual([])
  })

  it('пустой шаблон и неподходящий пример не публикуются', () => {
    expect(errors({ template: ' ' })[0]?.message).toMatch(/пустой/)
    expect(errors({ example: {} })[0]).toMatchObject({ part: 'example', path: 'example.title' })
  })

  it('очистка убирает запрещённое и в SVG', () => {
    expect(
      sanitizeHtml(
        '<svg><a xlink:href="javascript:x"><set attributeName="href"/></a></svg><!-- x -->',
      ),
    ).toBe('<svg><a></a></svg>')
  })
})

describe('HTML шаблона и разметка сайта', () => {
  const templateErrors = (template: string) =>
    checkTemplateHtml(template).filter((problem) => problem.level === 'error')

  it('разметка внутри raw видна проверке: script и onerror дают ошибку со строкой', () => {
    const script = templateErrors('<p>a</p>\n{% raw %}{{ <script>alert(1)</script> }}{% endraw %}')
    expect(script[0]).toMatchObject({ line: 2, message: expect.stringMatching(/script/) })
    const handler = templateErrors('{% raw %}{% <img src=x onerror=alert(1)> %}{% endraw %}')
    expect(handler[0]?.message).toMatch(/onerror/)
    // Обычный текст со скобками Liquid в raw — не ошибка
    expect(templateErrors('<p>{% raw %}{{ title }}{% endraw %}</p>')).toEqual([])
  })

  it('границы raw — как у LiquidJS: аргументы тегов, «{%- endraw» не конец, скобки в href', () => {
    const bad = [
      '{% raw x %}{{ <script>alert(1)</script> x }}{% endraw %}',
      '{% raw %}{{ <script>alert(1)</script> x }}{% endraw y %}',
      '{% raw %}a{%- endraw %}{{ <script>alert(1)</script> x }}{% endraw %}',
      '{% raw %}<a href="javascript:alert(1)//{{">x</a>{% endraw %}',
      // «%» в аргументах, дефис и не-ASCII в имени тега: LiquidJS читает их как часть слова
      '{% raw 5% %}{{ <script>alert(1)</script> }}{% endraw %}',
      '{% raw %}{% endraw-x %}{{ <script>alert(1)</script> }}{% endraw %}',
      '{% raw %}{% endrawё %}{{ <script>alert(1)</script> }}{% endraw %}',
    ]
    for (const template of bad) {
      expect(templateErrors(template).length, template).toBeGreaterThan(0)
    }
  })

  it('comment не вложен, как в LiquidJS: первый endcomment закрывает, разметка дальше видна', () => {
    const bad = [
      '{% comment %} a {% comment %} {% endcomment %}\n<script>alert(1)</script>',
      '{% comment %}{% comment %}{% endcomment %}<img src="x" alt="" onerror="alert(1)">',
      '{% comment %}{% comment %}{% endcomment %}<a href="javascript:alert(1)">x</a>',
    ]
    for (const template of bad) {
      expect(templateErrors(template).length, template).toBeGreaterThan(0)
    }
    expect(
      templateErrors('{% comment %}\n{% comment %}\n{% endcomment %}\n<script>x</script>')[0],
    ).toMatchObject({ line: 4 })
    // Обычный комментарий скрывает свою разметку, как и раньше
    expect(templateErrors('{% comment %}<script>x</script>{% endcomment %}<p>a</p>')).toEqual([])
  })

  it('lint Liquid берёт границы raw и comment у LiquidJS', () => {
    const fine = [
      '{% raw x %}{{ a | }}{% endraw %}',
      '{% raw %}a{%- endraw %}{{ b | }}{% endraw %}',
    ]
    for (const template of fine) {
      expect(liquidLint(template), template).toEqual([])
    }
    expect(liquidLint('{% raw %}{{ a | }}{% endraw %}{{ b | }}')).toHaveLength(1)
  })

  it('«raw», собранный из вывода или комментария, не прячет запреты атрибутов', () => {
    const bad = [
      '{{ "{% raw %}" }}<a href={{title}}>t</a>{{ "{% endraw %}" }}',
      '{{ "{% raw %}" }}<div {{title}}>t</div>{{ "{% endraw %}" }}',
      '{% # {% raw %}<a href={{title}}>t</a>{% # {% endraw %}',
      '{% raw %}a{% endraw x%y %}<a href={{title}}>t</a>{% raw %}{% endraw %}',
    ]
    for (const template of bad) {
      expect(templateErrors(template).length, template).toBeGreaterThan(0)
    }
  })

  it('теги raw и endraw в значении атрибута — не вывод: опасный href виден проверке со строкой', () => {
    const bad = [
      // Весь адрес внутри raw
      '<a href="{% raw %}javascript:alert(1){% endraw %}">x</a>',
      // Пустой raw между кусками: LiquidJS склеивает их в javascript:
      '<a href="java{% raw %}{% endraw %}script:alert(1)">x</a>',
      '<p>a</p>\n<a href="java{% raw %}{% endraw %}script:alert(1)">x</a>',
      // Обработчик событий тем же способом
      '<img src="x" alt="" onerror="{% raw %}alert(1){% endraw %}">',
    ]
    for (const template of bad) {
      expect(templateErrors(template).length, template).toBeGreaterThan(0)
    }
    // Строка ошибки — строка атрибута
    expect(
      templateErrors('<p>a</p>\n<a href="java{% raw %}{% endraw %}script:alert(1)">x</a>')[0]?.line,
    ).toBe(2)
    // Безопасное значение с теми же тегами — не ошибка, и настоящий вывод по-прежнему не проверяется
    expect(templateErrors('<a href="/{% raw %}{{ page }}{% endraw %}">x</a>')).toEqual([])
    expect(templateErrors('<a href="{{ url }}">x</a>')).toEqual([])
    // Вывод рядом с raw — всё ещё вывод: значение известно только при рендере
    expect(templateErrors('<a href="{% raw %}x{% endraw %}{{ url }}">x</a>')).toEqual([])
  })

  it('комментарии и {% # %} в значении атрибута — не вывод: склеенный href виден проверке', () => {
    const bad = [
      '<a href="java{% comment %}x{% endcomment %}script:alert(1)">x</a>',
      '<a href="java{%- comment -%} x {%- endcomment -%}script:alert(1)">x</a>',
      '<a href="java{% # c %}script:alert(1)">x</a>',
      '<a href="{% comment %}x{% endcomment %}javascript:alert(1)">x</a>',
      // Комментарий с кавычкой внутри не сдвигает границы атрибута
      '<a href="java{% comment %}"{% endcomment %}script:alert(1)">x</a>',
      // Raw внутри комментария — часть комментария
      '<a href="java{% comment %}{% raw %}x{% endraw %}{% endcomment %}script:alert(1)">x</a>',
      '<img src="x" alt="" onerror="{% # c %}alert(1)">',
    ]
    for (const template of bad) {
      expect(templateErrors(template).length, template).toBeGreaterThan(0)
    }
    expect(templateErrors('<p>a</p>\n<a href="java{% # c %}script:alert(1)">x</a>')[0]?.line).toBe(
      2,
    )
    // Безопасное значение с комментарием — не ошибка; вывод рядом с комментарием — всё ещё вывод
    expect(templateErrors('<a href="/{% comment %}x{% endcomment %}page">x</a>')).toEqual([])
    expect(templateErrors('<a href="{% # c %}{{ url }}">x</a>')).toEqual([])
    // Текст в комментарии со скобками Liquid не считается выводом: значение известно целиком
    expect(
      templateErrors('<a href="{% comment %}{{ x }}{% endcomment %}javascript:a">x</a>').length,
    ).toBeGreaterThan(0)
  })

  it('тег Liquid вплотную к имени атрибута склеил бы имя — ошибка со строкой', () => {
    const bad = [
      '<a h{% raw %}{% endraw %}ref="javascript:alert(1)">x</a>',
      '<a h{% if true %}{% endif %}ref="javascript:alert(1)">x</a>',
      '<a h{% comment %}x{% endcomment %}ref="javascript:alert(1)">x</a>',
      '<a h{% # c %}ref="javascript:alert(1)">x</a>',
      '<img src="x" alt="" on{% if true %}{% endif %}error="alert(1)">',
      '<input disabled{% if on %}checked{% endif %}>',
    ]
    for (const template of bad) {
      const found = templateErrors(template)
      expect(found.length, template).toBeGreaterThan(0)
      expect(found.map((one) => one.message).join('|'), template).toMatch(
        /вплотную к имени атрибута/,
      )
    }
    expect(templateErrors('<p>a</p>\n<a h{% if 1 %}{% endif %}ref="/x">x</a>')[0]?.line).toBe(2)
    // Обычные записи: тег после пробела или кавычки, тег вокруг целого атрибута
    for (const template of [
      '<a class="a" {% if on %}id="x-menu"{% endif %}>x</a>',
      '<a class="a"{% if on %} id="x-menu"{% endif %}>x</a>',
      '<a {% if on %}class="a"{% endif %}>x</a>',
      '<input type="checkbox"{% if on %} checked{% endif %}>',
      '<a href="/{% if on %}a{% endif %}">x</a>',
    ]) {
      expect(templateErrors(template), template).toEqual([])
    }
  })

  // Что LiquidJS выводит на самом деле: тест ниже держит это допущение под проверкой
  const output = (template: string) =>
    renderTemplate(template, { title: 't' }, { media: {}, priority: false })

  it('срез пробелов {%- и -%} склеивает имя атрибута: проверка читает его так же, как Liquid', () => {
    const bad = [
      '<a h {%- if true -%}{%- endif -%} ref="javascript:alert(1)">x</a>',
      '<a h {%- # c -%} ref="javascript:alert(1)">x</a>',
      '<a h {%- comment -%}x{%- endcomment -%} ref="javascript:alert(1)">x</a>',
      '<a h {%- raw %}{% endraw -%} ref="javascript:alert(1)">x</a>',
      '<img src="x" alt="" on {%- if true -%}{%- endif -%} error="alert(1)">',
      '<div st {%- if true -%}{%- endif -%} yle="color:red">x</div>',
      // Срез только с одной стороны: пробел после тега уходит, перед ним — нет
      '<a h{% if true %}{% endif -%} ref="javascript:alert(1)">x</a>',
    ]
    for (const template of bad) {
      const found = templateErrors(template)
      expect(found.length, template).toBeGreaterThan(0)
      expect(found.map((one) => one.message).join('|'), template).toMatch(
        /вплотную к имени атрибута/,
      )
      // Допущение: Liquid и правда склеивает имя (а не оставляет два атрибута), и на сайте
      // склеенное вырезает очистка
      expect(output(template), template).toMatch(/\b(?:href|onerror|style)=/)
      expect(sanitizeHtml(output(template)), template).not.toMatch(/\b(?:href|onerror|style)=/)
    }
    expect(templateErrors('<p>a</p>\n<a h {%- if 1 -%}{%- endif -%} ref="/x">x</a>')[0]?.line).toBe(
      2,
    )
    // Перевод строки LiquidJS не срезает (greedy: false): это два атрибута, склейки нет
    const apart = '<a h\n  {%- if true -%}\n  {%- endif -%}\n  ref="javascript:alert(1)">x</a>'
    expect(output(apart)).not.toContain('href=')
    expect(templateErrors(apart)).toEqual([])
    // Имя элемента через срез пробелов — тоже собирается: <script> проверка видит
    expect(templateErrors('<scr {%- if t -%}{%- endif -%} ipt>x</script>')[0]?.message).toMatch(
      /script/,
    )
    // Законный срез пробелов: между атрибутами и вокруг целого атрибута
    for (const template of [
      '<a class="a" {%- if on %} id="x-menu"{% endif %}>x</a>',
      '<a class="a"\n  {%- if on %} id="x-menu"{% endif %}>x</a>',
      '<a class="a" {%- if on -%} id="x-menu"{%- endif %}>x</a>',
      '<a href="/x"\n  {%- if on %}\n  class="y"\n  {%- endif %}>x</a>',
      '<a href="/{%- if on -%} a {%- endif -%}">x</a>',
    ]) {
      expect(templateErrors(template), template).toEqual([])
    }
  })

  it('javascript: в значении из любых конструкций Liquid виден при сохранении', () => {
    const bad = [
      '<a href="{% if true %}javascript:alert(1){% endif %}">x</a>',
      '<a href="{% if t %}/x{% else %}javascript:alert(1){% endif %}">x</a>',
      '<a href="{% unless t %}javascript:alert(1){% endunless %}">x</a>',
      '<a href="java{% if true %}{% endif %}script:alert(1)">x</a>',
      '<a href="java{% assign a = 1 %}script:alert(1)">x</a>',
      '<a href="java{% capture c %}x{% endcapture %}script:alert(1)">x</a>',
      '<a href="{% case t %}{% when 1 %}javascript:alert(1){% endcase %}">x</a>',
      '<a href="{% for i in (1..1) %}javascript:alert(1){% endfor %}">x</a>',
      '<a href="{% echo \'javascript:alert(1)\' %}">x</a>',
      '<a href="{{ \'javascript:alert(1)\' }}">x</a>',
      '<a href="{% liquid\n  echo \'javascript:alert(1)\' %}">x</a>',
      // Вывод вместо пустого поля: схема собирается вокруг него
      '<a href="java{{ empty }}script:alert(1)">x</a>',
      '<a href="javascript:{{ title }}">x</a>',
      '<img src="{% if t %}data:text/html,x{% endif %}" alt="">',
      '<svg><use href="{% if t %}javascript:alert(1){% endif %}"/></svg>',
    ]
    for (const template of bad) {
      const found = templateErrors(template)
      expect(found.length, template).toBeGreaterThan(0)
      expect(found.map((one) => one.message).join('|'), template).toMatch(/запрещена/)
    }
    expect(
      templateErrors('<p>a</p>\n<a href="{% if t %}javascript:alert(1){% endif %}">x</a>')[0]?.line,
    ).toBe(2)
    // Теги в несколько строк до атрибута не сдвигают его строку
    expect(
      templateErrors(
        '{% comment %}\nа\n{% endcomment %}\n{% assign\n  a = 1 %}\n<a href="{% if t %}javascript:alert(1){% endif %}">x</a>',
      )[0]?.line,
    ).toBe(6)
    // Законные значения с теми же конструкциями — не ошибки
    for (const template of [
      '<a href="{% if t %}/x{% else %}#y{% endif %}">x</a>',
      '<a href="{% if t %}https://a.ru{% else %}tel:+70000000000{% endif %}">x</a>',
      '<a href="{% if title == \'a: b\' %}/x{% endif %}">x</a>'.replace('a: b', 'ab'),
      '<a href="{% echo \'https://a.ru\' %}">x</a>',
      '<a href="{{ title }}">x</a>',
      '<a href="mailto:{{ title }}">x</a>',
      '<a href="{{ title | link }}">x</a>',
      '<a href="{% for i in (1..2) %}/p{{ i }}{% endfor %}">x</a>',
      '<img src="{% if t %}/a.png{% else %}/b.png{% endif %}" alt="">',
      '{% for i in (1..2) %}<a href="/p{{ i }}">{{ i }}</a>{% endfor %}',
      '<a title="{% if t %}javascript: это просто текст{% endif %}" href="/x">x</a>',
    ]) {
      expect(templateErrors(template), template).toEqual([])
    }
    // Что подставят данные поля, при сохранении не известно: это чистит сайт при рендере
    expect(sanitizeHtml(output('<a href="{{ title }}">x</a>'))).toBe('<a href="t">x</a>')
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>')
  })

  // Ошибки про ссылку в определении целиком (с пробным рендером и вычислением констант)
  const linkErrors = (template: string, input: Partial<CustomBlockDraftInput> = {}) =>
    errors({ template, ...input })
      .map((one) => one.message)
      .filter((message) => /Ссылка|запрещена/.test(message))

  it('текст после необязательного блока тоже может начинать значение адреса', () => {
    const bad = [
      '<a href="{% if a %}/{% endif %}javascript:alert(1)">x</a>',
      '<a href="{% if a %}{% else %}/{% endif %}javascript:alert(1)">x</a>',
      '<a href="{% unless a %}/{% endunless %}javascript:alert(1)">x</a>',
      '<a href="{% case a %}{% when 1 %}/{% endcase %}javascript:alert(1)">x</a>',
      '<a href="{% for i in (1..1) %}/{% endfor %}javascript:alert(1)">x</a>',
      '<img src="{% if a %}/{% endif %}data:text/html,x" alt="">',
      // Обе половинки схемы — в разных блоках и во вложенном
      '<a href="{% if a %}java{% endif %}{% if b %}script:{% endif %}alert(1)">x</a>',
      '<a href="{% if a %}ja{% if b %}va{% endif %}script:alert(1){% endif %}">x</a>',
      // Схема через сущность и с пробелами и заглавными
      '<a href="{% if a %}&#106;avascript:alert(1){% endif %}">x</a>',
      '<a href="{% if a %}/{% endif %}  JavaScript:alert(1)">x</a>',
      // Второй адрес srcset после необязательного куска
      '<img srcset="/a.png 1x, {% if a %}/b.png 2x, {% endif %}javascript:alert(1) 3x" alt="">',
      // Запятая без пробела начинает следующий адрес, пока предыдущий ещё не определил схему
      '<img srcset="a.png,{{ title }}javascript:alert(1) 2x" alt="">',
    ]
    for (const template of bad) {
      const found = templateErrors(template)
      expect(found.length, template).toBeGreaterThan(0)
      expect(found.map((one) => one.message).join('|'), template).toMatch(/запрещена/)
    }
    expect(
      templateErrors('<p>a</p>\n<a href="{% if a %}/{% endif %}javascript:x">x</a>')[0]?.line,
    ).toBe(2)
    // Законные значения: схема определена безопасная или её нет
    for (const template of [
      '<a href="{% if a %}/{% endif %}page">x</a>',
      '<a href="{% if a %}https://{% endif %}example.com">x</a>',
      '<a href="{% if a %}/{% endif %}{{ title }}">x</a>',
      '<a href="/search?q={% if a %}site:x{% endif %}">x</a>',
      '<a href="{% if a %}#{% endif %}x">x</a>',
      '<a href="{% if a %}mailto:{% endif %}{{ title }}">x</a>',
      '<a href="{% unless a %}tel:+70000000000{% endunless %}">x</a>',
      '<img srcset="{% for i in (1..2) %}/a{{ i }}.png {{ i }}x, {% endfor %}" alt="">',
      '<img srcset="/a.png 1x, {% if a %}/b.png 2x, {% endif %}/c.png 3x" alt="">',
    ]) {
      expect(templateErrors(template), template).toEqual([])
    }
  })

  it('строка в теге подставляется в известный текст адреса, а не проверяется отдельно', () => {
    const bad = [
      '<a href="{{ \'javascript\' }}:alert(1)">x</a>',
      '<a href="{{ title | default: \'javascript\' }}:alert(1)">x</a>',
      "<a href=\"{{ 'javas' | append: 'cript' | append: ':alert(1)' }}\">x</a>",
      "<a href=\"{{ 'cript:alert(1)' | prepend: 'javas' }}\">x</a>",
      '<a href="{% echo \'java\' %}script:alert(1)">x</a>',
      '<a href="{% if title %}{{ \'javascript\' }}{% endif %}:alert(1)">x</a>',
    ]
    for (const template of bad) expect(linkErrors(template).length, template).toBeGreaterThan(0)
    // Константы до элемента: assign и capture, в том числе в ветке, мимо которой идёт пример
    const constants = [
      '{% assign u = \'javascript:alert(1)\' %}<a href="{{ u }}">x</a>',
      '{% capture u %}javascript:alert(1){% endcapture %}<a href="{{ u }}">x</a>',
      "{% assign u = 'javas' | append: 'cript:alert(1)' %}<a href=\"{{ u }}\">x</a>",
      '{% assign s = \'javascript\' %}<a href="{{ s }}:alert(1)">x</a>',
      "{% if title == 'нет' %}{% assign u = 'javascript:alert(1)' %}{% endif %}<a href=\"{% if title == 'нет' %}{{ u }}{% endif %}\">x</a>",
      '{% liquid\n  assign u = \'javascript:alert(1)\' %}<a href="{{ u }}">x</a>',
      "{% if title == 'нет' %}{% capture u %}javascript:alert(1){% endcapture %}{% endif %}<a href=\"{% if title == 'нет' %}{{ u }}{% endif %}\">x</a>",
    ]
    for (const template of constants) {
      expect(linkErrors(template).length, template).toBeGreaterThan(0)
    }
    // Законные константы и вычисления: безопасная схема, replace, который убирает опасную
    for (const template of [
      '{% assign u = \'/a\' %}<a href="{{ u }}">x</a>',
      '<a href="{{ title | default: \'/x\' }}">x</a>',
      '<a href="{{ title | prepend: \'tel:\' }}">x</a>',
      "<a href=\"{{ title | replace: 'javascript:', '' }}\">x</a>",
      '<a href="{{ \'https\' }}://a.ru">x</a>',
      '<a href="{{ title | append: \': \' }}">x</a>',
    ]) {
      expect(linkErrors(template), template).toEqual([])
    }
  })

  it('пробный рендер: опасный адрес в примере — ошибка при сохранении', () => {
    const loop = '{% for plan in plans %}<a href="{{ plan.url }}">{{ plan.name }}</a>{% endfor %}'
    // Адрес — из данных примера: так он выглядит на сайте до очистки
    const found = linkErrors(loop, {
      example: { title: 'Тарифы', plans: [{ name: 'Про', url: 'javascript:alert(1)' }] },
    })
    expect(found.join('|')).toMatch(/javascript:alert\(1\)/)
    expect(found.join('|')).toMatch(/на сайте это будет убрано/)
    // Тот же шаблон с безопасным примером — без ошибок
    expect(
      linkErrors(loop, { example: { title: 'Тарифы', plans: [{ name: 'Про', url: '/pro' }] } }),
    ).toEqual([])
    // Пример идёт мимо ветки, а при пустых полях она выполняется: адрес из списка констант;
    // статическая проверка видит его по переменным assign и for, а пробный рендер ту же ссылку
    // не повторяет
    const hidden =
      "{% unless title %}{% assign urls = 'javascript:alert(1)' | split: ',' %}" +
      '{% for u in urls %}<a href="{{ u }}">x</a>{% endfor %}{% endunless %}'
    expect(linkErrors(hidden)).toHaveLength(1)
    expect(linkErrors(hidden).join('|')).toMatch(/javascript:/)
    // Ошибка про ссылку одна: статическая проверка уже нашла, пробный рендер её не повторяет
    expect(linkErrors('<a href="javascript:alert(1)">x</a>')).toHaveLength(1)
  })

  it('атрибут, который браузер отбросит как повтор, проверяется отдельно', () => {
    const bad = [
      '<a {% if a %}href="/x"{% else %}href="javascript:alert(1)"{% endif %}>x</a>',
      '<a href="/x" href="javascript:alert(1)">x</a>',
      '<a href="/x" href="{% if t %}javascript:alert(1){% endif %}">x</a>',
      '<a href="/x"\n  href=\'javascript:alert(1)\'>x</a>',
      '<a href="/x" href=javascript:alert(1)>x</a>',
      '<a href="/x" href="&#106;avascript:alert(1)">x</a>',
      '<img src="/a.png" alt="" src="data:text/html,x">',
      '<a {% if a %}onclick="x"{% else %}onclick="y"{% endif %} href="/x">x</a>',
    ]
    for (const template of bad) {
      expect(templateErrors(template).length, template).toBeGreaterThan(0)
    }
    expect(templateErrors('<a href="/x" href="javascript:alert(1)">x</a>')[0]?.message).toMatch(
      /запрещена/,
    )
    expect(
      templateErrors('<p>a</p>\n<a href="/x"\n  href="javascript:alert(1)">x</a>')[0]?.line,
    ).toBe(3)
    // Допущение: парсер и правда читает первый href, а второй отбрасывает
    expect(sanitizeHtml('<a href="/x" href="javascript:alert(1)">x</a>')).toBe('<a href="/x">x</a>')
    // Повтор безобидного атрибута и безопасные варианты в ветках — не ошибка
    for (const template of [
      '<a {% if a %}class="x"{% else %}class="y"{% endif %} href="/x">x</a>',
      '<a href="/x" class="a" class="b">x</a>',
      '<a {% if a %}href="/x"{% else %}href="#y"{% endif %}>x</a>',
    ]) {
      expect(templateErrors(template), template).toEqual([])
    }
  })

  it('символ вывода в проверке записан escape-последовательностью, а не невидимым знаком', () => {
    const file = './html.ts'
    const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
    expect(source).toContain("OUTPUT_MARK = '\\uE000'")
    expect(source).not.toContain('\uE000')
    // Такой же знак в самом шаблоне не принимается за место вывода
    expect(templateErrors('<a href="java\uE000script:x">x</a>')).toEqual([])
    expect(templateErrors('<a href="{% if a %}x\uE000{% endif %}/page">x</a>')).toEqual([])
  })

  it('адрес без кавычек, собранный из кусков, — ошибка про ссылку, а не про склейку имени', () => {
    const found = templateErrors('<a href=java{% comment %}x{% endcomment %}script:alert(1)>x</a>')
    expect(found.length).toBeGreaterThan(0)
    expect(found[0]?.message).toMatch(/Ссылка/)
    expect(found.map((one) => one.message).join('|')).not.toMatch(/вплотную к имени/)
    // Безопасный адрес без кавычек и комментарий в нём — не ошибка
    expect(templateErrors('<a href=/a{% comment %}x{% endcomment %}b>x</a>')).toEqual([])
  })

  // Поля с «ветвящимся» условием: пример (a = «q») и пустые поля идут мимо ветки a == 'zz'
  const branchFields: CustomBlockDraftInput['fields'] = [
    { type: 'text', name: 'title', label: 'Заголовок', required: true },
    { type: 'text', name: 'a', label: 'A' },
  ]
  const branchLinkErrors = (template: string) =>
    linkErrors(template, { fields: branchFields, example: { title: 't', a: 'q' } })

  it('javascript: из констант в ветках, мимо которых идут пример и пустые поля, виден при сохранении', () => {
    const bad = [
      // Побеждает не последний assign: любое значение из любой ветки могло оказаться в переменной
      "{% if a == 'zz' %}{% assign u = 'javascript:alert(1)' %}{% else %}{% assign u = '/' %}{% endif %}<a href=\"{{ u }}\">x</a>",
      "{% if a == 'zz' %}{% assign u = 'javascript:alert(1)' %}{% endif %}{% if a != 'zz' %}{% assign u = '/' %}{% endif %}<a href=\"{{ u }}\">x</a>",
      // capture с ветками: текст каждой ветки — вариант значения
      '{% capture u %}{% if a == \'zz\' %}javascript:alert(1){% else %}/{% endif %}{% endcapture %}<a href="{{ u }}">x</a>',
      '{% capture u %}{% if a == \'zz\' %}/{% else %}javascript:alert(1){% endif %}{% endcapture %}<a href="{{ u }}">x</a>',
      // liquid и echo: строки в кавычках берутся всегда, а не только когда вычисление упало
      "<a href=\"{% liquid\nif a == 'zz'\necho 'javascript:alert(1)'\nendif %}\">x</a>",
      "{% liquid\nif a == 'zz'\nassign u = 'javascript:alert(1)'\nendif %}<a href=\"{{ u }}\">x</a>",
      "{% liquid\nif a == 'zz'\ncapture u\necho 'javascript:alert(1)'\nendcapture\nendif %}<a href=\"{{ u }}\">x</a>",
      // Переменная цикла берёт значения из коллекции, собранной в ветке
      "{% if a == 'zz' %}{% assign us = 'javascript:alert(1)' | split: ',' %}{% for u in us %}<a href=\"{{ u }}\">x</a>{% endfor %}{% endif %}",
      // Сущность разорвана ветками: схему читают по склеенному значению
      '<a href="&#{% if a == \'zz\' %}106{% else %}47{% endif %};avascript:alert(1)">x</a>',
      '<a href="java&#115;cript&colon;alert(1)">x</a>',
      '<a href="{% if a %}&#106;{% endif %}avascript&Tab;:alert(1)">x</a>',
      // Через переменную в переменной и через фильтры над константой в ветке
      "{% if a == 'zz' %}{% assign u = 'javascript:alert(1)' %}{% endif %}{% assign v = u %}<a href=\"{{ v }}\">x</a>",
      "{% if a == 'zz' %}{% assign u = 'java' | append: 'script:alert(1)' %}{% endif %}<a href=\"{{ u }}\">x</a>",
      "{% if a == 'zz' %}{% assign u = 'java|script:alert(1)' | remove: '|' %}{% endif %}<a href=\"{{ u }}\">x</a>",
      '{% if a == \'zz\' %}{% assign u = \'data:text/html,x\' %}{% endif %}<img src="{{ u }}" alt="">',
    ]
    for (const template of bad) {
      const found = branchLinkErrors(template)
      expect(found.length, template).toBeGreaterThan(0)
      expect(found.join('|'), template).toMatch(/запрещена/)
    }
    // Строка ошибки — строка атрибута
    const lined = errors({
      template:
        "<p>a</p>\n{% if a == 'zz' %}{% assign u = 'javascript:alert(1)' %}{% endif %}\n<a href=\"{{ u }}\">x</a>",
      fields: branchFields,
      example: { title: 't', a: 'q' },
    }).find((one) => /запрещена/.test(one.message))
    expect(lined?.line).toBe(3)
    // Законные: безопасные константы во всех ветках, опасная схема только как текст или как то,
    // что убирает replace, самоссылка capture, «&» в запросе адреса
    for (const template of [
      "{% if a == 'zz' %}{% assign u = '/a' %}{% else %}{% assign u = '#b' %}{% endif %}<a href=\"{{ u }}\">x</a>",
      '{% capture u %}{% if a == \'zz\' %}/a{% else %}tel:+70000000000{% endif %}{% endcapture %}<a href="{{ u }}">x</a>',
      "{% assign u = title | replace: 'javascript:', '' %}<a href=\"{{ u }}\">x</a>",
      '{% assign label = \'javascript: the good parts\' %}<p>{{ label }}</p><a href="/x">x</a>',
      "<a href=\"{% liquid\nif a == 'javascript:'\necho '/'\nendif %}\">x</a>",
      '{% capture u %}{{ u }}x{% endcapture %}<a href="{{ u }}">x</a>',
      '{% for u in (1..2) %}<a href="/p{{ u }}">x</a>{% endfor %}',
      '<a href="/s?x=1&{% if a %}y=2{% endif %}&amp;z=3">x</a>',
    ]) {
      expect(branchLinkErrors(template), template).toEqual([])
    }
  })

  it('проверка не рендерит шаблон на каждый вывод: один рендер и ограниченное число вычислений', () => {
    // Вывод в адресе — вычисление один раз на весь шаблон (с метками вокруг выводов) и не
    // больше двухсот отдельных выражений
    const calls: string[] = []
    const evaluate = (source: string) => {
      calls.push(source)
      return undefined
    }
    const many = Array.from({ length: 300 }, (_, i) => `<a href="{{ title | default: 'x${i}' }}">`)
    checkTemplateHtml(many.join(''), { evaluate })
    expect(calls.length).toBeLessThanOrEqual(201)
    expect(calls[0]).toContain('')
    // Без вывода в адресе вычислений нет
    calls.length = 0
    checkTemplateHtml('<p>{{ title }}</p><a href="/x">x</a>', { evaluate })
    expect(calls).toEqual([])
    // Значения выводов приходят из одного рендера: переменная из assign до вывода
    expect(
      linkErrors('{% assign u = \'javascript:alert(1)\' %}<a href="{{ u }}">x</a>').length,
    ).toBeGreaterThan(0)
  })

  it('тяжёлая преамбула и сотни выводов в адресе не вешают проверку', () => {
    const heavy =
      '{% capture c %}{% for i in (1..3000) %}{% for j in (1..3000) %}{% endfor %}{% endfor %}{% endcapture %}'
    const template = `${heavy}<a href="${'{{ title }}'.repeat(300)}">x</a>`
    const started = Date.now()
    const found = errors({ template })
    // Каждый рендер упирается в лимит (200 мс); раньше вывод стоил рендера, и выходили минуты
    expect(Date.now() - started).toBeLessThan(3000)
    expect(found.map((one) => one.message).join('|')).toMatch(/слишком долго/)
    // Лимит исчерпан один раз — больше шаблон не рендерится: ни вычислений, ни рендера на пустых
    // полях. Пример не рендерится (его нет): то же самое после первого вычисления
    const spy = vi.spyOn(liquid, 'renderSync')
    try {
      customBlockProblems(define({ template }))
      expect(spy).toHaveBeenCalledTimes(1)
      spy.mockClear()
      const noExample = Date.now()
      customBlockProblems({ ...define({ template }), example: {} })
      expect(spy).toHaveBeenCalledTimes(1)
      expect(Date.now() - noExample).toBeLessThan(3000)
    } finally {
      spy.mockRestore()
    }
  })

  it('javascript: из константы, над которой в выводе стоит фильтр, виден при сохранении', () => {
    const bad = [
      // Константа задана в ветке, мимо которой идёт пример; фильтр в выводе собирает схему
      "{% if title == 'zz' %}{% assign u = 'javascriptxalert(1)' %}{% endif %}<a href=\"{{ u | replace: 'x', ':' }}\">x</a>",
      "{% if title == 'zz' %}{% assign u = 'javascript%3Aalert(1)' %}{% endif %}<a href=\"{{ u | url_decode }}\">x</a>",
      "{% if title == 'zz' %}{% assign u = 'amF2YXNjcmlwdDphbGVydCgxKQ==' %}{% endif %}<a href=\"{{ u | base64_decode }}\">x</a>",
      // Массив из split: берётся элемент
      "{% if title == 'zz' %}{% assign u = '/,javascript:alert(1)' | split: ',' %}{% endif %}<a href=\"{{ u | last }}\">x</a>",
      "{% if title == 'zz' %}{% assign u = '/,javascript:alert(1)' | split: ',' %}{% endif %}<a href=\"{{ u[1] }}\">x</a>",
      // capture с веткой и тот же фильтр
      '{% capture u %}{% if title == \'zz\' %}javascript%3Aalert(1){% endif %}{% endcapture %}<a href="{{ u | url_decode }}">x</a>',
      // То же внутри {% liquid %}
      "{% liquid\nif title == 'zz'\nassign u = 'javascriptxalert(1)'\nendif %}<a href=\"{{ u | replace: 'x', ':' }}\">x</a>",
      "{% liquid\nif title == 'zz'\ncapture u\necho 'javascript%3Aalert(1)'\nendcapture\nendif %}<a href=\"{{ u | url_decode }}\">x</a>",
      // Переменная цикла
      "{% if title == 'zz' %}{% assign us = '/,javascript:alert(1)' | split: ',' %}{% endif %}{% for u in us %}<a href=\"{{ u | upcase }}\">x</a>{% endfor %}",
    ]
    for (const template of bad) {
      const found = branchLinkErrors(template)
      expect(found.length, template).toBeGreaterThan(0)
      expect(found.join('|'), template).toMatch(/запрещена/)
    }
    // Законные: те же фильтры над безопасными значениями
    for (const template of [
      "{% if title == 'zz' %}{% assign u = 'x/a' %}{% endif %}<a href=\"{{ u | replace: 'x', '/' }}\">x</a>",
      '{% assign u = \'%2Fa\' %}<a href="{{ u | url_decode }}">x</a>',
      "{% assign u = '/a,/b' | split: ',' %}<a href=\"{{ u | last }}\">x</a>",
    ]) {
      expect(branchLinkErrors(template), template).toEqual([])
    }
  })

  it('javascript: из фильтра в промежуточном assign виден, даже если вывод голый', () => {
    const bad = [
      "{% if title == 'zz' %}{% assign p = 'javascriptxalert(1)' %}{% endif %}{% assign u = p | replace: 'x', ':' %}<a href=\"{{ u }}\">x</a>",
      "{% if title == 'zz' %}{% assign p = 'javascript%3Aalert(1)' %}{% endif %}{% assign u = p | url_decode %}<a href=\"{{ u }}\">x</a>",
      "{% if title == 'zz' %}{% assign p = 'javascript' %}{% endif %}{% assign u = p | append: ':alert(1)' %}<a href=\"{{ u }}\">x</a>",
      "{% if title == 'zz' %}{% assign p = 'alert(1)' %}{% endif %}{% assign u = p | prepend: 'javascript:' %}<a href=\"{{ u }}\">x</a>",
      // Через ещё одну переменную без фильтра
      "{% if title == 'zz' %}{% assign p = 'javascriptxalert(1)' %}{% endif %}{% assign u = p | replace: 'x', ':' %}{% assign v = u %}<a href=\"{{ v }}\">x</a>",
    ]
    for (const template of bad) {
      const found = branchLinkErrors(template)
      expect(found.join('|'), template).toMatch(/запрещена/)
    }
    for (const template of [
      "{% if title == 'zz' %}{% assign p = 'x/a' %}{% endif %}{% assign u = p | replace: 'x', '/' %}<a href=\"{{ u }}\">x</a>",
      "{% if title == 'zz' %}{% assign p = '%2Fa' %}{% endif %}{% assign u = p | url_decode %}<a href=\"{{ u }}\">x</a>",
    ]) {
      expect(branchLinkErrors(template), template).toEqual([])
    }
  })

  it('javascript: доходит до адреса через алиас, цепочку фильтров, capture и цикл в ветке', () => {
    const branch = (inside: string) => `{% if title == 'zz' %}${inside}{% endif %}`
    const bad = [
      // (1) алиас перед фильтром
      `${branch("{% assign p = 'javascriptxalert(1)' %}")}{% assign q = p %}{% assign u = q | replace: 'x', ':' %}<a href="{{ u }}">x</a>`,
      // (2) два шага с фильтрами
      `${branch("{% assign p = ' javascriptxalert(1)' %}")}{% assign q = p | strip %}{% assign u = q | replace: 'x', ':' %}<a href="{{ u }}">x</a>`,
      // Длинная цепочка из шагов без фильтра между ними
      `${branch("{% assign p = 'javascriptxalert(1)' %}")}{% assign a1 = p %}{% assign a2 = a1 %}{% assign a3 = a2 %}{% assign u = a3 | replace: 'x', ':' %}<a href="{{ u }}">x</a>`,
      // (3) база — capture в ветке
      `${branch('{% capture p %}javascriptxalert(1){% endcapture %}')}{% assign u = p | replace: 'x', ':' %}<a href="{{ u }}">x</a>`,
      // capture, собранный из переменной, а не из текста
      `${branch("{% assign p = 'javascriptxalert(1)' %}")}{% capture q %}{{ p }}{% endcapture %}{% assign u = q | replace: 'x', ':' %}<a href="{{ u }}">x</a>`,
      // (4) переменная цикла
      `${branch("{% assign ps = 'javascriptxalert(1),b' | split: ',' %}")}{% for p in ps %}{% assign u = p | replace: 'x', ':' %}<a href="{{ u }}">x</a>{% endfor %}`,
      `${branch("{% assign ps = 'javascriptxalert(1),b' | split: ',' %}")}{% for p in ps %}<a href="{{ p | replace: 'x', ':' }}">x</a>{% endfor %}`,
      // Цикл по переменной, заданной через алиас
      `${branch("{% assign ps0 = 'javascriptxalert(1),b' | split: ',' %}")}{% assign ps = ps0 %}{% for p in ps %}{% assign u = p | replace: 'x', ':' %}<a href="{{ u }}">x</a>{% endfor %}`,
      // Переменная в {% liquid %}
      `${branch("{% assign p = 'javascriptxalert(1)' %}")}{% liquid
assign q = p
assign u = q | replace: 'x', ':'
%}<a href="{{ u }}">x</a>`,
    ]
    for (const template of bad) {
      const found = branchLinkErrors(template)
      expect(found.join('|'), template).toMatch(/запрещена/)
    }
    // Законные: те же цепочки над безопасными значениями, цикл и алиасы без опасной схемы
    for (const template of [
      `${branch("{% assign p = 'x/a' %}")}{% assign q = p %}{% assign u = q | replace: 'x', '/' %}<a href="{{ u }}">x</a>`,
      `${branch('{% capture p %}x/a{% endcapture %}')}{% assign u = p | replace: 'x', '/' %}<a href="{{ u }}">x</a>`,
      `${branch("{% assign ps = 'x/a,b' | split: ',' %}")}{% for p in ps %}<a href="{{ p | replace: 'x', '/' }}">x</a>{% endfor %}`,
      '{% assign p = \'/a\' %}{% assign q = p %}{% assign u = q | strip %}<a href="{{ u }}">x</a>',
    ]) {
      expect(branchLinkErrors(template), template).toEqual([])
    }
  })

  it('итог, оборванный временем или лимитом движка, помечен: его нельзя запоминать', () => {
    const template = "{% assign u = '/a' %}<a href=\"{{ u | append: 'b' }}\">x</a>"
    // Бюджет вычислений по времени истёк посреди проверки (пауза сборщика мусора, соседний запрос)
    const real = Date.now.bind(Date)
    let calls = 0
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => real() + calls++ * 1000)
    const late = { hit: false }
    try {
      customBlockProblems(define({ template }), { timeLimit: late })
    } finally {
      spy.mockRestore()
    }
    expect(late.hit).toBe(true)
    // Без задержки флаг не ставится: итог зависит только от шаблона
    const quiet = { hit: false }
    customBlockProblems(define({ template }), { timeLimit: quiet })
    expect(quiet.hit).toBe(false)
    // Предел рендера движка (200 мс по часам) — тоже время: пробный рендер и вычисления
    const heavy =
      '{% capture c %}{% for i in (1..3000) %}{% for j in (1..3000) %}{% endfor %}{% endfor %}{% endcapture %}<a href="{{ title }}">x</a>'
    const slow = { hit: false }
    expect(
      customBlockProblems(define({ template: heavy }), { timeLimit: slow })
        .map((problem) => problem.message)
        .join('|'),
    ).toMatch(/слишком долго/)
    expect(slow.hit).toBe(true)
    const noExample = { hit: false }
    const withoutExample = customBlockProblems(
      { ...define({ template: heavy }), example: {} },
      { timeLimit: noExample },
    )
    expect(noExample.hit).toBe(true)
    // Рендер на пустых полях упёрся в лимит, вычислять нечем — адрес из поля не проверен: честно
    // об этом, а не тишина
    expect(withoutExample.map((problem) => problem.message).join('|')).toMatch(/слишком хитро/)
    // Лимит исчерпан, вычислять нечем, а адрес собран Liquid: «слишком хитро», а не тишина
    const exhaustedLink = (exhausted: boolean) =>
      checkTemplateHtml(template, { evaluate: () => '', exhausted: () => exhausted }).map(
        (problem) => problem.message,
      )
    expect(exhaustedLink(true).join('|')).toMatch(/слишком хитро/)
    expect(exhaustedLink(false)).toEqual([])
  })

  it('враждебные графы переменных считаются за доли секунды и не молчат', () => {
    const quick = (template: string) => {
      const started = Date.now()
      const found = errors({ template, fields: branchFields, example: { title: 't', a: 'q' } })
      return { ms: Date.now() - started, messages: found.map((one) => one.message).join('|') }
    }
    // Ромбы: каждая переменная — два определения над двумя предыдущими
    const diamonds = Array.from(
      { length: 40 },
      (_, i) =>
        `{% if a == 'zz' %}{% assign v${i + 1} = v${i} | append: v${i} %}{% else %}{% assign v${i + 1} = v${i} | prepend: 'x' %}{% endif %}`,
    ).join('')
    const diamond = quick(`{% assign v0 = '/a' %}${diamonds}<a href="{{ v40 }}">x</a>`)
    expect(diamond.ms).toBeLessThan(2000)
    // Накопление в себя: неподвижной точки нет — честный отказ, а не тишина
    const grow = quick(
      "{% assign u = '/a' %}{% for i in (1..3) %}{% assign u = u | append: 'b' %}{% endfor %}<a href=\"{{ u }}\">x</a>",
    )
    expect(grow.ms).toBeLessThan(2000)
    expect(grow.messages).toMatch(/слишком хитро/)
    // А переменная, не связанная с растущей, не страдает
    const apart = quick(
      "{% assign u = '/a' %}{% assign w = 'x' %}{% for i in (1..3) %}{% assign w = w | append: 'b' %}{% endfor %}<a href=\"{{ u }}\">x</a><p class=\"{{ w }}\">x</p>",
    )
    expect(apart.messages).not.toMatch(/хитро/)
    // Много переменных с вариантами в одном адресе: сочетаний больше предела
    const wide = Array.from(
      { length: 12 },
      (_, i) =>
        `{% if a == 'zz' %}{% assign w${i} = 'p${i}' %}{% else %}{% assign w${i} = 'q${i}' %}{% endif %}`,
    ).join('')
    const refs = Array.from({ length: 12 }, (_, i) => `{{ w${i} }}`).join('')
    const many = quick(
      `${wide}<a href="/x{{ '' | append: w0 | append: w1 | append: w2 | append: w3 | append: w4 | append: w5 }}${refs}">x</a>`,
    )
    expect(many.ms).toBeLessThan(2000)
  })

  it('не-адресные атрибуты со значением из ветки проверяются так же, как без Liquid', () => {
    const all = (template: string) =>
      errors({ template, fields: branchFields, example: { title: 't', a: 'q' } }).map(
        (one) => one.message,
      )
    const found = (template: string) => all(template).join('|')
    // fill с внешним файлом, tabindex > 0, id совпал с переменной скриптов, ссылка на чужой id
    expect(
      found('<svg><rect fill="{% if a == \'zz\' %}url(https://e.x/a){% endif %}"/></svg>'),
    ).toMatch(/url()/)
    expect(found('<p tabindex="{% if a == \'zz\' %}5{% endif %}">x</p>')).toMatch(/tabindex/)
    expect(found('{% assign n = \'5\' %}<p tabindex="{{ n }}">x</p>')).toMatch(/tabindex/)
    expect(found('<p id="{% if a == \'zz\' %}menu{% endif %}">x</p>')).toMatch(/id «menu»/)
    expect(
      found('<button popovertarget="{% if a == \'zz\' %}site-menu{% endif %}">x</button>'),
    ).toMatch(/popovertarget="site-menu"/)
    // Законные: то же значение допустимо, ссылка на id из шаблона, вывод с id из данных
    for (const template of [
      '<svg><rect fill="{% if a == \'zz\' %}url(#g){% endif %}"/></svg>',
      '<p tabindex="{% if a == \'zz\' %}0{% else %}-1{% endif %}">x</p>',
      '<p id="{% if a == \'zz\' %}site-box{% endif %}">x</p>',
      '<button popovertarget="{% if a == \'zz\' %}menu-box{% endif %}">x</button><div id="menu-box" popover></div>',
      '<button popovertarget="{{ block.id }}-box">x</button><div id="{{ block.id }}-box" popover></div>',
    ]) {
      expect(all(template), template).toEqual([])
    }
  })

  it('цепочка assign с двумя и тремя ссылками на предыдущий шаг считается за доли секунды', () => {
    const chain = (count: number, links: number) => {
      const refs = (i: number) => Array(links).fill(`v${i}`).join(' | default: ')
      const steps = Array.from(
        { length: count },
        (_, i) => `{% assign v${i + 1} = ${refs(i)} %}`,
      ).join('')
      return `{% assign v0 = '/a' %}${steps}<a href="{{ v${count} }}">x</a>`
    }
    for (const links of [2, 3]) {
      const template = chain(40, links)
      const started = Date.now()
      const found = errors({ template, fields: branchFields, example: { title: 't', a: 'q' } })
      expect(Date.now() - started, `ссылок ${links}`).toBeLessThan(1500)
      // Честный отказ или чистый ответ, но не зависание
      expect(found.length).toBeLessThanOrEqual(1)
    }
  })

  it('сорок безобидных адресов не съедают вычисления: опасный адрес после них найден', () => {
    const harmless = Array.from(
      { length: 70 },
      (_, i) => `<a href="{{ '/p' | append: '${i}' | upcase }}">x</a>`,
    ).join('')
    const danger =
      "{% if title == 'zz' %}{% assign u = 'javascript%3Aalert(1)' | url_decode %}{% endif %}<a href=\"{{ u }}\">x</a>"
    const found = branchLinkErrors(harmless + danger)
    expect(found.join('|')).toMatch(/запрещена/)
    expect(found.join('|')).not.toMatch(/хитро/)
    expect(branchLinkErrors(harmless)).toEqual([])
  })

  it('когда вычислений не хватило, а значение адреса нужно, — «слишком хитро», а не тишина', () => {
    // Вывод в ветке мимо пробного рендера: значение приходится вычислять каждому отдельно
    const template = Array.from(
      { length: 280 },
      (_, i) => `{% if title=='zz' %}<a href="{{'/'|append:'${i}'}}">x</a>{% endif %}`,
    ).join('')
    const found = branchLinkErrors(template)
    expect(found).toEqual([])
    const problems = errors({ template, fields: branchFields, example: { title: 't', a: 'q' } })
    const complex = problems.filter((one) => /слишком хитро/.test(one.message))
    // Одна ошибка на шаблон, а не по ошибке на каждый из двухсот восьмидесяти адресов
    expect(complex).toHaveLength(1)
  })

  // Все ошибки шаблона, в том числе «слишком хитро»: linkErrors их не показывает
  const allErrors = (template: string) =>
    errors({ template, fields: branchFields, example: { title: 't', a: 'q' } }).map(
      (one) => one.message,
    )

  it('схема адреса уже определена префиксом: счётчики и накопление не дают «слишком хитро»', () => {
    const counter =
      '{% assign n = 0 %}{% for i in (1..3) %}{% assign n = n | plus: 1 %}<h3 id="q-{{ n }}">x</h3>{% endfor %}<a href="#q-{{ n }}">последний</a>'
    const query =
      "{% assign q = '' %}{% for i in (1..3) %}{% assign q = q | append: '&p=' | append: i %}{% endfor %}"
    for (const template of [
      counter,
      `${query}<a href="/search?x=1{{ q }}">x</a>`,
      `${query}<a href="https://example.com/?{{ q }}">x</a>`,
      `${query}<a href="/p/{{ q }}">x</a>`,
      `${query}<a href="#s{{ q }}">x</a>`,
    ]) {
      expect(allErrors(template)).toEqual([])
    }
    // Без префикса накопление по-прежнему «слишком хитро»: схему определяет сам вывод
    expect(
      allErrors(
        "{% assign u = '/a' %}{% for i in (1..3) %}{% assign u = u | append: 'b' %}{% endfor %}<a href=\"{{ u }}\">x</a>",
      ).join('|'),
    ).toMatch(/хитро/)
    // Сотни ссылок с постоянным началом не тратят бюджет вычислений на выводы
    const many = Array.from(
      { length: 240 },
      (_, i) => `{% if a=='zz' %}<a href="/p/{{'x'|append:'${i}'}}">x</a>{% endif %}`,
    ).join('')
    expect(allErrors(many)).toEqual([])
  })

  it('javascript: из capture не прячется за обрезкой значения и за «%}» в тексте', () => {
    const long = 'A'.repeat(390)
    const bad = [
      // Хвост длинного capture (раньше обрезался до 400 знаков, и переменная считалась полной)
      `{% if a == 'zz' %}{% capture c %}${long}|javascriptxalert(1){% endcapture %}{% endif %}<a href="{{ c | split: '|' | last | replace: 'x', ':' }}">x</a>`,
      `{% if a == 'zz' %}{% capture p %}${long}javascriptxalert(1){% endcapture %}{% endif %}<a href="{{ p | slice: 390, 100 | replace: 'x', ':' }}">x</a>`,
      `{% if a == 'zz' %}{% capture p %}${long}javascriptxalert(1){% endcapture %}{% endif %}{% assign u = p | slice: 390, 100 | replace: 'x', ':' %}<a href="{{ u }}">x</a>`,
      // «%}» в тексте нельзя подставить в строку assign: токенизатор оборвёт её раньше кавычки
      "{% if a == 'zz' %}{% capture p %}javascriptx{% raw %}%}{% endraw %}{% endcapture %}{% endif %}<a href=\"{{ p | replace: 'x', ':' }}\">x</a>",
      "{% if a == 'zz' %}{% capture p %}javascriptxalert(1)//%}{% endcapture %}{% endif %}{% assign u = p | replace: 'x', ':' %}<a href=\"{{ u }}\">x</a>",
      "{% if a == 'zz' %}{% capture p %}javascriptxalert(1)//%}{% endcapture %}{% endif %}{% assign parts = p | split: '/' %}{% for part in parts %}<a href=\"{{ part | replace: 'x', ':' }}\">x</a>{% endfor %}",
    ]
    for (const template of bad) {
      const found = allErrors(template).join('|')
      // Либо сама ссылка названа, либо честное «слишком хитро»: тишины быть не должно
      expect(found, template.slice(0, 120)).toMatch(/запрещена|хитро/)
    }
    // Вариантов тела больше предела (десять независимых if): не тишина
    const ifs = Array.from({ length: 10 }, (_, i) => `{% if a == '${i}' %}${i}{% endif %}`).join('')
    expect(
      allErrors(
        `{% capture p %}${ifs}{% if a == 'zz' %}|javascriptxalert(1){% endif %}{% endcapture %}<a href="{{ p | split: '|' | last | replace: 'x', ':' }}">x</a>`,
      ).join('|'),
    ).toMatch(/запрещена|хитро/)
    // Короткий и обычный capture по-прежнему проверяется точно, а безопасный — без ошибок
    expect(
      allErrors(
        '{% capture p %}/a{% endcapture %}{% assign u = p | append: \'/b\' %}<a href="{{ u }}">x</a>',
      ),
    ).toEqual([])
  })

  it('вычисление не состоялось (ошибка движка): переменная неполная, а не тишина', () => {
    const template =
      "{% if a == 'zz' %}{% assign p = 'javascriptx' %}{% endif %}{% assign u = p | replace: 'x', ':' %}<a href=\"{{ u }}\">x</a>"
    const messages = (evaluate: (source: string) => string | undefined) =>
      checkTemplateHtml(template, { evaluate }).map((problem) => problem.message)
    // Движок отвечает на assign ошибкой: что в переменной, неизвестно
    expect(messages((source) => (source.includes('{% assign') ? undefined : '')).join('|')).toMatch(
      /хитро/,
    )
    // Отвечает пустотой — это значение, а не отказ
    expect(messages(() => '')).toEqual([])
  })

  it('сущность в capture на странице экранируется: «javascript&#58;» не ошибка', () => {
    const template =
      '{% if a == \'zz\' %}{% capture p %}javascript&#58;alert(1){% endcapture %}{% endif %}<a href="{{ p }}">x</a>'
    expect(allErrors(template)).toEqual([])
    // А тот же адрес в тексте шаблона браузер раскодирует: это ошибка
    expect(allErrors('<a href="javascript&#58;alert(1)">x</a>').join('|')).toMatch(/запрещена/)
  })

  it('обход значений ограничен общим пределом работы: тяжёлые шаблоны проверяются быстро', () => {
    const quick = (template: string) => {
      const started = Date.now()
      const found = errors({ template, fields: branchFields, example: { title: 't', a: 'q' } })
      return { ms: Date.now() - started, messages: found.map((one) => one.message).join('|') }
    }
    // Шаблон рецензента: 200 присваиваний с пробелами и значение из 1650 выводов (раньше 171 с)
    const spaces = ' '.repeat(40)
    const assigns = Array.from({ length: 200 }, () => `{%assign u="ab${spaces}"%}`).join('')
    const padded = `${assigns}<a href="${'{{u}}'.repeat(1650)}">x</a>`
    expect(padded.length).toBeLessThan(20_000)
    expect(quick(padded).ms).toBeLessThan(1500)
    // Разные варианты: сжатием не обойтись, работает предел
    const distinct = `${Array.from({ length: 200 }, (_, i) => `{%assign u="a${i}b"%}`).join('')}<a href="${'{{u}}'.repeat(1600)}">x</a>`
    const heavy = quick(distinct)
    expect(heavy.ms).toBeLessThan(1500)
    expect(heavy.messages).toMatch(/слишком хитро/)
    // Много адресов, у каждого свои варианты: ошибка одна, время ограничено
    const many = `${Array.from({ length: 100 }, (_, i) => `{%assign u="a${i}b"%}`).join('')}${Array.from(
      { length: 350 },
      () => '<a href="{{u}}{{u}}">x</a>',
    ).join('')}`
    const several = quick(many)
    expect(several.ms).toBeLessThan(1500)
    expect(several.messages.match(/слишком хитро/g)?.length ?? 0).toBeLessThanOrEqual(1)
  })

  it('разовые вычисления проверки не вытесняют шаблоны сайта из кеша разбора', () => {
    const state = { media: {}, priority: false }
    const site = '<p>{{ title }}</p> site-template'
    renderTemplate(site, { title: 'a' }, state)
    const spy = vi.spyOn(liquid, 'parse')
    try {
      renderTemplate(site, { title: 'a' }, state)
      expect(spy).not.toHaveBeenCalled()
      for (let i = 0; i < 100; i++) renderTemplate(`{{ ${i} }}`, {}, state, { cache: false })
      renderTemplate(site, { title: 'a' }, state)
      // Только сто разовых разборов: шаблон сайта остался в кеше
      expect(spy).toHaveBeenCalledTimes(100)
    } finally {
      spy.mockRestore()
    }
  })

  it('вывод тегов без экранирования не ломает кавычки атрибута: tablerow выключен, raw-фильтры — ошибка', () => {
    // tablerow писал <tr class="…"><td class="…"> с кавычками мимо экранирования
    const tablerow = errors({
      template:
        '<p title="{% tablerow i in (1..1) %}<script>alert(1)</script>{% endtablerow %}">x</p>',
    })
    expect(tablerow.map((one) => one.message).join('|')).toMatch(/tablerow/)
    // Фильтры с готовым HTML в значении атрибута: кавычки закрыли бы значение
    const rawErrors = (template: string) =>
      checkTemplateHtml(template).filter((problem) => problem.level === 'error')
    for (const template of [
      '<p title="{{ photo | image }}<script>alert(1)</script>">x</p>',
      '<p title="{% echo photo | image %}<iframe src=https://evil.example></iframe>">x</p>',
      '<p title="{% liquid\n  echo photo | image %}">x</p>',
      '<img alt="{{ title | accent }}" src="/a.png">',
      '<p title="{{ text | paragraphs }}">x</p>',
      '<p title="{{ text | newline_to_br }}">x</p>',
    ]) {
      const found = rawErrors(template)
      expect(found.map((one) => one.message).join('|'), template).toMatch(/выводит готовый HTML/)
    }
    expect(rawErrors('<p title="{{ photo | image }}">x</p>')[0]?.line).toBe(1)
    // Законно: те же фильтры между элементами, image_url в адресе, обычный вывод в атрибуте
    for (const template of [
      '<div>{{ photo | image }}</div>',
      '<p>{{ text | paragraphs }}</p><h2>{{ title | accent }}</h2>',
      '<img src="{{ photo | image_url }}" alt="{{ photo.alt }}">',
      '<p title="{{ title | upcase }}">x</p>',
    ]) {
      expect(rawErrors(template), template).toEqual([])
    }
    // Список «raw» в проверке совпадает с движком
    const raw = Object.entries(liquid.filters)
      .filter(([, filter]) => typeof filter === 'object' && filter.raw)
      .map(([name]) => name)
    expect([...raw].sort()).toEqual([...RAW_HTML_FILTERS].sort())
  })

  it('пробный рендер сверяется с очисткой сайта: запрещённое из данных примера — ошибка', () => {
    const fields: CustomBlockDraftInput['fields'] = [
      { type: 'text', name: 'title', label: 'Заголовок', required: true },
      { type: 'text', name: 'pic', label: 'Адрес картинки' },
    ]
    const found = (template: string, example: Record<string, unknown>) =>
      errors({ template, fields, example }).map((one) => one.message)
    // Чужой адрес картинки из примера очистка убрала бы
    expect(
      found('<img src="{{ pic }}" alt="">', { title: 't', pic: 'https://evil.example/a.png' }).join(
        '|',
      ),
    ).toMatch(/Чужой адрес/)
    expect(found('<img src="{{ pic }}" alt="">', { title: 't', pic: '/media/a.png' })).toEqual([])
    // Ошибка про одну ссылку не подавляет остальные: два разных адреса — две ошибки
    const two = found('<a href="javascript:alert(1)">x</a><a href="{{ pic }}">y</a>', {
      title: 't',
      pic: 'vbscript:msgbox(1)',
    })
    expect(two.length).toBe(2)
    expect(two.join('|')).toMatch(/javascript:alert\(1\)/)
    expect(two.join('|')).toMatch(/vbscript:msgbox\(1\)/)
    // Одна и та же ссылка, найденная и статической проверкой, и пробным рендером, — одна ошибка
    expect(
      linkErrors('{% assign u = \'javascript:alert(1)\' %}<a href="{{ u }}">x</a>'),
    ).toHaveLength(1)
  })

  it('popover с display: block не выходит из-под защитного слоя base.css', () => {
    const file = '../base.css'
    const css = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
    expect(css).toMatch(
      /@layer averra-guard\s*\{[^}]*\[data-custom-block\] \[popover\]:not\(:popover-open\)/,
    )
    expect(css).toMatch(/display:\s*none\s*!important/)
    // Сам блок слои завести не может: иначе перебил бы порядок
    expect(errors({ css: '@layer x { .ad { display: block } }' }).length).toBeGreaterThan(0)
  })

  it.each([
    '<div data-cookie-consent data-mode="consent" data-metrika="99999999" hidden></div>',
    '<button type="button" data-consent-action="all">Принять</button>',
    '<a href="#" data-consent-open>Настройки</a>',
    '<a href="https://www.youtube-nocookie.com/embed/x" data-video-embed="x">Видео</a>',
    '<div data-custom-block="other"><p class="x">a</p></div>',
    '<div data-site-header></div>',
    '<div data-header-sentinel="far"></div>',
    '<div data-tone="muted"></div>',
    '<div DATA-Legal-Footer></div>',
  ])('data-атрибут сайта «%s» — ошибка при сохранении, при рендере его нет', (template) => {
    expect(templateErrors(template)[0]?.message).toMatch(/занят разметкой сайта/)
    expect(sanitizeHtml(template)).not.toMatch(
      /data-(?:cookie|consent|metrika|video|custom-block|site|header|tone|legal)/i,
    )
  })

  it('свои data-атрибуты — можно', () => {
    const template = '<li data-plan="pro" data-featured data-x-tone="a" data-videos="3">a</li>'
    expect(templateErrors(template)).toEqual([])
    expect(sanitizeHtml(template)).toBe(template.replace('data-featured', 'data-featured=""'))
  })

  it('список занятых data-атрибутов покрывает скрипты и общие стили сайта', () => {
    // Крючки — то, что ищут скрипты и общие стили. Атрибуты в CSS Modules встроенных блоков
    // крючками не служат: их селекторы начинаются с класса модуля, шаблону он неизвестен
    const files = [
      '../cookie/consent-dom.ts',
      '../header/header-dom.ts',
      '../video/player-dom.ts',
      '../ui/Section.tsx',
      '../base.css',
    ]
    const names = new Set<string>()
    for (const file of files) {
      const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
      for (const match of source.matchAll(/\bdata-([a-z0-9]+(?:-[a-z0-9]+)*)/g)) {
        names.add(`data-${match[1]}`)
      }
      for (const match of source.matchAll(/\bdataset\.([a-zA-Z0-9]+)/g)) {
        names.add(`data-${(match[1] ?? '').replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`)
      }
    }
    names.delete('data-mode')
    expect(names.size).toBeGreaterThan(10)
    expect([...names].filter((name) => !isReservedDataAttribute(name))).toEqual([])
  })

  it('скрипты сайта ищут свою разметку вне своих блоков — по тому же атрибуту', () => {
    for (const file of [
      '../cookie/consent-dom.ts',
      '../header/header-dom.ts',
      '../video/player-dom.ts',
    ]) {
      const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
      expect(source, file).toContain(`closest('[${CUSTOM_BLOCK_ATTRIBUTE}]')`)
    }
  })

  it.each([
    '<h2 id="cookie-consent-title">Ваш заголовок</h2>',
    '<div id="content"></div>',
    '<div id="~footer-name"></div>',
  ])('id разметки сайта «%s» — ошибка, при рендере его нет', (template) => {
    expect(templateErrors(template)[0]?.message).toMatch(/занят разметкой сайта/)
    expect(sanitizeHtml(template)).not.toContain('id=')
  })

  it('id блоков страницы — убирается при рендере; свой «{{ block.id }}-…» остаётся', () => {
    const html = sanitizeHtml(
      '<p id="hero">a</p><p id="form-1-name">b</p><p id="tariffs-1">c</p><p id="tariffs-1-q">d</p><p id="faq-q">e</p>',
      undefined,
      { pageIds: ['hero', 'form-1', 'tariffs-1'], ownId: 'tariffs-1' },
    )
    expect(html).toBe('<p>a</p><p>b</p><p>c</p><p id="tariffs-1-q">d</p><p id="faq-q">e</p>')
  })

  it('popovertarget, for, aria-* — только на id этого шаблона', () => {
    expect(
      templateErrors(
        '<button type="button" popovertarget="t-menu">Меню</button>\n<div id="t-menu" popover>a</div>\n<label for="t-q">Q</label><input id="t-q">',
      ),
    ).toEqual([])
    const outside = templateErrors(
      '<p>a</p>\n<button type="button" popovertarget="cookie-settings">Открыть</button>',
    )
    expect(outside[0]).toMatchObject({ line: 2, message: expect.stringMatching(/вне блока/) })
    expect(
      templateErrors('<p aria-labelledby="t-1 x">a</p><h3 id="t-1">T</h3>')[0]?.message,
    ).toMatch(/aria-labelledby="x"/)
    // Из Liquid значение видно только при рендере: ссылку наружу убирает очистка
    expect(templateErrors('<button popovertarget="{{ target }}">a</button>')).toEqual([])
    expect(
      sanitizeHtml(
        '<button popovertarget="site-menu">a</button><button popovertarget="t-m">b</button><div id="t-m" popover></div><p aria-describedby="t-m nope">c</p>',
      ),
    ).toBe(
      '<button>a</button><button popovertarget="t-m">b</button><div id="t-m" popover=""></div><p>c</p>',
    )
  })

  it('на странице: id соседнего блока в своём блоке не перехватывает якорь меню', () => {
    const definition = define({
      template: '<h2 id="faq-1">{{ title }}</h2><p id="{{ block.id }}-n">n</p>',
    })
    const html = renderToStaticMarkup(
      <Page
        content={PageContent.parse({
          blocks: [
            { id: 'tariffs-1', type: 'custom:tariffs', props: { title: 'Т' } },
            { id: 'faq-1', type: 'hero', props: { title: 'Вопросы' } },
          ],
        })}
        customBlocks={{ tariffs: definition }}
      />,
    )
    expect(html.match(/id="faq-1"/g)).toHaveLength(1)
    expect(html).toContain('id="tariffs-1-n"')
  })

  it.each([
    ['<img name="querySelectorAll" alt="">', /name у <img>/],
    ['<p>a</p>\n<img src="/a.png" NAME="cookie" alt="">', /name у <img>/],
    ['<div id="ym"></div>', /window\.ym/],
    ['<div id="dataLayer"></div>', /window\.dataLayer/],
    ['<svg><g id="gtag"></g></svg>', /window\.gtag/],
    ['<div id="цены"></div>', /window\.цены/],
    ['<input autofocus>', /autofocus/],
    ['<a href="/a" tabindex="5">a</a>', /tabindex="5"/],
    ['<a href="/a" tabindex=" +1">a</a>', /tabindex/],
  ])(
    '«%s» подменил бы имена страницы или порядок Tab — ошибка и вырезается',
    (template, message) => {
      expect(templateErrors(template)[0]?.message).toMatch(message)
      expect(sanitizeHtml(template)).not.toMatch(/\b(?:name|id|autofocus|tabindex)=/i)
    },
  )

  it('«==» внутри {% if %} в значении атрибута в кавычках — не «значение без кавычек»', () => {
    const template = '<li class="item{% if odd == 1 %} item--right{% endif %}">a</li>'
    expect(checkTemplateHtml(template).filter((problem) => problem.level === 'error')).toEqual([])
    // Без кавычек — по-прежнему ошибка
    const bare = checkTemplateHtml('<li class={% if a == 1 %}x{% endif %}>a</li>')
    expect(bare.some((problem) => /в кавычках/.test(problem.message))).toBe(true)
  })

  it('id с дефисом, tabindex 0 и -1, name у details — можно', () => {
    const template =
      '<div id="t-plans" tabindex="0"><span id="a_b-1" tabindex="-1">a</span><details name="faq"><summary>q</summary></details></div>'
    expect(templateErrors(template)).toEqual([])
    expect(sanitizeHtml(template)).toBe(template)
  })

  it('из Liquid: name, id-переменная и tabindex вырезаются при рендере', () => {
    const html = render(
      '<img name="{{ title }}" alt=""><p id="{{ title }}" tabindex="{{ text }}">a</p><p id="{{ block.id }}-x">b</p>',
      { title: 'head', text: '3' },
    )
    expect(html).toBe('<img alt=""><p>a</p><p id="b-x">b</p>')
  })

  it('на странице: блок с name и id-переменными не подменяет document и window', () => {
    const definition = define({
      template:
        '<img name="getElementById" alt=""><img name="head" alt=""><div id="dataLayer">{{ title }}</div>',
    })
    const html = renderToStaticMarkup(
      <Page
        content={PageContent.parse({
          blocks: [{ id: 'tariffs-1', type: 'custom:tariffs', props: { title: 'Т' } }],
        })}
        customBlocks={{ tariffs: definition }}
      />,
    )
    expect(html).not.toMatch(/name=|id="dataLayer"/)
    document.body.innerHTML = html
    expect(typeof document.getElementById).toBe('function')
    expect(document.head).toBeInstanceOf(HTMLHeadElement)
    expect('dataLayer' in window).toBe(false)
  })
})

describe('SVG: url() в атрибутах', () => {
  it('url(#id) на элемент блока можно, чужой адрес в атрибуте из поля — убирается при рендере', () => {
    const template = `<svg><rect fill="url(#t-grad)" mask="url('#t-m')"/></svg>`
    expect(checkTemplateHtml(template).filter((problem) => problem.level === 'error')).toEqual([])
    const out = render('<svg><rect fill="{{ title }}"/><circle fill="url(#a)"/></svg>', {
      title: 'url(https://evil.example/p.svg#p)',
    })
    expect(out).not.toContain('evil.example')
    expect(out).toContain('fill="url(#a)"')
    const cursor = '<svg><rect cursor="url(https://evil.example/c.cur), auto"/></svg>'
    expect(sanitizeHtml(cursor)).not.toContain('evil')
  })

  it.each(['linearGradient', 'radialGradient', 'pattern', 'filter', 'textPath'])(
    'href у <%s> — только #id: внешний шаблон — ошибка и убирается при рендере',
    (tag) => {
      const external = `<svg><${tag} href="https://evil.example/p.svg#p"/></svg>`
      expect(checkTemplateHtml(external)[0]?.message).toMatch(/только #id/)
      expect(sanitizeHtml(external)).not.toContain('evil')
      const own = `<svg><${tag} id="t-a"/><${tag} href="#t-a"/></svg>`
      expect(checkTemplateHtml(own).filter((problem) => problem.level === 'error')).toEqual([])
      expect(sanitizeHtml(`<svg><${tag} xlink:href="/p.svg#p"/></svg>`)).not.toContain('p.svg')
    },
  )
})

describe('CSS блока', () => {
  const compile = (css: string) => compileCustomCss(css, 'tariffs')
  const scope = '[data-custom-block="tariffs"]'

  it.each([
    ['LF', '\n'],
    ['CR', '\r'],
    ['FF', '\f'],
  ])(
    'строка, оборванная переводом строки (%s), — ошибка: браузер вышел бы из изоляции',
    (_, nl) => {
      const css = `.title { content: "x${nl}} h1, h2 { outline: 6px solid red !important } .b { content: " }`
      const { css: built, problems } = compile(css)
      expect(problems.some((problem) => problem.level === 'error')).toBe(true)
      expect(built).toBe('')
      const inMedia = compile(`@media (min-width: 1px) { .a[title="x${nl}"] { gap: 0 } }`)
      expect(inMedia.problems.some((problem) => problem.level === 'error')).toBe(true)
    },
  )

  it('строка с обратной косой чертой перед переводом строки — продолжение; номер строки верный', () => {
    expect(compile('.a { content: "x\\\ny" }').problems).toEqual([])
    const broken = compile('.a { gap: 0 }\n.b { content: "x\n" }')
    expect(broken.problems[0]?.line).toBe(2)
  })

  it('position: fixed в запасном значении var() — тоже ошибка', () => {
    const { problems } = compile('.a { position: var(--p, fixed) }')
    expect(problems[0]?.level).toBe('error')
  })

  it('«</style» и «<!--» в CSS не закрывают <style> страницы', () => {
    const css = customBlocksCss(
      ['tariffs'],
      {
        tariffs: define({
          css: '/* </style><script>alert(1)</script> */\n.a { content: "</STYLE><!--" }',
        }),
      },
      media,
    )
    expect(css).not.toMatch(/<\/style/i)
    expect(css).not.toContain('<!--')
  })

  it('каждый селектор — внутри блока, :scope — сам блок', () => {
    const { css, problems } = compile(
      '.a, .b > p { color: var(--color-text) }\n:scope { padding: 0 }\n:scope.dark .a:is(.x, .y) { gap: 0 }',
    )
    expect(problems).toEqual([])
    expect(css).toContain(`${scope} .a, ${scope} .b > p {`)
    expect(css).toContain(`${scope} {`)
    expect(css).toContain(`${scope}.dark .a:is(.x, .y) {`)
  })

  it('медиазапросы — можно, keyframes — с ключом блока', () => {
    const { css } = compile(
      '@media (min-width: 40rem) { .a { gap: 0 } }\n@keyframes pop { from { opacity: 0 } }\n.a { animation: pop 1s }',
    )
    expect(css).toContain(`@media (min-width: 40rem) { ${scope} .a { gap: 0 } }`)
    expect(css).toContain('@keyframes tariffs--pop { from { opacity: 0 } }')
    expect(css).toContain('animation: tariffs--pop 1s')
  })

  it('@import, @font-face, html, body, вложенные правила — ошибки со строкой и вне сборки', () => {
    const { css, problems } = compile(
      '@import url(https://evil.example/x.css);\n@font-face { font-family: x }\nbody { margin: 0 }\n.a { & .b { gap: 0 } }',
    )
    expect(problems.map((problem) => [problem.line, problem.level])).toEqual([
      [1, 'error'],
      [2, 'error'],
      [3, 'error'],
      [4, 'error'],
    ])
    expect(css).not.toContain('@import')
    expect(css).not.toContain('@font-face')
  })

  it('url() — только картинки медиатеки', () => {
    expect(
      compile('.a { background: url(https://evil.example/x.png) }').problems[0]?.message,
    ).toMatch(/только картинки медиатеки/)
    expect(compile('.a { background: url("/x.png") }').problems).toHaveLength(1)
    const own = compileCustomCss(`.a { background: url(media:${mediaId}) }`, 'tariffs', {
      mediaUrl: (id) => (id === mediaId ? `/media/${id}/960.jpeg` : undefined),
    })
    expect(own.problems).toEqual([])
    expect(own.css).toContain(`url("/media/${mediaId}/960.jpeg")`)
  })

  it.each([
    ':not(:scope) { gap: 0 }',
    '*:has(:scope) { gap: 0 }',
    ':is(:scope, *) { gap: 0 }',
    ':where(:scope) { gap: 0 }',
    '.a :scope { gap: 0 }',
    ':scope ~ * { gap: 0 }',
    ':scope + section { gap: 0 }',
    ':scope.a ~ b { gap: 0 }',
  ])('%s — ошибка, правила нет в сборке', (rule) => {
    const { css, problems } = compile(rule)
    expect(problems.some((problem) => problem.level === 'error')).toBe(true)
    expect(css).not.toContain('gap')
  })

  it.each([
    '~ * { display: none !important }',
    '+ section { display: none }',
    '.a, ~ * { display: none }',
    '@media (min-width: 1px) { ~ * { display: none } }',
    '@supports (display: grid) { + * { display: none } }',
    ':scope > .a, + * { display: none }',
    '.a:\\73 cope { display: none }',
    '.a::part(x) { display: none }',
    '.a:host { display: none }',
  ])('селектор за пределы блока «%s» — ошибка, правила нет в сборке', (rule) => {
    const { css, problems } = compile(rule)
    expect(problems.some((problem) => problem.level === 'error')).toBe(true)
    expect(css).not.toContain('none')
  })

  it('«>» и «:scope >» в начале — верхний элемент шаблона (ребёнок обёртки HTML)', () => {
    const root = '[data-custom-block-root]'
    const { css, problems } = compile(
      '> .a { gap: 0 }\n.b, > p { gap: 0 }\n:scope > .c, :scope:hover > .d { gap: 0 }',
    )
    expect(problems).toEqual([])
    expect(css).toContain(`${scope} ${root} > .a {`)
    expect(css).toContain(`${scope} .b, ${scope} ${root} > p {`)
    expect(css).toContain(`${scope} ${root} > .c, ${scope}:hover ${root} > .d {`)
  })

  it('«>» и «:scope >» попадают в верхний элемент шаблона на настоящей странице', () => {
    const definition = define({
      template: '<p class="top">a</p><div><p class="deep">b</p></div>',
      css: '> .top { outline-style: solid }\n:scope > div { outline-style: dashed }\n> .deep { outline-style: dotted }',
    })
    const content = PageContent.parse({
      blocks: [{ id: 'tariffs-1', type: 'custom:tariffs', props: { title: 'Т' } }],
    })
    document.body.innerHTML = renderToStaticMarkup(
      <Page content={content} customBlocks={{ tariffs: definition }} />,
    )
    const built = customBlocksCss(['tariffs'], { tariffs: definition }, media)
    const rules = compile(definition.css).css.match(/^[^{]+(?=\{)/gm) ?? []
    expect(built).toContain(rules[0]?.trim() ?? '—')
    const [top, wrapper, deep] = rules.map((selector) => selector.trim())
    expect(document.querySelector(top ?? '')?.className).toBe('top')
    expect(document.querySelector(wrapper ?? '')?.tagName).toBe('DIV')
    expect(document.querySelector(wrapper ?? '')?.querySelector('.deep')).not.toBeNull()
    // Глубже верхнего уровня «>» не достаёт
    expect(document.querySelector(deep ?? '')).toBeNull()
    document.body.innerHTML = ''
  })

  it('«>>>» — одна ошибка про комбинатор, без ложной про «+» и «~»', () => {
    const { problems } = compile(':scope >>> .a { gap: 0 }')
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.every((problem) => !/«\+» и «~»/.test(problem.message))).toBe(true)
  })

  it('законный CSS: url(#id) у SVG, :popover-open, @starting-style', () => {
    const { css, problems } = compile(
      [
        '.icon { clip-path: url(#cut); mask: url(#fade); filter: url(#blur); fill: url(#grad) }',
        '.menu:popover-open { opacity: 1 }',
        '@starting-style { .menu { opacity: 0 } }',
      ].join('\n'),
    )
    expect(problems).toEqual([])
    expect(css).toContain(`@starting-style { ${scope} .menu`)
  })

  it.each([
    '.a { background: url(#x) }',
    '.a { clip-path: url(#x/../y) }',
    '.a { clip-path: url(https://evil.example/m.svg#x) }',
    '.a { mask-image: image-set(url(#x) 1x) }',
  ])('url() не из медиатеки вне ссылки на элемент SVG «%s» — ошибка', (rule) => {
    expect(compile(rule).problems.some((problem) => problem.level === 'error')).toBe(true)
  })

  it('законные селекторы: состояния, порядок, атрибуты, псевдоэлементы, :has', () => {
    const { problems } = compile(
      [
        '.a:hover, .a:focus-visible, .a:nth-child(2n + 1), .a:not(.b):is(.c, .d) { gap: 0 }',
        '.a::before, .a::after, li::marker, input::placeholder, .a:first-of-type { gap: 0 }',
        '.a[aria-current="page"], [data-x] > *, .a:has(> img) ~ .b + .c { gap: 0 }',
        '.a::-webkit-scrollbar, summary::-webkit-details-marker, .a:where(:empty) { gap: 0 }',
      ].join('\n'),
    )
    expect(problems).toEqual([])
  })

  it.each([
    '.x { background-image: image-set(var(--n, "https://evil.example/a.png") 1x) }',
    ':scope { --u: "https://evil.example/a.png" }\n.x { background-image: image-set(var(--u) 1x) }',
    '.x { background-image: -webkit-image-set(var(--u) 1x) }',
    '.x { list-style: image-set("https://evil.example/a.png" 1x) }',
    '.x { content: image-set("https://evil.example/a.png" 1x) }',
    '.x { --bg: image-set("https://evil.example/a.png" 1x) }',
    '.x { background-image: image-set(foo("https://evil.example/a.png") 1x) }',
    '.x { background: "https://evil.example/a.png" }',
    '.x { cursor: var(--c, "https://evil.example/a.cur"), auto }',
    '.x { background: -webkit-cross-fade(url(media:x), url(media:y), 50%) }',
    '.x { background: newloader("https://evil.example/a.png") }',
    '.x { color: attr(data-x) }',
    '.x { posit\\ion: fixed; background: url(https://evil.example/a.png) }',
  ])('загрузка мимо медиатеки «%s» — ошибка', (rule) => {
    const { css, problems } = compile(rule)
    expect(problems.some((problem) => problem.level === 'error')).toBe(true)
    // Строка в своём свойстве сама ничего не грузит: опасна только подстановка, а её нет в сборке
    expect(css.replace(/--u: "[^"]*"/, '')).not.toContain('evil')
    expect(css).not.toMatch(/image-set|cross-fade|newloader|attr\(|posit/)
  })

  it('position через свою переменную — ошибка: значение не проверить по месту', () => {
    const { css, problems } = compile(':scope { --p: fixed }\n.x { position: var(--p) }')
    expect(problems.map((problem) => [problem.line, problem.level])).toEqual([[2, 'error']])
    expect(css).not.toContain('position')
  })

  it('законные значения: image-set из медиатеки, градиенты, calc, трансформации, content', () => {
    const own = compileCustomCss(
      [
        `.a { background-image: image-set(url(media:${mediaId}) 1x, url(media:${mediaId}) type("image/avif") 2x) }`,
        '.b { background: linear-gradient(to right, var(--color-accent), transparent), var(--color-surface) }',
        '.c { width: clamp(10rem, calc(100% - var(--space-4) * 2), 40rem); transform: translateY(-2px) rotate(3deg) }',
        '.d::before { content: "★ " attr(data-label) counter(item); quotes: "«" "»" }',
        '.e { grid-template-columns: repeat(auto-fit, minmax(min(16rem, 100%), 1fr)); transition: transform 0.2s cubic-bezier(0.2, 0, 0, 1) }',
        '.f { filter: drop-shadow(0 1px 2px var(--color-shadow, transparent)); clip-path: polygon(0 0, 100% 0, 100% 80%) }',
        '.g { background: -webkit-linear-gradient(top, var(--color-surface), transparent); font-family: var(--font-heading), "Arial" }',
        ':scope { --gap: var(--space-4); --label: "Хит" }',
        '.h { position: relative } .i { position: absolute; inset: 0 }',
      ].join('\n'),
      'tariffs',
      { mediaUrl: (id) => `/media/${id}/960.jpeg` },
    )
    expect(own.problems).toEqual([])
    expect(own.css).toContain(`image-set(url("/media/${mediaId}/960.jpeg") 1x`)
  })

  it(':scope в начале и соседи внутри блока — можно', () => {
    expect(compile(':scope > .a ~ .b, :scope:hover .a + .b { gap: 0 }').problems).toEqual([])
  })

  it.each([
    '.a { background: var(--nope, url(https://evil.example/x.png)) }',
    '.a { background: var(--nope, var(--n2, url(https://evil.example/x.png))) }',
    '.a { background: u\\rl(https://evil.example/x.png) }',
    '.a { background: \\75 rl(https://evil.example/x.png) }',
    '.a { --x: url(https://evil.example/x.png) }',
    '.a { background: image("https://evil.example/x.png") }',
    '.a { background: image-set("https://evil.example/x.png" 1x) }',
    '.a { background: src("https://evil.example/x.png") }',
    '.a { cursor: url(https://evil.example/x.cur), auto }',
  ])('%s — ошибка, объявления нет в сборке', (rule) => {
    const { css, problems } = compile(rule)
    expect(problems.some((problem) => problem.level === 'error')).toBe(true)
    expect(css).not.toContain('evil')
  })

  it('запасное значение var() — картинка медиатеки и цвет без предупреждения', () => {
    expect(compile('.a { color: var(--color-text, red) }').problems).toEqual([])
    const own = compileCustomCss(`.a { background: var(--x, url(media:${mediaId})) }`, 'tariffs', {
      mediaUrl: (id) => `/media/${id}/960.jpeg`,
    })
    expect(own.problems).toEqual([])
    expect(own.css).toContain('/media/')
  })

  it('position: fixed — ошибка, sticky и высокий z-index — предупреждения', () => {
    expect(compile('.a { position: fixed; inset: 0 }').problems[0]).toMatchObject({
      level: 'error',
    })
    expect(compile('.a { position: sticky; z-index: 99 }').problems.map((p) => p.level)).toEqual([
      'warning',
      'warning',
    ])
  })

  it('конкретные цвета — предупреждение, не ошибка', () => {
    const { problems } = compile('.a { color: #fff; background: rgb(0 0 0); border-color: red }')
    expect(problems.map((problem) => problem.level)).toEqual(['warning', 'warning', 'warning'])
    expect(compile('.a { color: var(--color-accent); background: transparent }').problems).toEqual(
      [],
    )
  })

  it('синтаксическая ошибка — понятный текст со строкой', () => {
    expect(compile('.a {\n  color: red').problems[0]).toMatchObject({ line: 1, level: 'error' })
  })
})

describe('свой блок на странице', () => {
  const definition = define({
    template: '<h2 class="t">{{ title }}</h2>',
    css: '.t { color: var(--color-accent) }',
  })
  const page = (props: Record<string, unknown>) =>
    PageContent.parse({
      blocks: [
        { id: 'hero', type: 'hero', props: { title: 'Привет' } },
        { id: 'tariffs-1', type: 'custom:tariffs', props },
      ],
    })

  it('в том же Section, что встроенные: якорь и атрибут блока', () => {
    const html = renderToStaticMarkup(
      <Page content={page({ title: 'Тарифы' })} customBlocks={{ tariffs: definition }} />,
    )
    expect(html).toMatch(
      /<section id="tariffs-1" class="[^"]*" data-tone="plain" data-density="normal" data-custom-block="tariffs"><div class="[^"]*"><div data-custom-block-root=""><h2 class="t">Тарифы<\/h2><\/div><\/div><\/section>/,
    )
    expect(customBlocksCss(['tariffs'], { tariffs: definition }, media)).toContain(
      '[data-custom-block="tariffs"] .t',
    )
  })

  it('данные не подходят — на сайте блока нет, остальные на месте; в предпросмотре — причина', () => {
    const failed: string[] = []
    const content = page({ wrong: 1 })
    const html = renderToStaticMarkup(
      <Page
        content={content}
        customBlocks={{ tariffs: definition }}
        onCustomBlockError={(id) => failed.push(id)}
      />,
    )
    expect(html).toContain('id="hero"')
    expect(html).not.toContain('tariffs-1')
    expect(failed).toEqual(['tariffs-1'])
    const preview = renderToStaticMarkup(
      <Page content={content} customBlocks={{ tariffs: definition }} preview />,
    )
    expect(preview).toContain('role="alert"')
  })

  it('неопубликованное определение на сайт не попадает', () => {
    const html = renderToStaticMarkup(<Page content={page({ title: 'Тарифы' })} />)
    expect(html).not.toContain('tariffs-1')
  })
})
