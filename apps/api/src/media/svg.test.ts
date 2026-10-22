import { SaxesParser } from 'saxes'
import { describe, expect, it } from 'vitest'
import { looksLikeSvg, MAX_SVG_DEPTH, safeCss, sanitizeSvg, svgForRaster } from './svg'

const bytes = (text: string) => new TextEncoder().encode(text)
const NS = 'xmlns="http://www.w3.org/2000/svg"'
const XLINK = 'xmlns:xlink="http://www.w3.org/1999/xlink"'
const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/** Разбирает строгий XML-парсер (с пространствами имён) — иначе бросает с причиной */
const parseXml = (markup: string) =>
  new SaxesParser({ xmlns: true, position: false }).write(markup).close()

/**
 * Очищенный SVG строкой; отказ — ошибка теста. Общий инвариант для каждого вывода: это XML, без
 * повторов атрибутов — иначе браузер не покажет логотип, а librsvg не соберёт иконку
 */
function clean(svg: string) {
  const result = sanitizeSvg(bytes(svg))
  if (!result.ok) throw new Error(`Отказ: ${result.reason}`)
  const output = new TextDecoder().decode(result.svg.data)
  expect(() => parseXml(output)).not.toThrow()
  return output
}

const failure = (svg: string | Uint8Array) => {
  const result = sanitizeSvg(typeof svg === 'string' ? bytes(svg) : svg)
  return result.ok ? undefined : result.reason
}

/** Ничего опасного в результате: ни скриптов, ни обработчиков, ни ссылок наружу */
function expectHarmless(output: string) {
  expect(output).not.toMatch(/<script|<foreignObject|<iframe|<object|<embed|<set|<animate/i)
  expect(output).not.toMatch(/\son[a-z]+\s*=/i)
  expect(output).not.toMatch(/javascript:|vbscript:|data:text|data:image\/svg/i)
  expect(output).not.toMatch(/https?:\/\/(?!www\.w3\.org\/(2000\/svg|1999\/xlink)")/i)
  expect(output).not.toMatch(/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i)
  // CSS: ни @import, ни url() кроме url(#id) — где бы он ни оказался после очистки
  expect(output).not.toMatch(/@import|@font-face/i)
  for (const match of output.matchAll(/url\(\s*(['"]?)([^)'"]*)/gi)) {
    expect(match[2]).toMatch(/^#/)
  }
  // В <style> — только текст
  expect(output).not.toMatch(/<style[^>]*>[^<]*<(?!\/style>)/)
}

describe('sanitizeSvg: вредоносные образцы', () => {
  it.each([
    [
      'script',
      `<svg ${NS} viewBox="0 0 10 10"><script>alert(1)</script><rect width="10" height="10"/></svg>`,
    ],
    [
      'script в чужом регистре и CDATA',
      `<svg ${NS} viewBox="0 0 10 10"><SCRIPT><![CDATA[alert(1)]]></SCRIPT></svg>`,
    ],
    [
      'onload у корня',
      `<svg ${NS} viewBox="0 0 10 10" onload="alert(1)"><rect width="1" height="1"/></svg>`,
    ],
    [
      'onclick у фигуры',
      `<svg ${NS} viewBox="0 0 10 10"><rect onclick="alert(1)" onmouseover="x()" width="1" height="1"/></svg>`,
    ],
    [
      'xlink:href javascript: у ссылки',
      `<svg ${NS} ${XLINK} viewBox="0 0 10 10"><a xlink:href="javascript:alert(1)"><rect width="1" height="1"/></a></svg>`,
    ],
    [
      'href javascript: с пробелами и сущностями',
      `<svg ${NS} viewBox="0 0 10 10"><a href=" &#106;avascript:alert(1)"><text>Жми</text></a></svg>`,
    ],
    [
      'foreignObject с HTML',
      `<svg ${NS} viewBox="0 0 10 10"><foreignObject width="10" height="10"><body xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(1)"/></body></foreignObject></svg>`,
    ],
    [
      'use на внешний файл',
      `<svg ${NS} ${XLINK} viewBox="0 0 10 10"><use xlink:href="https://evil.example/sprite.svg#a"/></svg>`,
    ],
    [
      'image с внешней картинкой (следит за посетителем)',
      `<svg ${NS} viewBox="0 0 10 10"><image href="https://evil.example/pixel.png" width="1" height="1"/></svg>`,
    ],
    [
      'image с data:image/svg+xml',
      `<svg ${NS} viewBox="0 0 10 10"><image href="data:image/svg+xml;base64,PHN2Zy8+" width="1" height="1"/></svg>`,
    ],
    [
      'image с data:text/html',
      `<svg ${NS} viewBox="0 0 10 10"><image href="data:text/html;base64,PHNjcmlwdD4=" width="1" height="1"/></svg>`,
    ],
    [
      'set подменяет href на javascript:',
      `<svg ${NS} viewBox="0 0 10 10"><a><set attributeName="href" to="javascript:alert(1)"/><circle r="5"/></a></svg>`,
    ],
    [
      'animate по href',
      `<svg ${NS} viewBox="0 0 10 10"><animate attributeName="href" values="javascript:alert(1)"/></svg>`,
    ],
    [
      'style с @import и url наружу',
      `<svg ${NS} viewBox="0 0 10 10"><style>@import url(https://evil.example/a.css); rect{fill:url(https://evil.example/x)}</style><rect width="1" height="1"/></svg>`,
    ],
    [
      'style-атрибут с url наружу и экранированием',
      `<svg ${NS} viewBox="0 0 10 10"><rect style="fill:url(https://evil.example/x)" width="1" height="1"/><rect style="background:\\75 rl(https://evil.example/y)" width="1" height="1"/></svg>`,
    ],
    [
      'fill с url наружу',
      `<svg ${NS} viewBox="0 0 10 10"><rect fill="url(https://evil.example/p.svg#g)" width="1" height="1"/></svg>`,
    ],
    [
      'xml-stylesheet',
      `<?xml-stylesheet href="https://evil.example/a.css"?><svg ${NS} viewBox="0 0 10 10"><rect width="1" height="1"/></svg>`,
    ],
    [
      'iframe, object и embed в пространстве SVG',
      `<svg ${NS} viewBox="0 0 10 10"><iframe src="https://evil.example"/><object data="https://evil.example"/><embed src="https://evil.example"/></svg>`,
    ],
    [
      'элементы в чужом пространстве имён',
      `<svg ${NS} xmlns:h="http://www.w3.org/1999/xhtml" viewBox="0 0 10 10"><h:script>alert(1)</h:script><h:iframe src="https://evil.example"/></svg>`,
    ],
    [
      'style с обёрткой <a>: текст обёртки не становится CSS',
      `<svg ${NS} viewBox="0 0 10 10"><style><a>@import url(http://evil.example/a.css); rect{fill:url(http://evil.example/p)}</a></style><rect width="1" height="1"/></svg>`,
    ],
    [
      'style с обёрткой <switch>',
      `<svg ${NS} viewBox="0 0 10 10"><style>rect{fill:red}<switch>rect{fill:url(http://evil.example/p)}</switch></style><rect width="1" height="1"/></svg>`,
    ],
    [
      'style с <text> и <g> внутри',
      `<svg ${NS} viewBox="0 0 10 10"><style><text>rect{fill:url(//evil.example/t)}</text><g><a>@import "x.css";</a></g></style><rect width="1" height="1"/></svg>`,
    ],
    [
      'title и desc с элементами внутри',
      `<svg ${NS} viewBox="0 0 10 10"><title><a href="https://evil.example">Лого</a></title><desc><text>x</text></desc></svg>`,
    ],
    [
      'feImage на внешний файл',
      `<svg ${NS} viewBox="0 0 10 10"><filter id="f"><feImage href="https://evil.example/x.png"/></filter></svg>`,
    ],
  ])('%s', (_, svg) => {
    expectHarmless(clean(svg))
  })

  it('DOCTYPE с объявлением сущностей (billion laughs, XXE) — отказ', () => {
    const laughs = `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]><svg ${NS} viewBox="0 0 10 10"><text>&lol2;</text></svg>`
    const xxe = `<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg ${NS} viewBox="0 0 10 10"><text>&xxe;</text></svg>`
    expect(failure(laughs)).toBe('doctype')
    expect(failure(xxe)).toBe('doctype')
  })

  it('неизвестная сущность без DOCTYPE — отказ, а не текст', () => {
    expect(failure(`<svg ${NS} viewBox="0 0 10 10"><text>&xxe;</text></svg>`)).toBe('broken')
  })

  it('DOCTYPE без сущностей (старый Illustrator) выбрасывается молча', () => {
    const svg = `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg ${NS} viewBox="0 0 10 10"><rect width="1" height="1"/></svg>`
    const output = clean(svg)
    expectHarmless(output)
    expect(output).toContain('<rect width="1" height="1"/>')
  })

  it('не XML, не SVG и битый XML — отказ', () => {
    expect(failure('<html><body>Привет</body></html>')).toBe('broken')
    expect(failure(`<svg ${NS} viewBox="0 0 10 10"><rect></svg>`)).toBe('broken')
    expect(failure('<svg viewBox="0 0 10 10"><rect/></svg>')).toBe('broken')
    expect(failure(`<svg ${NS} viewBox="0 0 1 1"><x:rect/></svg>`)).toBe('broken')
    expect(failure('просто текст')).toBe('broken')
  })

  it('не UTF-8 — отказ', () => {
    expect(failure(new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0xff, 0xfe]))).toBe('encoding')
    expect(
      failure(`<?xml version="1.0" encoding="windows-1251"?><svg ${NS} viewBox="0 0 1 1"/>`),
    ).toBe('encoding')
  })

  it('слишком глубокая вложенность — отказ', () => {
    const deep = `<svg ${NS} viewBox="0 0 1 1">${'<g>'.repeat(MAX_SVG_DEPTH)}${'</g>'.repeat(MAX_SVG_DEPTH)}</svg>`
    expect(failure(deep)).toBe('too_deep')
  })
})

describe('sanitizeSvg: обёртки внутри style и ссылки', () => {
  it('элементы внутри <style> выбрасываются вместе с текстом, свой CSS остаётся', () => {
    const output = clean(
      `<svg ${NS} viewBox="0 0 10 10"><style>rect{fill:url(#g)}<a>@import url(http://evil.example/a.css);</a></style><rect width="1" height="1"/></svg>`,
    )
    expect(output).toContain('<style>rect{fill:url(#g)}</style>')
    expect(output).not.toContain('evil')
  })

  it('href и xlink:href на одном элементе: одна ссылка, главнее href (SVG 2)', () => {
    const output = clean(
      `<svg ${NS} ${XLINK} viewBox="0 0 10 10"><defs><rect id="a" width="1" height="1"/><rect id="b" width="2" height="2"/></defs><use href="#a" xlink:href="#b"/><use xlink:href="#b" href="#a"/></svg>`,
    )
    expect(output.match(/xlink:href=/g)).toHaveLength(2)
    expect(output).not.toContain('xlink:href="#b"')
  })

  it('href наружу и xlink:href на фрагмент: главнее href, ссылки нет совсем', () => {
    const output = clean(
      `<svg ${NS} ${XLINK} viewBox="0 0 10 10"><use href="https://evil.example/s.svg#a" xlink:href="#a"/></svg>`,
    )
    expect(output).toContain('<use/>')
  })

  it('image с href и xlink:href: картинка одна и проверяется один раз', () => {
    const data = `data:image/png;base64,${PNG_1PX}`
    const result = sanitizeSvg(
      bytes(
        `<svg ${NS} ${XLINK} viewBox="0 0 1 1"><image width="1" height="1" href="${data}" xlink:href="${data}"/></svg>`,
      ),
    )
    if (!result.ok) throw new Error(result.reason)
    expect(result.svg.embedded).toHaveLength(1)
    expect(() => parseXml(new TextDecoder().decode(result.svg.data))).not.toThrow()
  })
})

describe('svgForRaster', () => {
  const rasterRoot = (svg: string, size: number) =>
    new TextDecoder().decode(svgForRaster(bytes(clean(svg)), size)).match(/^<svg[^>]*>/)?.[0]

  it.each([
    ['чертёж A4 в сотых миллиметра', '0 0 21000 29700', 16, ['11', '16']],
    ['крошечный viewBox', '0 0 0.1 0.1', 512, ['512', '512']],
    ['вытянутый: меньшая сторона не меньше 1 px', '0 0 5000 3', 16, ['16', '1']],
  ])('%s → размеры в пикселях', (_, viewBox, size, [width, height]) => {
    const root = rasterRoot(
      `<svg ${NS} viewBox="${viewBox}"><rect width="1" height="1"/></svg>`,
      size,
    )
    expect(root).toContain(` width="${width}" height="${height}"`)
    expect(root).toContain(`viewBox="${viewBox}"`)
  })

  it('stroke-width у корня не путается с width', () => {
    const root = rasterRoot(
      `<svg ${NS} viewBox="0 0 100 50" stroke-width="3"><rect width="1" height="1"/></svg>`,
      512,
    )
    expect(root).toContain(' width="512" height="256"')
    expect(root).toContain('stroke-width="3"')
  })

  it('файл без размеров у корня — как есть', () => {
    const svg = bytes(`<svg ${NS} viewBox="0 0 1 1"/>`)
    expect(svgForRaster(svg, 16)).toBe(svg)
  })
})

describe('sanitizeSvg: что остаётся', () => {
  it('фигуры, градиент по url(#id), use по #фрагменту, текст и title', () => {
    const svg = `<?xml version="1.0"?>
<!-- Generator: Illustrator -->
<svg ${NS} ${XLINK} viewBox="0 0 120 40" width="120" height="40">
  <title>Ремонт &amp; отделка</title>
  <defs>
    <linearGradient id="g"><stop offset="0" stop-color="#f60"/><stop offset="1" stop-color="#c30"/></linearGradient>
    <path id="p" d="M0 0h10v10z"/>
  </defs>
  <style>.st0{fill:url(#g)} .a > .b{opacity:.5}</style>
  <use xlink:href="#p" class="st0"/>
  <rect x="0" y="0" width="10" height="10" fill="url(#g)" style="stroke:#000;stroke-width:2"/>
  <text x="20" y="30" font-family="Golos Text">Averra</text>
</svg>`
    const output = clean(svg)
    expectHarmless(output)
    expect(output).toMatch(
      /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink" width="120" height="40" viewBox="0 0 120 40">/,
    )
    expect(output).toContain('<title>Ремонт &amp; отделка</title>')
    expect(output).toContain('<use xlink:href="#p" class="st0"/>')
    expect(output).toContain('fill="url(#g)"')
    expect(output).toContain('style="stroke:#000;stroke-width:2"')
    expect(output).toContain('<style>.st0{fill:url(#g)} .a &gt; .b{opacity:.5}</style>')
    expect(output).toContain('<text x="20" y="30" font-family="Golos Text">Averra</text>')
    // Комментарии и пробелы между тегами не попадают
    expect(output).not.toContain('Illustrator')
    expect(output).not.toMatch(/>\s+</)
  })

  it('ссылка <a> и <switch> разворачиваются: рисунок внутри остаётся', () => {
    const svg = `<svg ${NS} viewBox="0 0 10 10"><switch><foreignObject><p/></foreignObject><g><a href="https://example.com"><circle r="5"/></a></g></switch></svg>`
    expect(clean(svg)).toBe(
      `<svg ${NS} width="100" height="100" viewBox="0 0 10 10"><g><circle r="5"/></g></svg>`,
    )
  })

  it('встроенная PNG-картинка остаётся и попадает в список на проверку', () => {
    const result = sanitizeSvg(
      bytes(
        `<svg ${NS} viewBox="0 0 1 1"><image width="1" height="1" href="data:image/png;base64,${PNG_1PX}"/></svg>`,
      ),
    )
    if (!result.ok) throw new Error(result.reason)
    expect(new TextDecoder().decode(result.svg.data)).toContain(
      `xlink:href="data:image/png;base64,${PNG_1PX}"`,
    )
    expect(result.svg.embedded).toHaveLength(1)
    expect(result.svg.embedded[0]?.declared).toBe('image/png')
    expect(result.svg.embedded[0]?.data.slice(1, 4)).toEqual(bytes('PNG'))
  })

  it('чужие атрибуты редакторов и пространства имён выбрасываются', () => {
    const svg = `<svg ${NS} xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" viewBox="0 0 10 10" inkscape:version="1.3"><sodipodi:namedview/><g inkscape:label="Слой 1" data-x="1"><path d="M0 0"/></g></svg>`
    expect(clean(svg)).toBe(
      `<svg ${NS} width="100" height="100" viewBox="0 0 10 10"><g><path d="M0 0"/></g></svg>`,
    )
  })
})

describe('sanitizeSvg: размеры', () => {
  it('по viewBox; width и height у корня ставятся числами', () => {
    const result = sanitizeSvg(
      bytes(`<svg ${NS} viewBox="0 0 240.5 80" width="100%"><rect/></svg>`),
    )
    expect(result).toMatchObject({ ok: true, svg: { width: 241, height: 80 } })
    expect(clean(`<svg ${NS} viewBox="0,0,240.5,80" width="100%"/>`)).toBe(
      `<svg ${NS} width="240.5" height="80" viewBox="0,0,240.5,80"/>`,
    )
  })

  it('без viewBox — по width и height в px, viewBox добавляется', () => {
    expect(clean(`<svg ${NS} width="640px" height="320"/>`)).toBe(
      `<svg ${NS} width="640" height="320" viewBox="0 0 640 320"/>`,
    )
    // Маленький — дотягивается до 100 по длинной стороне, viewBox — в исходных единицах
    expect(clean(`<svg ${NS} width="64px" height="32"/>`)).toBe(
      `<svg ${NS} width="100" height="50" viewBox="0 0 64 32"/>`,
    )
  })

  it.each([
    // viewBox, сохранённые width и height в файле, в базе
    ['крошечный viewBox: не обнуляется', '0 0 0.0004 0.0004', ['100', '100'], [100, 100]],
    ['маленький viewBox: пропорции не искажаются', '0 0 1.5 1', ['100', '66.667'], [100, 67]],
    ['обычный — как есть', '0 0 240 80', ['240', '80'], [240, 80]],
    ['вытянутый: меньшая сторона не «0»', '0 0 100000 0.01', ['100000', '0.01'], [100000, 1]],
  ])('%s', (_, viewBox, [width, height], [dbWidth, dbHeight]) => {
    const svg = `<svg ${NS} viewBox="${viewBox}"><rect width="1" height="1"/></svg>`
    expect(clean(svg)).toContain(` width="${width}" height="${height}" viewBox="${viewBox}"`)
    expect(sanitizeSvg(bytes(svg))).toMatchObject({
      ok: true,
      svg: { width: dbWidth, height: dbHeight },
    })
  })

  it('размер в миллиметрах (Inkscape) — в пикселях, а не в единицах viewBox', () => {
    // 52,92 мм — 200 px: файл показывается того размера, что задумал автор
    const inkscape = `<svg ${NS} width="52.917mm" height="26.458mm" viewBox="0 0 52.917 26.458"/>`
    expect(clean(inkscape)).toBe(
      `<svg ${NS} width="200.001" height="99.999" viewBox="0 0 52.917 26.458"/>`,
    )
    expect(clean(`<svg ${NS} width="1in" height="0.5in"/>`)).toBe(
      `<svg ${NS} width="100" height="50" viewBox="0 0 96 48"/>`,
    )
  })

  it('без размеров или в относительных единицах без viewBox — отказ', () => {
    expect(failure(`<svg ${NS}><rect/></svg>`)).toBe('no_size')
    expect(failure(`<svg ${NS} width="10em" height="5em"/>`)).toBe('no_size')
    expect(failure(`<svg ${NS} viewBox="0 0 0 10"/>`)).toBe('no_size')
    // Без viewBox крошечные размеры обнулили бы дописанный viewBox — картинку не видно
    expect(failure(`<svg ${NS} width="0.0001" height="0.0001"/>`)).toBe('no_size')
  })

  it('сторона больше 100 000 — отказ', () => {
    expect(failure(`<svg ${NS} viewBox="0 0 1000000 10"/>`)).toBe('bad_size')
  })

  it('длинная строка цифр с мусором в размере разбирается быстро', () => {
    // Регулярка с перекрытием «\d*\.?\d+» разбирала такой атрибут квадратичное время: файл
    // меньше лимита загрузки занимал процесс API на минуту
    const digits = '1'.repeat(60_000)
    const started = performance.now()
    const svg = `<svg ${NS} width="${digits}x" height="${digits}x" viewBox="0 0 2 1"/>`
    expect(clean(svg)).toBe(`<svg ${NS} width="100" height="50" viewBox="0 0 2 1"/>`)
    expect(failure(`<svg ${NS} width="${digits}x" height="1"/>`)).toBe('no_size')
    const raster = svgForRaster(bytes(`<svg ${NS} width="${digits}x" height="1"/>`), 16)
    expect(raster.length).toBeGreaterThan(digits.length)
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('длина: дробная, с экспонентой, с точкой в конце', () => {
    expect(clean(`<svg ${NS} width=".5in" height="1.e2"/>`)).toBe(
      `<svg ${NS} width="48" height="100" viewBox="0 0 48 100"/>`,
    )
  })
})

describe('looksLikeSvg и safeCss', () => {
  it('SVG/XML — по первому значащему символу «<»', () => {
    expect(looksLikeSvg(bytes(`﻿  \n<svg ${NS}/>`))).toBe(true)
    expect(looksLikeSvg(bytes('<?xml version="1.0"?><svg/>'))).toBe(true)
    expect(looksLikeSvg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false)
    expect(looksLikeSvg(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(false)
    expect(looksLikeSvg(new Uint8Array())).toBe(false)
  })

  it.each([
    ['fill:url(#a)', true],
    ["fill:url('#a')", true],
    ['fill: #f60; stroke: red', true],
    ['fill:url(https://x)', false],
    ['fill:url(#a) url(//x)', false],
    ['@import "x.css"', false],
    ['background:image-set("x.png" 1x)', false],
    ['width:expression(alert(1))', false],
    ['fill:\\75 rl(x)', false],
    ['x:javascript:alert(1)', false],
  ])('%s → %s', (css, safe) => {
    expect(safeCss(css)).toBe(safe)
  })
})
