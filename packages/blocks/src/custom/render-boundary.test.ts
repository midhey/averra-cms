import { CustomBlockDraft, type CustomBlockDraftInput, parsedExample } from '@averra/schema'
import { type DefaultTreeAdapterTypes, parse, parseFragment, serialize } from 'parse5'
import { describe, expect, it } from 'vitest'
import { sanitizeHtml, untilStable } from './html'
import { renderTemplate } from './liquid'
import { CustomBlockRenderError } from './problems'
import { customBlockProblems, renderCustomBlockHtml } from './render'

// Граница защиты своих блоков — очистка готового HTML при рендере (sanitizeHtml в
// renderCustomBlockHtml), а не проверка шаблона при сохранении. Статическая проверка — подсказка
// автору: полноты она не обещает (forloop, increment, block.id и подобное в общем виде не
// вычислить). Здесь — все шаблоны, которыми проверяющий обходил подсказку за все круги шагов 4.11
// и 4.12: на разных данных и при id блока разной длины на выходе рендера нет ни опасной схемы
// в адресе, ни tabindex > 0, ни id, годного в имя переменной JS, ни url() с файлом, ни ссылки на
// чужой id. И так же, когда собранный HTML браузер разбирает иначе, чем разобрали мы (мутационный
// XSS, круг 9): оракул разбирает вывод заново, как браузер — целой страницей с обёрткой блока.
// Оракул ниже написан заново, без правил html.ts: иначе тест проверял бы очистку ею же самой

type Element = DefaultTreeAdapterTypes.Element
type ParentNode = DefaultTreeAdapterTypes.ParentNode

/** Атрибуты, которые браузер читает как адрес (переход или загрузка) */
const URL_ATTRIBUTE =
  /^(?:href|src|srcset|imagesrcset|poster|cite|action|formaction|background|longdesc|data|codebase|manifest|ping|[\w-]+:href)$/
const DANGEROUS_SCHEME = /^(?:javascript|vbscript|data):/
/** Атрибуты со ссылкой на элемент по id */
const ID_REFERENCE =
  /^(?:popovertarget|commandfor|interestfor|anchor|for|list|headers|aria-(?:labelledby|describedby|controls|owns|details|activedescendant|flowto|errormessage))$/
/** Имя переменной JS: такой id браузер кладёт в window */
const SCRIPT_NAME = /^[\p{L}\p{Nl}$_][\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}$‌‍]*$/u
const FORBIDDEN_TAG =
  /^(?:script|style|iframe|frame|object|embed|base|link|meta|form|foreignobject|set|animate\w*|plaintext|xmp|noembed|noframes|template)$/
/** Атрибуты без CSS: текст для людей и данные */
const INERT = /^(?:alt|title|placeholder|aria-.+|data-.+)$/

const isElement = (node: DefaultTreeAdapterTypes.ChildNode): node is Element => 'tagName' in node

function elementsOf(parent: ParentNode, found: Element[] = []) {
  for (const node of parent.childNodes) {
    if (!isElement(node)) continue
    found.push(node)
    elementsOf(node, found)
    // Содержимое <template> parse5 кладёт отдельно: смотрим и туда
    if ('content' in node) elementsOf((node as DefaultTreeAdapterTypes.Template).content, found)
  }
  return found
}

/** Тело страницы, как его разберёт браузер: блок — в <div> внутри <section>, как на сайте */
function pageBody(html: string) {
  const page = parse(
    `<!doctype html><html><head></head><body><section id="block-1"><div data-custom-block-root>${html}</div></section></body></html>`,
  )
  const root = page.childNodes.find(isElement)
  const body = root?.childNodes.filter(isElement).find((node) => node.tagName === 'body')
  if (!body) throw new Error('Нет body')
  return body
}

/**
 * Что опасного в готовом HTML, как его разберёт браузер. withIds — правила про id (на сайте
 * их чистит рендер; пробный рендер при сохранении их не сверяет: id блока в примере вымышленный)
 */
function dangersOf(html: string, { withIds = true } = {}) {
  const found: string[] = []
  const elements = elementsOf(pageBody(html))
  const ids = new Set(
    elements.flatMap((node) => node.attrs.filter((a) => a.name === 'id').map((a) => a.value)),
  )
  for (const node of elements) {
    const tag = node.tagName.toLowerCase()
    if (FORBIDDEN_TAG.test(tag)) found.push(`<${tag}>`)
    for (const attr of node.attrs) {
      const name = (attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name).toLowerCase()
      const value = attr.value
      if (/^on/.test(name) || name === 'style' || name === 'srcdoc') found.push(name)
      if (URL_ATTRIBUTE.test(name)) {
        const urls = name.endsWith('srcset')
          ? value.split(',').map((one) => one.trim().split(/\s+/)[0] ?? '')
          : [value]
        for (const url of urls) {
          const compact = url.replace(/[\s\p{Cc}]/gu, '').toLowerCase()
          if (DANGEROUS_SCHEME.test(compact)) found.push(`${name}=${compact}`)
        }
      }
      if (name === 'tabindex' && Number.parseInt(value, 10) > 0) found.push(`tabindex=${value}`)
      // В адресе url(…) — просто путь; как CSS его читают остальные атрибуты (fill, mask…)
      if (!INERT.test(name) && !URL_ATTRIBUTE.test(name) && /url\s*\(\s*['"]?\s*(?!#)/i.test(value))
        found.push(`${name} url()`)
      if (!withIds) continue
      if (name === 'id' && SCRIPT_NAME.test(value)) found.push(`id=${value}`)
      if (ID_REFERENCE.test(name) && !value.split(/\s+/).every((id) => !id || ids.has(id))) {
        found.push(`${name}=${value}`)
      }
    }
  }
  return found
}

const MXSS: readonly string[] = [
  '<math><mtext><table><mglyph><svg><mtext><textarea><path id="{{ title }}"></path></textarea></mtext></svg></mglyph></table></mtext></math><p>{{ title }}</p>',
  '<math><mtext><table><mglyph><svg><mtext><textarea><a title="{{ title }}"></a></textarea></mtext></svg></mglyph></table></mtext></math>',
  '<math><mtext><table><malignmark><svg><mtext><textarea><path id="{{ a }}"></path></textarea></mtext></svg></malignmark></table></mtext></math>',
  '<math><mtext><table><mglyph><svg><mtext><title><path id="{{ b }}"></path></title></mtext></svg></mglyph></table></mtext></math>',
  '<math><mtext><table><mglyph><svg><mtext><textarea><path id="</textarea><img onerror=alert(1) src=1>">',
  '<math><mtext><table><mglyph><svg><mtext><textarea><a title="</textarea><a href=javascript:alert(1)>x</a>">',
  '<math><mtext><table><mglyph><svg><mtext><title><path id="</title><img onerror=alert(1) src=1>">',
  '<svg><p><textarea><path id="</textarea><img onerror=alert(1) src=1>">',
  '<svg></p><style><a id="</style><img src=1 onerror=alert(1)>">',
  '<math><mtext><table><mglyph><style><img src=1 onerror=alert(1)>',
]

const P = "{% assign parts = '/,javascript:alert(1)' | split: ',' %}"
const branch = (inside: string) => `{% if title == 'zz' %}${inside}{% endif %}`
const zz = (inside: string) => `{% if a == 'zz' %}${inside}{% endif %}`
const A390 = 'A'.repeat(390)
const A400 = 'A'.repeat(400)

/** Шаблоны проверяющего: в каком круге и каким приёмом он обходил проверку при сохранении */
const HOSTILE: Record<string, readonly string[]> = {
  // 4.12, круг 8: индекс и аргумент от forloop, increment, block.id; не-адресные атрибуты
  'forloop, increment, block.id': [
    `${P}${zz(`{% for k in (1..2) %}{% if forloop.last %}<a href="{{ parts[forloop.index0] }}">x</a>{% endif %}{% endfor %}`)}`,
    `${P}${zz('{% for k in (1..2) %}{% assign i = forloop.index0 %}{% endfor %}')}<a href="{{ parts[i] }}">x</a>`,
    `${P}${zz('{% for k in (1..2) %}{% capture i %}{{ forloop.index0 }}{% endcapture %}{% endfor %}')}{% assign j = i | plus: 0 %}<a href="{{ parts[j] }}">x</a>`,
    `${P}${zz('<i hidden>{% increment i %}</i>')}<a href="{{ parts[i] }}">x</a>`,
    `${P}{% liquid\nif a == 'zz'\nincrement i\nendif\n%}<a href="{{ parts[i] }}">x</a>`,
    zz(
      `{% for k in (1..2) %}{% if forloop.last %}<a href="{{ '/javascript:alert(1)' | slice: forloop.index0, 99 }}">x</a>{% endif %}{% endfor %}`,
    ),
    `{% assign parts = '/,/,/,/,/,/,/,/,javascript:alert(1)' | split: ',' %}<a href="{{ parts[block.id.size] }}">x</a>`,
    `{% assign parts = '/,/,/,/,/,javascript:alert(1)' | split: ',' %}<a href="{{ parts[block.key.size] }}">x</a>`,
    zz('{% for k in (1..3) %}<p tabindex="{{ forloop.index }}">x</p>{% endfor %}'),
    `{% assign names = 'site-a,ym' | split: ',' %}${zz('{% for k in (1..2) %}<p id="{{ names[forloop.index0] }}">x</p>{% endfor %}')}`,
    `{% assign ids = 'x-box,site-menu' | split: ',' %}${zz('{% for k in (1..2) %}<button popovertarget="{{ ids[forloop.index0] }}">x</button>{% endfor %}')}`,
    zz(
      `{% for k in (1..2) %}<svg><rect fill="{{ 'url(#g)|url(https://e.x/a)' | split: '|' | slice: forloop.index0 | first }}"/></svg>{% endfor %}`,
    ),
  ],
  // 4.11: raw, comment, {% # %}, склейка имени атрибута, срез пробелов
  'raw, comment, склейка имени': [
    '<a href="{% raw %}javascript:alert(1){% endraw %}">x</a>',
    '<a href="java{% raw %}{% endraw %}script:alert(1)">x</a>',
    '<img src="x" alt="" onerror="{% raw %}alert(1){% endraw %}">',
    '<a href="java{% comment %}x{% endcomment %}script:alert(1)">x</a>',
    '<a href="java{%- comment -%} x {%- endcomment -%}script:alert(1)">x</a>',
    '<a href="java{% # c %}script:alert(1)">x</a>',
    '<a href="java{% comment %}"{% endcomment %}script:alert(1)">x</a>',
    '<a href="java{% comment %}{% raw %}x{% endraw %}{% endcomment %}script:alert(1)">x</a>',
    '<img src="x" alt="" onerror="{% # c %}alert(1)">',
    '{{ "{% raw %}" }}<a href={{title}}>t</a>{{ "{% endraw %}" }}',
    '<a h{% raw %}{% endraw %}ref="javascript:alert(1)">x</a>',
    '<a h{% if true %}{% endif %}ref="javascript:alert(1)">x</a>',
    '<a h{% comment %}x{% endcomment %}ref="javascript:alert(1)">x</a>',
    '<a h{% # c %}ref="javascript:alert(1)">x</a>',
    '<img src="x" alt="" on{% if true %}{% endif %}error="alert(1)">',
    '<a h {%- if true -%}{%- endif -%} ref="javascript:alert(1)">x</a>',
    '<a h {%- # c -%} ref="javascript:alert(1)">x</a>',
    '<a h {%- raw %}{% endraw -%} ref="javascript:alert(1)">x</a>',
    '<img src="x" alt="" on {%- if true -%}{%- endif -%} error="alert(1)">',
    '<div st {%- if true -%}{%- endif -%} yle="color:red">x</div>',
    '<a h{% if true %}{% endif -%} ref="javascript:alert(1)">x</a>',
    '<scr {%- if t -%}{%- endif -%} ipt>alert(1)</script>',
    '<a href=java{% comment %}x{% endcomment %}script:alert(1)>x</a>',
  ],
  // 4.11: ветки, циклы, echo, строки в выводе, сущности, повтор атрибута
  'ветки и константы в адресе': [
    '<a href="{% if true %}javascript:alert(1){% endif %}">x</a>',
    '<a href="{% if t %}/x{% else %}javascript:alert(1){% endif %}">x</a>',
    '<a href="{% unless t %}javascript:alert(1){% endunless %}">x</a>',
    '<a href="java{% assign a = 1 %}script:alert(1)">x</a>',
    '<a href="java{% capture c %}x{% endcapture %}script:alert(1)">x</a>',
    '<a href="{% case a %}{% when \'zz\' %}javascript:alert(1){% endcase %}">x</a>',
    '<a href="{% for i in (1..1) %}javascript:alert(1){% endfor %}">x</a>',
    '<a href="{% echo \'javascript:alert(1)\' %}">x</a>',
    '<a href="{{ \'javascript:alert(1)\' }}">x</a>',
    '<a href="{% liquid\n  echo \'javascript:alert(1)\' %}">x</a>',
    '<a href="java{{ empty }}script:alert(1)">x</a>',
    '<a href="javascript:{{ title }}">x</a>',
    '<img src="{% if t %}data:text/html,x{% endif %}" alt="">',
    '<svg><use href="{% if t %}javascript:alert(1){% endif %}"/></svg>',
    '<a href="{% if a %}/{% endif %}javascript:alert(1)">x</a>',
    '<a href="{% if a %}{% else %}/{% endif %}javascript:alert(1)">x</a>',
    '<a href="{% if a %}java{% endif %}{% if b %}script:{% endif %}alert(1)">x</a>',
    '<a href="{% if a %}ja{% if b %}va{% endif %}script:alert(1){% endif %}">x</a>',
    '<a href="{% if a %}&#106;avascript:alert(1){% endif %}">x</a>',
    '<a href="{% if a %}/{% endif %}  JavaScript:alert(1)">x</a>',
    '<img srcset="/a.png 1x, {% if a %}/b.png 2x, {% endif %}javascript:alert(1) 3x" alt="">',
    '<img srcset="a.png,{{ title }}javascript:alert(1) 2x" alt="">',
    '<a href="{{ \'javascript\' }}:alert(1)">x</a>',
    '<a href="{{ title | default: \'javascript\' }}:alert(1)">x</a>',
    "<a href=\"{{ 'javas' | append: 'cript' | append: ':alert(1)' }}\">x</a>",
    "<a href=\"{{ 'cript:alert(1)' | prepend: 'javas' }}\">x</a>",
    '<a href="{% echo \'java\' %}script:alert(1)">x</a>',
    '{% assign u = \'javascript:alert(1)\' %}<a href="{{ u }}">x</a>',
    '{% capture u %}javascript:alert(1){% endcapture %}<a href="{{ u }}">x</a>',
    '{% assign s = \'javascript\' %}<a href="{{ s }}:alert(1)">x</a>',
    '{% liquid\n  assign u = \'javascript:alert(1)\' %}<a href="{{ u }}">x</a>',
    "{% unless title %}{% assign urls = 'javascript:alert(1)' | split: ',' %}{% for u in urls %}<a href=\"{{ u }}\">x</a>{% endfor %}{% endunless %}",
    '<a {% if a %}href="/x"{% else %}href="javascript:alert(1)"{% endif %}>x</a>',
    '<a href="/x" href="{% if t %}javascript:alert(1){% endif %}">x</a>',
    '<a {% if a %}onclick="x"{% else %}onclick="y"{% endif %} href="/x">x</a>',
    `<a href="&#${zz('106')}{% if a != 'zz' %}47{% endif %};avascript:alert(1)">x</a>`,
    '<a href="java&#115;cript&colon;alert(1)">x</a>',
    '<a href="{% if a %}&#106;{% endif %}avascript&Tab;:alert(1)">x</a>',
    "<a href=\"{% for p in 'x/,javascript:alert(1)' | split: ',' %}{% if forloop.last %}{{ p }}{% endif %}{% endfor %}\">x</a>",
  ],
  // 4.12, круги 1–7: константы в ветках мимо примера, фильтры, алиасы, capture, циклы, обрезка
  'переменные в ветках': [
    zz("{% assign u = 'javascript:alert(1)' %}{% else %}{% assign u = '/' %}") +
      '<a href="{{ u }}">x</a>',
    `${zz("{% assign u = 'javascript:alert(1)' %}")}{% if a != 'zz' %}{% assign u = '/' %}{% endif %}<a href="{{ u }}">x</a>`,
    `{% capture u %}${zz('javascript:alert(1){% else %}/')}{% endcapture %}<a href="{{ u }}">x</a>`,
    "<a href=\"{% liquid\nif a == 'zz'\necho 'javascript:alert(1)'\nendif %}\">x</a>",
    "{% liquid\nif a == 'zz'\nassign u = 'javascript:alert(1)'\nendif %}<a href=\"{{ u }}\">x</a>",
    "{% liquid\nif a == 'zz'\ncapture u\necho 'javascript:alert(1)'\nendcapture\nendif %}<a href=\"{{ u }}\">x</a>",
    zz(
      "{% assign us = 'javascript:alert(1)' | split: ',' %}{% for u in us %}<a href=\"{{ u }}\">x</a>{% endfor %}",
    ),
    `${zz("{% assign u = 'javascript:alert(1)' %}")}{% assign v = u %}<a href="{{ v }}">x</a>`,
    `${zz("{% assign u = 'java' | append: 'script:alert(1)' %}")}<a href="{{ u }}">x</a>`,
    `${zz("{% assign u = 'java|script:alert(1)' | remove: '|' %}")}<a href="{{ u }}">x</a>`,
    `${zz("{% assign u = 'data:text/html,x' %}")}<img src="{{ u }}" alt="">`,
    `${branch("{% assign u = 'javascriptxalert(1)' %}")}<a href="{{ u | replace: 'x', ':' }}">x</a>`,
    `${branch("{% assign u = 'javascript%3Aalert(1)' %}")}<a href="{{ u | url_decode }}">x</a>`,
    `${branch("{% assign u = 'amF2YXNjcmlwdDphbGVydCgxKQ==' %}")}<a href="{{ u | base64_decode }}">x</a>`,
    `${branch("{% assign u = '/,javascript:alert(1)' | split: ',' %}")}<a href="{{ u | last }}">x</a>`,
    `${branch("{% assign u = '/,javascript:alert(1)' | split: ',' %}")}<a href="{{ u[1] }}">x</a>`,
    `{% capture u %}${branch('javascript%3Aalert(1)')}{% endcapture %}<a href="{{ u | url_decode }}">x</a>`,
    "{% liquid\nif title == 'zz'\nassign u = 'javascriptxalert(1)'\nendif %}<a href=\"{{ u | replace: 'x', ':' }}\">x</a>",
    `${branch("{% assign us = '/,javascript:alert(1)' | split: ',' %}")}{% for u in us %}<a href="{{ u | upcase }}">x</a>{% endfor %}`,
    `${branch("{% assign p = 'javascriptxalert(1)' %}")}{% assign u = p | replace: 'x', ':' %}<a href="{{ u }}">x</a>`,
    `${branch("{% assign p = 'javascript' %}")}{% assign u = p | append: ':alert(1)' %}<a href="{{ u }}">x</a>`,
    `${branch("{% assign p = 'alert(1)' %}")}{% assign u = p | prepend: 'javascript:' %}<a href="{{ u }}">x</a>`,
    `${branch("{% assign p = 'javascriptxalert(1)' %}")}{% assign q = p %}{% assign u = q | replace: 'x', ':' %}<a href="{{ u }}">x</a>`,
    `${branch("{% assign p = ' javascriptxalert(1)' %}")}{% assign q = p | strip %}{% assign u = q | replace: 'x', ':' %}<a href="{{ u }}">x</a>`,
    `${branch('{% capture p %}javascriptxalert(1){% endcapture %}')}{% assign u = p | replace: 'x', ':' %}<a href="{{ u }}">x</a>`,
    `${branch("{% assign p = 'javascriptxalert(1)' %}")}{% capture q %}{{ p }}{% endcapture %}{% assign u = q | replace: 'x', ':' %}<a href="{{ u }}">x</a>`,
    `${branch("{% assign ps = 'javascriptxalert(1),b' | split: ',' %}")}{% for p in ps %}{% assign u = p | replace: 'x', ':' %}<a href="{{ u }}">x</a>{% endfor %}`,
    `${branch("{% assign ps0 = 'javascriptxalert(1),b' | split: ',' %}")}{% assign ps = ps0 %}{% for p in ps %}<a href="{{ p | replace: 'x', ':' }}">x</a>{% endfor %}`,
    `${branch("{% assign p = 'javascriptxalert(1)' %}")}{% liquid\nassign q = p\nassign u = q | replace: 'x', ':'\n%}<a href="{{ u }}">x</a>`,
    `${branch("{% assign u = 'javascript%3Aalert(1)' | url_decode %}")}<a href="{{ u }}">x</a>`,
    `${zz(`{% capture c %}${A390}|javascriptxalert(1){% endcapture %}`)}<a href="{{ c | split: '|' | last | replace: 'x', ':' }}">x</a>`,
    `${zz(`{% capture p %}${A390}javascriptxalert(1){% endcapture %}`)}<a href="{{ p | slice: 390, 100 | replace: 'x', ':' }}">x</a>`,
    `${zz(`{% assign p = '${A400}javascriptxalert(1)' %}`)}<a href="{{ p | slice: 400, 100 | replace: 'x', ':' }}">x</a>`,
    `${zz('{% capture p %}javascriptx{% raw %}%}{% endraw %}{% endcapture %}')}<a href="{{ p | replace: 'x', ':' }}">x</a>`,
    `${zz('{% capture p %}javascriptxalert(1)//%}{% endcapture %}')}{% assign u = p | replace: 'x', ':' %}<a href="{{ u }}">x</a>`,
    `${zz('{% capture c %}javascriptxalert(1)//%},b{% endcapture %}')}{% assign ps = c | split: ',' %}{% for p in ps %}<a href="{{ p | replace: 'x', ':' }}">x</a>{% endfor %}`,
    `${zz(`{% capture c %}${'B'.repeat(300)}{% endcapture %}`)}{% capture d %}{{ c }}{{ c }}javascriptxalert(1){% endcapture %}<a href="{{ d | slice: 600, 50 | replace: 'x', ':' }}">x</a>`,
    `{% capture p %}${Array.from({ length: 10 }, (_, i) => `{% if a == '${i}' %}${i}{% endif %}`).join('')}${zz('|javascriptxalert(1)')}{% endcapture %}<a href="{{ p | split: '|' | last | replace: 'x', ':' }}">x</a>`,
    `{% case a %}{% when 'zz' %}{% assign u = 'javascript:alert(1)' %}{% endcase %}<a href="{{ u }}">x</a>`,
    `${zz("{% assign parts = 'alert(1)|javascript' | split: '|' | reverse %}")}<a href="{{ parts | join: ':' }}">x</a>`,
    `${zz("{% liquid assign u = 'javascript' | append: ':alert(1)' %}")}<a href="{{ u }}">x</a>`,
    `${zz("{% assign u = 'javascript:alert(1)' %}")}<svg><a xlink:href="{{ u }}"><text>x</text></a></svg>`,
    `${zz("{% assign u = '/a.png 1x, javascript:alert(1) 2x' %}")}<img alt="" srcset="{{ u }}">`,
    `${zz("{% assign p = 'javascriptxalert(1)' %}")}<a href="{% echo p | replace: 'x', ':' %}">x</a>`,
    `{% assign ps = '/,javascript:alert(1)' | split: ',' %}{% for p in ps offset: 1 %}${zz('<a href="{{ p }}">x</a>')}{% endfor %}`,
    `${zz("{% capture p %}javascriptxalert('1'){% endcapture %}")}{% assign u = p | replace: 'x', ':' %}<a href="{{ u }}">x</a>`,
    `${zz('{% capture p %}javascript%3Aalert(1){% endcapture %}')}<a href="{{ p | url_decode }}">x</a>`,
  ],
  // 4.12: не-адресные атрибуты из Liquid
  'не-адресные атрибуты': [
    `<svg><rect fill="${zz('url(https://e.x/a)')}"/></svg>`,
    `${zz("{% assign f = 'url(https://e.x/a)' %}")}<svg><rect fill="{{ f }}"/></svg>`,
    `<p tabindex="${zz('5')}">x</p>`,
    '{% assign n = \'5\' %}<p tabindex="{{ n }}">x</p>',
    `${zz('{% capture t %}5{% endcapture %}')}<p tabindex="{{ t }}">x</p>`,
    `<p id="${zz('menu')}">x</p>`,
    "<p id=\"{{ 'me' | append: 'nu' }}\">x</p>",
    `<button popovertarget="${zz('site-menu')}">x</button>`,
    '<p id="{{ block.id }}">x</p>',
  ],
  // 4.12, круг 9: мутационный XSS — смена пространства имён при повторном разборе. Значение
  // атрибута (из поля или константой) после сборки становится разметкой
  'мутационный XSS': MXSS,
  // Данные поля: их статическая проверка не видит вовсе — только очистка при рендере
  'данные полей': [
    '<a href="{{ title }}">x</a>',
    '<a href="{{ a }}">x</a><img src="{{ b }}" alt="">',
    '{% for plan in plans %}<a href="{{ plan.url }}">{{ plan.name }}</a>{% endfor %}',
    '<p id="{{ a }}" tabindex="{{ b }}">x</p><button popovertarget="{{ t }}">x</button>',
    '<svg><rect fill="{{ a }}"/></svg>',
  ],
}

const fields: CustomBlockDraftInput['fields'] = [
  { type: 'text', name: 'title', label: 'Заголовок', required: true },
  { type: 'text', name: 'a', label: 'A' },
  { type: 'text', name: 'b', label: 'B' },
  { type: 'text', name: 't', label: 'T' },
  {
    type: 'repeater',
    name: 'plans',
    label: 'Тарифы',
    fields: [
      { type: 'text', name: 'name', label: 'Название', required: true },
      { type: 'text', name: 'url', label: 'Адрес' },
    ],
  },
]

const define = (template: string, example: Record<string, unknown>) =>
  CustomBlockDraft.parse({
    key: 'probe',
    title: 'Проба',
    description: 'Проба границы защиты',
    fields,
    template,
    example,
  })

const JS = 'javascript:alert(1)'
/** Данные блока: пример, ветки «zz», числа для case и if, опасные значения в самих полях */
const PROPS: readonly Record<string, unknown>[] = [
  { title: 'Т', a: 'q' },
  { title: 'Т' },
  // Пустые поля: на сайте такие данные схема не пропустит (заголовок обязателен), но сама
  // очистка проверяется и на них — sanitizeHtml над выводом Liquid
  {},
  { title: 'zz', a: 'zz', b: 'zz', t: 'zz' },
  { title: 't', a: 'zz' },
  { title: 'нет', a: '3', b: '', t: '' },
  { title: JS, a: JS, b: 'data:text/html,x', t: 'site-menu', plans: [{ name: 'п', url: JS }] },
  { title: 'url(https://e.x/a)', a: 'url(https://e.x/a)', b: '5', t: 'ym' },
  { title: 'ym', a: 'dataLayer', b: '7' },
  // Закрывающий тег в значении: после смены пространства имён он закрыл бы textarea или title
  {
    title: '</textarea><img src=1 onerror=alert(1)><a href=javascript:alert(1)>x</a>',
    a: '</textarea><img src=1 onerror=alert(1)>',
    b: '</title><img src=1 onerror=alert(1)>',
  },
]
/** id блока: обычные и любой длины от 1 до 16 (block.id.size как индекс) */
const IDS = [
  'example',
  'hero',
  'b-0f3c2a',
  ...Array.from({ length: 16 }, (_, i) => 'b'.repeat(i + 1)),
]

const all = Object.entries(HOSTILE).flatMap(([group, templates]) =>
  templates.map((template) => ({ group, template })),
)

/** Рендер без очистки: что вывел бы Liquid, не будь sanitizeHtml */
function rawRender(template: string, props: Record<string, unknown>, id: string) {
  try {
    return renderTemplate(
      template,
      { ...props, block: { id, key: 'probe' } },
      {
        media: {},
        priority: false,
      },
    )
  } catch (error) {
    if (error instanceof CustomBlockRenderError) return ''
    throw error
  }
}

/**
 * Очистка в один круг без правил о пространствах имён — как было до круга 9: убирает on* и опасные
 * адреса в дереве первого разбора и собирает HTML заново
 */
function naivePass(html: string) {
  const fragment = parseFragment(html)
  let removed = 0
  for (const node of [fragment, ...elementsOf(fragment)]) {
    const children = node.childNodes.filter(
      (one) => !isElement(one) || !FORBIDDEN_TAG.test(one.tagName),
    )
    removed += node.childNodes.length - children.length
    node.childNodes = children
    if (!('attrs' in node)) continue
    const kept = node.attrs.filter(
      (attr) =>
        !/^on/i.test(attr.name) && !(/href|src/.test(attr.name) && /javascript:/i.test(attr.value)),
    )
    removed += node.attrs.length - kept.length
    node.attrs = kept
  }
  return { html: serialize(fragment), removed }
}

function siteRender(template: string, props: Record<string, unknown>, id: string) {
  try {
    return renderCustomBlockHtml(define(template, { title: 'Т' }), props, {
      id,
      media: {},
      priority: false,
    })
  } catch (error) {
    // Блок не выводится вовсе (данные не подошли, лимит): на странице его нет — это безопасно
    if (error instanceof CustomBlockRenderError) return ''
    throw error
  }
}

describe('граница защиты своего блока — очистка при рендере', () => {
  // Сотни рендеров с повторным разбором: под нагрузкой полного прогона дольше 5 с по умолчанию
  it('шаблоны проверяющего на разных данных и при id блока разной длины не дают опасного HTML', {
    timeout: 30_000,
  }, () => {
    const leaks: string[] = []
    const harmless: string[] = []
    for (const { group, template } of all) {
      let raw = false
      const cases = [
        ...PROPS.flatMap((props) => IDS.slice(0, 3).map((id) => ({ props, id }))),
        ...IDS.slice(3).map((id) => ({ props: PROPS[0] ?? {}, id })),
      ]
      for (const { props, id } of cases) {
        const html = rawRender(template, props, id)
        // Опасное — и в выводе Liquid, и после разбора и сборки без повторной проверки
        if (dangersOf(html).length > 0 || dangersOf(naivePass(html).html).length > 0) raw = true
        const found = [
          ...dangersOf(siteRender(template, props, id)),
          ...dangersOf(sanitizeHtml(html)),
        ]
        if (found.length > 0) leaks.push(`${group}: ${template.slice(0, 80)} → ${found.join(', ')}`)
      }
      if (!raw) harmless.push(template)
    }
    expect(leaks).toEqual([])
    // Без очистки эти шаблоны и правда выводят опасное: тест проверяет очистку, а не безобидные
    // шаблоны. Безобидны и без неё только два: повтор href браузер отбрасывает, а фильтр в
    // коллекции for LiquidJS не применяет
    expect(harmless).toEqual([
      '<a href="/x" href="{% if t %}javascript:alert(1){% endif %}">x</a>',
      `<a href="{% for p in 'x/,javascript:alert(1)' | split: ',' %}{% if forloop.last %}{{ p }}{% endif %}{% endfor %}">x</a>`,
    ])
  })

  it('примеры последнего круга: без очистки опасное есть, после очистки — нет', () => {
    for (const template of HOSTILE['forloop, increment, block.id'] ?? []) {
      const ids = template.includes('block.') ? IDS : ['example']
      const props = [{ title: 'Т', a: 'zz' }]
      const raw = ids.flatMap((id) =>
        props.flatMap((one) => dangersOf(rawRender(template, one, id))),
      )
      expect(raw.length, template).toBeGreaterThan(0)
      const site = ids.flatMap((id) =>
        props.flatMap((one) => dangersOf(siteRender(template, one, id))),
      )
      expect(site, template).toEqual([])
    }
  })

  it('пробный рендер при сохранении ловит то, что выводят пример и пустые поля', () => {
    // Если готовый HTML на примере или на пустых полях опасен, сохранение даёт ошибку. Пример —
    // и обычный (ветки «zz» мимо), и тот, что ведёт в ветки: тогда пробный рендер видит и их
    const relevant = /запрещ|хитро|url\(\)|tabindex|JavaScript|вплотную/
    const examples = [
      { title: 'Т', a: 'q' },
      { title: 'zz', a: 'zz', b: 'zz', t: 'zz' },
    ]
    const missed: string[] = []
    let caught = 0
    for (const { template } of all) {
      for (const example of examples) {
        const definition = define(template, example)
        const scope = parsedExample(definition) ?? {}
        const shown = [
          rawRender(template, scope, 'example'),
          rawRender(template, {}, 'example'),
        ].flatMap((html) => dangersOf(html, { withIds: false }))
        if (shown.length === 0) continue
        const problems = customBlockProblems(definition)
          .filter((one) => one.level === 'error')
          .map((one) => one.message)
        if (problems.some((message) => relevant.test(message))) caught++
        else missed.push(`${template.slice(0, 80)} → ${shown.join(', ')} / ${problems.join('; ')}`)
      }
    }
    expect(missed).toEqual([])
    expect(caught).toBeGreaterThan(all.length)
  })

  it('мутационный XSS: правила о пространствах имён вырезают MathML и HTML внутри SVG', () => {
    expect(sanitizeHtml('<math><mi>x</mi></math><p>a</p>')).toBe('<p>a</p>')
    expect(sanitizeHtml('<mglyph>a</mglyph><malignmark>b</malignmark><p>c</p>')).toBe('<p>c</p>')
    expect(sanitizeHtml('<svg><desc><p>x</p>t</desc><rect></rect></svg>')).toBe(
      '<svg><desc>t</desc><rect></rect></svg>',
    )
    // Обычный SVG не трогаем: вложенный svg и a внутри svg — элементы SVG
    expect(sanitizeHtml('<svg><svg><a href="/x"><text>x</text></a></svg></svg>')).toBe(
      '<svg><svg><a href="/x"><text>x</text></a></svg></svg>',
    )
    const desc = customBlockProblems(
      define('<svg><desc><p>{{ title }}</p></desc></svg>', { title: 'Т' }),
    )
    expect(desc.map((one) => one.message).join('; ')).toContain('<p> внутри <svg> недоступен')
    for (const template of MXSS.filter((one) => one.includes('{{'))) {
      const messages = customBlockProblems(define(template, { title: 'Т' }))
        .filter((one) => one.level === 'error')
        .map((one) => one.message)
        .join('; ')
      expect(messages, template).toMatch(/<(?:math|mglyph|malignmark|table)>/)
    }
  })

  it('мутационный XSS: очистка в один круг пропускает, повторный разбор до устойчивости — нет', () => {
    const payloads = MXSS.filter((one) => !one.includes('{{'))
    const naive = payloads.flatMap((html) => dangersOf(naivePass(html).html))
    expect(naive).toContain('onerror')
    expect(naive).toContain('href=javascript:alert(1)')
    // Тот же простой круг, но до неподвижной точки: браузер получает только то, что его повторный
    // разбор уже не меняет
    const stable = payloads.flatMap((html) => dangersOf(untilStable(html, naivePass)))
    expect(stable).toEqual([])
    // Не устоялось — не выводим ничего
    let round = 0
    expect(untilStable('x', () => ({ html: `x${round++}`, removed: 1 }))).toBe('')
  })

  it('вывод очистки устойчив: повторная очистка и повторный разбор в <div> его не меняют', () => {
    const context = parseFragment('<div></div>').childNodes[0] as Element
    const unstable: string[] = []
    for (const { template } of all) {
      for (const props of PROPS) {
        const html = siteRender(template, props, 'example')
        if (sanitizeHtml(html) !== html) unstable.push(`очистка: ${template.slice(0, 60)}`)
        if (serialize(parseFragment(context, html, {})) !== html) {
          unstable.push(`разбор: ${template.slice(0, 60)}`)
        }
      }
    }
    expect(unstable).toEqual([])
  })
})
