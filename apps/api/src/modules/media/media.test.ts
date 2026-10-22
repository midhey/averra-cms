import { readdir } from 'node:fs/promises'
import { crc32 } from 'node:zlib'
import { demoSiteId, type PageContentInput } from '@averra/schema'
import sharp from 'sharp'
import { afterAll, describe, expect, it } from 'vitest'
import { type ImageProcessor, MAX_PIXELS, MAX_VARIANT_SIDE } from '../../media/processor'
import { sharpProcessor } from '../../media/sharp-processor'
import { mediaKey } from '../../media/storage'
import { createTestApi } from '../../testing'

// Медиатека через настоящие запросы: загрузка multipart, нарезка sharp, хранилище во временной
// папке. Картинки для тестов рисует sharp — так видно, что именно лежит в файле

const api = await createTestApi()
const { app, storage, loginAs } = api
afterAll(api.close)

type Headers = Record<string, string>

const owner = await loginAs('owner')

const mediaUrl = (siteId: string) => `/api/sites/${siteId}/media`

function upload(
  headers: Headers,
  data: Uint8Array<ArrayBuffer> | string,
  name = 'photo.jpg',
  siteId = demoSiteId,
  type = 'image/jpeg',
) {
  const body = new FormData()
  body.append('file', new File([data], name, { type }))
  return app.request(mediaUrl(siteId), { method: 'POST', headers, body })
}

type Uploaded = {
  id: string
  originalName: string
  mimeType: string
  width: number
  height: number
  size: number
  author: { kind: string; name: string } | null
  variants: { format: string; width: number; height: number; size: number; url: string }[]
}

type Library = { items: Uploaded[]; maxBytes: number }

async function library(testApp: typeof app, headers: Headers, siteId = demoSiteId) {
  const res = await testApp.request(mediaUrl(siteId), { headers })
  expect(res.status).toBe(200)
  return (await res.json()) as Library
}

/** Все файлы в папке медиатеки (пустая или ещё не созданная папка — пустой список) */
async function filesIn(dir: string) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => `${entry.parentPath}/${entry.name}`)
    .toSorted()
}

async function uploaded(res: Response) {
  expect(res.status, await res.clone().text()).toBe(201)
  return (await res.json()) as Uploaded
}

const remove = (headers: Headers, mediaId: string, siteId = demoSiteId) =>
  app.request(`${mediaUrl(siteId)}/${mediaId}`, { method: 'DELETE', headers })

/** Заливка цветом нужного размера в нужном формате */
async function picture(width: number, height: number, format: 'jpeg' | 'png' | 'webp' | 'avif') {
  const base = sharp({ create: { width, height, channels: 3, background: '#3b6ea8' } })
  return new Uint8Array(await base.toFormat(format).toBuffer())
}

/** JPEG с тем, что прятать нельзя: GPS, автор, XMP — и поворотом на 90° (ориентация 6) */
async function jpegWithExif() {
  const xmp =
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Иван</dc:creator>' +
    '</rdf:Description></rdf:RDF></x:xmpmeta>'
  const data = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: '#a83b3b' },
  })
    .jpeg()
    .withExif({
      IFD0: { Copyright: 'Secret Author', Artist: 'Ivan Petrov' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '55/1 45/1 2100/100' },
    })
    .withMetadata({ orientation: 6 })
    .withXmp(xmp)
    .toBuffer()
  // Проверяем саму заготовку: иначе тест «метаданных нет» прошёл бы и на пустом файле
  const metadata = await sharp(data).metadata()
  expect(metadata).toMatchObject({ orientation: 6, width: 1200, height: 800 })
  expect(metadata.exif?.toString('latin1')).toContain('Secret Author')
  expect(metadata.xmp).toBeDefined()
  return new Uint8Array(data)
}

async function fetchFile(url: string) {
  const res = await app.request(url)
  expect(res.status, url).toBe(200)
  return new Uint8Array(await res.arrayBuffer())
}

const widthsOf = (media: Uploaded, format: string) =>
  media.variants
    .filter((variant) => variant.format === format)
    .map((variant) => variant.width)
    .toSorted((a, b) => a - b)

describe('загрузка', () => {
  it('JPEG с EXIF: метаданных нет ни в одном варианте, снимок повёрнут по EXIF', async () => {
    const media = await uploaded(await upload(owner.headers, await jpegWithExif()))
    // Ориентация 6 — поворот на 90°: 1200×800 становится 800×1200
    expect(media).toMatchObject({ mimeType: 'image/jpeg', width: 800, height: 1200 })
    expect(media.variants.length).toBeGreaterThan(0)

    for (const variant of media.variants) {
      const metadata = await sharp(await fetchFile(variant.url)).metadata()
      expect(metadata.exif, variant.url).toBeUndefined()
      expect(metadata.xmp, variant.url).toBeUndefined()
      expect(metadata.iptc, variant.url).toBeUndefined()
      expect(metadata.orientation ?? 1, variant.url).toBe(1)
      expect(metadata.height, variant.url).toBeGreaterThan(metadata.width)
    }

    // Чистый оригинал наружу не отдаётся, но и в хранилище он без метаданных
    const original = await storage.get(mediaKey(demoSiteId, media.id, 'original.jpg'))
    expect(original).toBeDefined()
    const originalMeta = await sharp(original).metadata()
    expect(originalMeta).toMatchObject({ width: 800, height: 1200 })
    expect(originalMeta.exif).toBeUndefined()
    expect(originalMeta.xmp).toBeUndefined()
  })

  it('режет каждую ширину в AVIF, WebP и исходный формат, тип файла — по содержимому', async () => {
    const media = await uploaded(await upload(owner.headers, await picture(1000, 500, 'jpeg')))
    expect(widthsOf(media, 'avif')).toEqual([480, 960, 1000])
    expect(widthsOf(media, 'webp')).toEqual([480, 960, 1000])
    expect(widthsOf(media, 'jpeg')).toEqual([480, 960, 1000])

    for (const variant of media.variants) {
      const metadata = await sharp(await fetchFile(variant.url)).metadata()
      const mediaType = { avif: 'image/avif', webp: 'image/webp', jpeg: 'image/jpeg' }
      expect(metadata.mediaType).toBe(mediaType[variant.format as keyof typeof mediaType])
      expect(metadata.width).toBe(variant.width)
      expect(metadata.height).toBe(variant.height)
      expect(variant.height).toBe(variant.width / 2)
    }
  })

  it.each([
    [3000, [480, 960, 1440, 1920]],
    [1920, [480, 960, 1440, 1920]],
    [1000, [480, 960, 1000]],
    [300, [300]],
  ])('варианты не шире исходника: %i px → %j', async (width, expected) => {
    const media = await uploaded(
      await upload(owner.headers, await picture(width, 200, 'png'), 'wide.png'),
    )
    expect(widthsOf(media, 'webp')).toEqual(expected)
    expect(Math.max(...media.variants.map((variant) => variant.width))).toBeLessThanOrEqual(width)
  })

  it.each([
    ['png', 'image/png', ['avif', 'png', 'webp']],
    ['webp', 'image/webp', ['avif', 'webp']],
    ['avif', 'image/avif', ['avif', 'webp']],
  ] as const)('принимает %s: запасной формат — исходный', async (format, mimeType, formats) => {
    const media = await uploaded(
      await upload(owner.headers, await picture(600, 400, format), `pic.${format}`),
    )
    expect(media.mimeType).toBe(mimeType)
    expect([...new Set(media.variants.map((variant) => variant.format))].toSorted()).toEqual(
      formats,
    )
  })

  it('запоминает имя файла, вес и автора; новая картинка — первой в медиатеке', async () => {
    const data = await picture(500, 500, 'webp')
    const media = await uploaded(await upload(owner.headers, data, '  Фото\u0000 бригады.webp '))
    expect(media).toMatchObject({
      originalName: 'Фото бригады.webp',
      size: data.byteLength,
      author: { kind: 'user', name: 'Тестовый owner' },
    })
    const [first] = (await library(app, owner.headers)).items
    expect(first?.id).toBe(media.id)
  })

  it('токен своего сайта загружает, автор — название токена', async () => {
    const { token } = await api.createToken(demoSiteId, 'mcp-картинки')
    const media = await uploaded(
      await upload({ authorization: `Bearer ${token}` }, await picture(200, 100, 'png'), 'a.png'),
    )
    expect(media.author).toEqual({ kind: 'token', name: 'mcp-картинки' })
  })
})

describe('отказ в загрузке', () => {
  it.each([
    ['текст под видом JPEG', 'просто текст, а не картинка', 'photo.jpg', 'image/jpeg'],
    ['мусор под видом PNG', '\x01\x02 не картинка', 'photo.png', 'image/png'],
  ])('%s → 415 с понятным сообщением', async (_, data, name, type) => {
    const res = await upload(owner.headers, data, name, demoSiteId, type)
    expect(res.status).toBe(415)
    expect(await res.json()).toMatchObject({
      error: {
        code: 'unsupported_media_type',
        message: expect.stringMatching(/JPEG, PNG, WebP, AVIF или SVG/),
        issues: [{ path: 'file' }],
      },
    })
  })

  it('SVG под видом PNG: тип — по содержимому, файл принят как SVG и очищен', async () => {
    const res = await upload(
      owner.headers,
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>',
      'logo.png',
      demoSiteId,
      'image/png',
    )
    const media = await uploaded(res)
    expect(media.mimeType).toBe('image/svg+xml')
    const stored = await storage.get(mediaKey(demoSiteId, media.id, 'image.svg'))
    expect(new TextDecoder().decode(stored)).not.toContain('script')
  })

  it('очень высокая картинка (длинная инфографика) загружается: варианты ужаты до предела WebP', async () => {
    // 200 × 20000: вариант шириной 200 вышел бы выше 16383 px, а больше WebP и AVIF не умеют.
    // Раньше кодирование падало, и такая картинка получала 415 «файл повреждён»
    const media = await uploaded(await upload(owner.headers, await picture(200, 20_000, 'jpeg')))
    expect(media).toMatchObject({ width: 200, height: 20_000 })
    expect(media.variants.length).toBeGreaterThan(0)
    for (const variant of media.variants) {
      expect(variant.height).toBeLessThanOrEqual(MAX_VARIANT_SIDE)
      // Пропорции те же: ширина ужимается вместе с высотой
      expect(Math.abs(variant.height / variant.width - 100)).toBeLessThan(1)
    }
    const widest = media.variants.filter((variant) => variant.format === 'webp').at(-1)
    expect(widest?.height).toBe(MAX_VARIANT_SIDE)
  })

  it('GIF → 415: из растровых принимаются только четыре формата', async () => {
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } })
      .gif()
      .toBuffer()
    const res = await upload(
      owner.headers,
      new Uint8Array(gif),
      'anim.gif',
      demoSiteId,
      'image/gif',
    )
    expect(res.status).toBe(415)
  })

  it('битый JPEG (верный заголовок, обрезанные данные) → 415 «файл повреждён»', async () => {
    const full = await picture(800, 600, 'jpeg')
    const res = await upload(owner.headers, full.slice(0, 400))
    expect(res.status).toBe(415)
    expect(await res.json()).toMatchObject({
      error: { message: expect.stringMatching(/повреждён/) },
    })
  })

  it('запрос без файла → 400 с путём до поля', async () => {
    const res = await app.request(mediaUrl(demoSiteId), {
      method: 'POST',
      headers: owner.headers,
      body: new FormData(),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: { issues: [{ path: 'file' }] } })
  })

  it('медиатека чужого или несуществующего сайта не видна: 404', async () => {
    const editor = await loginAs('editor')
    // API сайтов не создаёт (одна установка — один сайт): сайт кладётся в базу напрямую
    const foreignSiteId = await api.createSite('Чужой сайт')
    const data = await picture(100, 100, 'png')

    expect((await upload(editor.headers, data, 'a.png', foreignSiteId)).status).toBe(404)
    expect((await app.request(mediaUrl(foreignSiteId), { headers: editor.headers })).status).toBe(
      404,
    )
    const missingSite = '00000000-0000-4000-8000-000000000000'
    expect((await upload(owner.headers, data, 'a.png', missingSite)).status).toBe(404)
  })

  it('без входа — 401, с cookie не из админки — 403', async () => {
    const data = await picture(100, 100, 'png')
    expect((await upload({}, data)).status).toBe(401)
    expect((await upload({ cookie: owner.headers.cookie }, data)).status).toBe(403)
  })
})

describe('лимит размера', async () => {
  // Обёртка над настоящим процессором: видно, дошёл ли запрос до обработки картинки
  const real = sharpProcessor()
  let processed = 0
  const images: ImageProcessor = {
    inspect: (data) => real.inspect(data),
    process: (data) => {
      processed += 1
      return real.process(data)
    },
  }
  const small = await createTestApi({ mediaMaxBytes: 2048, images })
  afterAll(small.close)
  const smallOwner = await small.loginAs('owner')

  const uploadSmall = (data: Uint8Array<ArrayBuffer>, extra?: string) => {
    const body = new FormData()
    body.append('file', new File([data], 'big.png', { type: 'image/png' }))
    if (extra !== undefined) body.append('padding', extra)
    return small.app.request(mediaUrl(demoSiteId), {
      method: 'POST',
      headers: smallOwner.headers,
      body,
    })
  }

  const tinyPng = async () =>
    new Uint8Array(
      await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } })
        .png()
        .toBuffer(),
    )

  it('медиатека сообщает лимит: админка проверит файл до отправки', async () => {
    expect(await library(small.app, smallOwner.headers)).toEqual({ items: [], maxBytes: 2048 })
  })

  it('файл больше лимита → 413, в медиатеке и хранилище пусто', async () => {
    // Случайный шум не сжимается: PNG выйдет заметно больше 2 КБ, но меньше запаса на multipart —
    // так срабатывает именно проверка размера файла, а не обрезка тела запроса
    const noise = await sharp(Buffer.from(crypto.getRandomValues(new Uint8Array(64 * 64 * 3))), {
      raw: { width: 64, height: 64, channels: 3 },
    })
      .png()
      .toBuffer()
    expect(noise.byteLength).toBeGreaterThan(2048)
    const before = await filesIn(small.mediaDir)
    const calls = processed

    const res = await uploadSmall(new Uint8Array(noise))
    expect(res.status).toBe(413)
    expect(await res.json()).toMatchObject({
      error: {
        code: 'payload_too_large',
        message: 'Файл больше 2 КБ. Уменьшите картинку и загрузите снова',
      },
    })
    expect(processed).toBe(calls)
    expect((await library(small.app, smallOwner.headers)).items).toEqual([])
    expect(await filesIn(small.mediaDir)).toEqual(before)
  })

  it('тело больше лимита отклоняется до разбора multipart, даже если файл маленький', async () => {
    // Файл в пределах лимита, а тело раздуто другим полем. Без обрезки тела запрос разобрался
    // бы, и маленький файл прошёл бы проверку размера и обработку
    const calls = processed
    const res = await uploadSmall(await tinyPng(), 'x'.repeat(200 * 1024))
    expect(res.status).toBe(413)
    expect(await res.json()).toMatchObject({ error: { code: 'payload_too_large' } })
    expect(processed).toBe(calls)
  })

  it('огромное тело не читается: 413 приходит, а поток почти не тронут', async () => {
    const total = 50 * 1024 * 1024
    const chunk = new Uint8Array(64 * 1024)
    let pulled = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= total) return controller.close()
        pulled += chunk.byteLength
        controller.enqueue(chunk)
      },
    })
    const init: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      headers: {
        ...smallOwner.headers,
        'content-type': 'multipart/form-data; boundary=x',
        'content-length': String(total),
      },
      body,
      duplex: 'half',
    }
    const res = await small.app.request(mediaUrl(demoSiteId), init)
    expect(res.status).toBe(413)
    expect(pulled).toBeLessThan(total / 10)
  })

  it(`картинка больше ${MAX_PIXELS / 1_000_000} Мп → 413 по заголовку, без нарезки`, async () => {
    // PNG весом в сотню байт объявляет 10000 × 6000 = 60 Мп. Такой «бомбе» хватило бы
    // заголовка, чтобы занять гигабайты памяти. Размеры в IHDR меняем руками и пересчитываем CRC
    const png = Buffer.from(await tinyPng())
    png.writeUInt32BE(10_000, 16)
    png.writeUInt32BE(6_000, 20)
    png.writeUInt32BE(crc32(png.subarray(12, 29)), 29)
    expect(await sharp(png).metadata()).toMatchObject({ width: 10_000, height: 6_000 })
    const before = await filesIn(small.mediaDir)

    const res = await uploadSmall(new Uint8Array(png))
    expect(res.status).toBe(413)
    expect(await res.json()).toMatchObject({
      error: {
        code: 'payload_too_large',
        message: 'Картинка слишком большая: не больше 50 мегапикселей',
        issues: [{ path: 'file' }],
      },
    })
    expect(await filesIn(small.mediaDir)).toEqual(before)
    expect((await library(small.app, smallOwner.headers)).items).toEqual([])
  })

  it('файл в пределах лимита проходит', async () => {
    expect((await uploadSmall(await tinyPng())).status).toBe(201)
  })
})

describe('id в заглавных буквах', () => {
  const upper = (id: string) => id.toUpperCase()

  it('загрузка в сайт с id заглавными — 201, файлы лежат под строчными id', async () => {
    const res = await upload(
      owner.headers,
      await picture(300, 200, 'png'),
      'u.png',
      upper(demoSiteId),
    )
    const media = await uploaded(res)
    expect(media.id).toBe(media.id.toLowerCase())
    expect(await storage.get(mediaKey(demoSiteId, media.id, 'original.png'))).toBeDefined()
  })

  it('токен сайта узнаёт свой сайт и в адресе с заглавными буквами', async () => {
    const { token } = await api.createToken(demoSiteId)
    const res = await upload(
      { authorization: `Bearer ${token}` },
      await picture(100, 100, 'png'),
      't.png',
      upper(demoSiteId),
    )
    expect(res.status).toBe(201)
  })

  it('файл варианта по id заглавными отдаётся, а не падает', async () => {
    const media = await uploaded(await upload(owner.headers, await picture(600, 300, 'jpeg')))
    const variant = media.variants[0]
    if (!variant) throw new Error('Нет вариантов')
    const res = await app.request(variant.url.replace(media.id, upper(media.id)))
    expect(res.status).toBe(200)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(await fetchFile(variant.url))
    expect((await app.request(`/api/media/${upper(media.id)}/9999.avif`)).status).toBe(404)
  })
})

describe('отдача файлов', () => {
  it('публичная, с типом, долгим кешем и nosniff; байты — те, что в хранилище', async () => {
    const media = await uploaded(await upload(owner.headers, await picture(600, 300, 'jpeg')))
    const variant = media.variants.find((candidate) => candidate.format === 'avif')
    if (!variant) throw new Error('Нет варианта AVIF')

    // Без cookie и токена: так файл берёт браузер посетителя сайта
    const res = await app.request(variant.url)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/avif')
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')

    const file = variant.url.split('/').at(-1) as string
    const stored = await storage.get(mediaKey(demoSiteId, media.id, file))
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(stored)
    expect(variant.size).toBe(stored?.byteLength)
  })

  it('неизвестный файл, оригинал и чужой путь — 404, кривой id — 400', async () => {
    const media = await uploaded(await upload(owner.headers, await picture(600, 300, 'jpeg')))
    const base = `/api/media/${media.id}`
    expect((await app.request(`${base}/9999.avif`)).status).toBe(404)
    expect((await app.request(`${base}/original.jpg`)).status).toBe(404)
    expect((await app.request(`${base}/..%2F..%2Fpglite`)).status).toBe(404)
    expect(
      (await app.request('/api/media/00000000-0000-4000-8000-000000000000/480.avif')).status,
    ).toBe(404)
    expect((await app.request('/api/media/not-a-uuid/480.avif')).status).toBe(400)
  })
})

describe('права', () => {
  it('клиент видит медиатеку и загружает, но не удаляет', async () => {
    const client = await loginAs('client')
    const media = await uploaded(
      await upload(client.headers, await picture(300, 200, 'png'), 'c.png'),
    )
    expect(media.author).toEqual({ kind: 'user', name: 'Тестовый client' })

    const list = await app.request(mediaUrl(demoSiteId), { headers: client.headers })
    expect(list.status).toBe(200)

    const res = await remove(client.headers, media.id)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: { code: 'forbidden' } })
  })

  it('редактор удаляет неиспользуемую картинку', async () => {
    const editor = await loginAs('editor')
    const media = await uploaded(
      await upload(editor.headers, await picture(300, 200, 'png'), 'e.png'),
    )
    expect((await remove(editor.headers, media.id)).status).toBe(204)
  })
})

describe('удаление', () => {
  const pageUrl = (slug: string) => `/api/sites/${demoSiteId}/pages/${slug}`
  const json = { ...owner.headers, 'content-type': 'application/json' }

  const heroWith = (mediaId: string): PageContentInput => ({
    blocks: [
      {
        id: 'hero',
        type: 'hero',
        props: { variant: 'split', title: 'С картинкой', image: { mediaId, alt: 'Фото' } },
      },
    ],
  })
  const save = (slug: string, title: string, content: PageContentInput) =>
    app.request(pageUrl(slug), {
      method: 'PUT',
      headers: json,
      body: JSON.stringify({ title, content }),
    })
  const publish = (slug: string) =>
    app.request(`${pageUrl(slug)}/publish`, { method: 'POST', headers: owner.headers })

  it('неиспользуемая: 204, файлы удалены, адреса вариантов — 404', async () => {
    const media = await uploaded(await upload(owner.headers, await picture(700, 400, 'jpeg')))
    const keys = [
      mediaKey(demoSiteId, media.id, 'original.jpg'),
      ...media.variants.map((variant) =>
        mediaKey(demoSiteId, media.id, variant.url.split('/').at(-1) as string),
      ),
    ]
    expect((await remove(owner.headers, media.id)).status).toBe(204)

    for (const key of keys) expect(await storage.get(key), key).toBeUndefined()
    for (const variant of media.variants) expect((await app.request(variant.url)).status).toBe(404)
    const { items } = await library(app, owner.headers)
    expect(items.map((item) => item.id)).not.toContain(media.id)
  })

  it('используемая в черновике: 409 со страницей, картинка и файлы на месте', async () => {
    const media = await uploaded(await upload(owner.headers, await picture(700, 400, 'jpeg')))
    expect((await save('s-kartinkoj', 'Страница с картинкой', heroWith(media.id))).status).toBe(200)

    const res = await remove(owner.headers, media.id)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      error: {
        code: 'conflict',
        message: expect.stringContaining('«Страница с картинкой» (/s-kartinkoj) — черновик'),
        issues: [{ path: 'pages.s-kartinkoj', message: 'черновик' }],
      },
    })
    const [variant] = media.variants
    expect((await app.request(variant?.url ?? '')).status).toBe(200)
  })

  it('используемая только в опубликованной версии: тоже 409', async () => {
    const media = await uploaded(await upload(owner.headers, await picture(700, 400, 'jpeg')))
    expect((await save('na-sajte', 'На сайте', heroWith(media.id))).status).toBe(200)
    expect((await publish('na-sajte')).status).toBe(200)
    // Черновик уже без картинки, а сайт — ещё с ней
    expect((await save('na-sajte', 'На сайте', { blocks: [] })).status).toBe(200)

    const res = await remove(owner.headers, media.id)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      error: { issues: [{ path: 'pages.na-sajte', message: 'сайт' }] },
    })
  })

  it('картинка другого сайта — 404, даже владельцу', async () => {
    const media = await uploaded(
      await upload(owner.headers, await picture(100, 100, 'png'), 'x.png'),
    )
    // API сайтов не создаёт (одна установка — один сайт): сайт кладётся в базу напрямую
    const otherSiteId = await api.createSite('Другой сайт')
    expect((await remove(owner.headers, media.id, otherSiteId)).status).toBe(404)
    expect((await app.request(media.variants[0]?.url ?? '')).status).toBe(200)
  })

  /** Ключи всех файлов картинки: оригинал и варианты */
  const keysOf = (media: Uploaded, original: string) => [
    mediaKey(demoSiteId, media.id, original),
    ...media.variants.map((variant) =>
      mediaKey(demoSiteId, media.id, variant.url.split('/').at(-1) as string),
    ),
  ]

  it('используемую не удалить и по id заглавными: 409, запись и файлы на месте', async () => {
    const media = await uploaded(await upload(owner.headers, await picture(700, 400, 'jpeg')))
    expect((await save('zaglavnye', 'Заглавные', heroWith(media.id))).status).toBe(200)

    const res = await remove(owner.headers, media.id.toUpperCase(), demoSiteId.toUpperCase())
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      error: { code: 'conflict', issues: [{ path: 'pages.zaglavnye', message: 'черновик' }] },
    })
    const { items } = await library(app, owner.headers)
    expect(items.map((item) => item.id)).toContain(media.id)
    for (const key of keysOf(media, 'original.jpg')) {
      expect(await storage.get(key), key).toBeDefined()
    }
  })

  it('ссылка заглавными в черновике сохраняется строчными и тоже не даёт удалить', async () => {
    const media = await uploaded(await upload(owner.headers, await picture(700, 400, 'jpeg')))
    expect(
      (await save('zaglavnaya-ssylka', 'Ссылка', heroWith(media.id.toUpperCase()))).status,
    ).toBe(200)
    const page = await app.request(pageUrl('zaglavnaya-ssylka'), { headers: owner.headers })
    expect(await page.json()).toMatchObject({
      draft: { blocks: [{ props: { image: { mediaId: media.id } } }] },
    })
    expect((await remove(owner.headers, media.id)).status).toBe(409)
  })

  it('неиспользуемую по id заглавными удаляет целиком: 204, файлов нет', async () => {
    const media = await uploaded(
      await upload(owner.headers, await picture(300, 200, 'png'), 'p.png'),
    )
    expect((await remove(owner.headers, media.id.toUpperCase())).status).toBe(204)
    for (const key of keysOf(media, 'original.png')) {
      expect(await storage.get(key), key).toBeUndefined()
    }
  })
})
