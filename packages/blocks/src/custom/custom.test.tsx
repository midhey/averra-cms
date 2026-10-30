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
import { describe, expect, it } from 'vitest'
import { Page } from '../Page'
import { compileCustomCss } from './css'
import { checkTemplateHtml, maskLiquid, sanitizeHtml } from './html'
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
    expect(html).toBe('<b>A</b><b>B</b><p>a&lt;b&gt;<br>b</p><p>c</p>a&lt;b&gt;<br>b<br><br>c')
  })

  it('accent: слова в звёздочках — <em>, остальное экранировано, переносы — <br>', () => {
    expect(
      render('{{ title | accent }}', { title: 'Английский, *который вписывается*\nв <жизнь>' }),
    ).toBe('Английский, <em>который вписывается</em><br>в &lt;жизнь&gt;')
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

  it('h1 и картинка без alt — предупреждения', () => {
    const problems = checkTemplateHtml('<h1>a</h1><img src="/a.png">')
    expect(problems.map((problem) => problem.level)).toEqual(['warning', 'warning'])
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
