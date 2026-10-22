import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { video } from './blocks'
import { PageContent } from './page'
import { parseVideoUrl, VIDEO_URL_MESSAGE, VideoUrl, videoEmbedUrl, videoWatchUrl } from './video'

const YT = 'aqz-KE-bpKQ'
const RT = '0123456789abcdef0123456789abcdef'

describe('parseVideoUrl', () => {
  it.each([
    [`https://www.youtube.com/watch?v=${YT}`, { provider: 'youtube', id: YT }],
    [`https://youtube.com/watch?v=${YT}&t=42s&si=share`, { provider: 'youtube', id: YT }],
    [`https://m.youtube.com/watch?feature=share&v=${YT}`, { provider: 'youtube', id: YT }],
    [`http://youtu.be/${YT}?si=abc`, { provider: 'youtube', id: YT }],
    [`https://www.youtube.com/embed/${YT}`, { provider: 'youtube', id: YT }],
    [`https://www.youtube.com/shorts/${YT}`, { provider: 'youtube', id: YT }],
    [`https://www.youtube.com/live/${YT}?feature=shared`, { provider: 'youtube', id: YT }],
    [`https://www.youtube-nocookie.com/embed/${YT}`, { provider: 'youtube', id: YT }],
    [`  https://youtu.be/${YT}  `, { provider: 'youtube', id: YT }],
    [`HTTPS://WWW.YOUTUBE.COM/watch?v=${YT}#comments`, { provider: 'youtube', id: YT }],
    [`https://rutube.ru/video/${RT}/`, { provider: 'rutube', id: RT }],
    [`https://rutube.ru/video/${RT.toUpperCase()}/?r=wd`, { provider: 'rutube', id: RT }],
    [`https://rutube.ru/play/embed/${RT}`, { provider: 'rutube', id: RT }],
    [`https://rutube.ru/shorts/${RT}/`, { provider: 'rutube', id: RT }],
    [
      `https://rutube.ru/video/private/${RT}/?p=Ab_c-12`,
      { provider: 'rutube', id: RT, privateKey: 'Ab_c-12' },
    ],
    [
      'https://vk.com/video-22822305_456242110',
      { provider: 'vk', ownerId: '-22822305', id: '456242110' },
    ],
    [
      'https://vkvideo.ru/video-1_2?list=ln-AbC_9',
      { provider: 'vk', ownerId: '-1', id: '2', list: 'ln-AbC_9' },
    ],
    ['https://vk.com/video-1_2?list=PL1', { provider: 'vk', ownerId: '-1', id: '2' }],
    ['https://vk.com/video-1_2?list=ln-"x', { provider: 'vk', ownerId: '-1', id: '2' }],
    ['https://m.vk.ru/video123_45', { provider: 'vk', ownerId: '123', id: '45' }],
    ['https://vk.com/clip-1_2', { provider: 'vk', ownerId: '-1', id: '2' }],
    ['https://vk.com/remont?z=video-1_2%2Fpl_-1_-2', { provider: 'vk', ownerId: '-1', id: '2' }],
    [
      'https://vk.com/video_ext.php?oid=-1&id=2&hash=ab12cd&hd=2',
      { provider: 'vk', ownerId: '-1', id: '2', hash: 'ab12cd' },
    ],
    ['https://vkvideo.ru/video_ext.php?oid=5&id=6', { provider: 'vk', ownerId: '5', id: '6' }],
  ])('узнаёт %s', (url, expected) => {
    expect(parseVideoUrl(url)).toEqual(expected)
  })

  it.each([
    ['пусто', ''],
    ['не адрес', 'ролик про кухни'],
    ['без схемы', `youtu.be/${YT}`],
    ['javascript:', `javascript:alert(1)//youtu.be/${YT}`],
    ['data:', `data:text/html,https://youtu.be/${YT}`],
    ['ftp', `ftp://youtu.be/${YT}`],
    ['чужой домен', `https://youtube.com.evil.ru/watch?v=${YT}`],
    ['поддомен-обманка', `https://evil.ru/?u=https://youtu.be/${YT}`],
    ['логин в адресе', `https://youtu.be@evil.ru/${YT}`],
    ['порт', `https://youtu.be:8443/${YT}`],
    ['обратная косая черта', `https://youtu.be\\@evil.ru/${YT}`],
    ['битый %-код', 'https://vk.com/remont?z=%E0%A4%A'],
    ['короткий id YouTube', 'https://youtu.be/abc'],
    ['id YouTube с лишним', `https://youtu.be/${YT}x`],
    ['символы в id YouTube', 'https://www.youtube.com/watch?v=aqz-KE-bp%3C'],
    ['канал YouTube', 'https://www.youtube.com/@averra'],
    ['плейлист YouTube', 'https://www.youtube.com/playlist?list=PL123'],
    ['watch без v', 'https://www.youtube.com/watch?list=PL123'],
    ['лишний сегмент', `https://youtu.be/${YT}/extra`],
    ['nocookie не embed', `https://www.youtube-nocookie.com/watch?v=${YT}`],
    ['id Rutube короче', 'https://rutube.ru/video/0123456789abcdef/'],
    ['id Rutube не hex', `https://rutube.ru/video/${RT.slice(0, -1)}z/`],
    ['канал Rutube', 'https://rutube.ru/channel/123456/'],
    ['кривой ключ Rutube', `https://rutube.ru/video/private/${RT}/?p=<script>`],
    ['страница VK', 'https://vk.com/remont'],
    ['фото VK', 'https://vk.com/photo-1_2'],
    ['z не видео', 'https://vk.com/remont?z=photo-1_2'],
    ['video_ext без id', 'https://vk.com/video_ext.php?oid=-1'],
    ['video_ext с буквами', 'https://vk.com/video_ext.php?oid=-1&id=2x'],
    ['кривой hash VK', 'https://vk.com/video_ext.php?oid=-1&id=2&hash=%22onload'],
    ['VK на чужом домене', 'https://vk.co/video-1_2'],
  ])('не принимает: %s', (_, url) => {
    expect(parseVideoUrl(url)).toBeUndefined()
  })
})

describe('ссылки ролика', () => {
  it('YouTube: страница ролика и плеер с youtube-nocookie', () => {
    const ref = { provider: 'youtube', id: YT } as const
    expect(videoWatchUrl(ref)).toBe(`https://www.youtube.com/watch?v=${YT}`)
    expect(videoEmbedUrl(ref)).toBe(`https://www.youtube-nocookie.com/embed/${YT}?autoplay=1`)
  })

  it('Rutube: открытый и закрытый ролик', () => {
    expect(videoWatchUrl({ provider: 'rutube', id: RT })).toBe(`https://rutube.ru/video/${RT}/`)
    expect(videoEmbedUrl({ provider: 'rutube', id: RT })).toBe(
      `https://rutube.ru/play/embed/${RT}/?autoplay=true`,
    )
    const closed = { provider: 'rutube', id: RT, privateKey: 'k1' } as const
    expect(videoWatchUrl(closed)).toBe(`https://rutube.ru/video/private/${RT}/?p=k1`)
    expect(videoEmbedUrl(closed)).toBe(`https://rutube.ru/play/embed/${RT}/?p=k1&autoplay=true`)
  })

  it('VK Видео: страница на vkvideo.ru, плеер video_ext.php с hash, если он был', () => {
    const ref = { provider: 'vk', ownerId: '-1', id: '2' } as const
    expect(videoWatchUrl(ref)).toBe('https://vkvideo.ru/video-1_2')
    // Ключ ролика с доступом по ссылке — в ссылку «Смотреть», плееру он не нужен (там hash)
    expect(videoWatchUrl({ ...ref, list: 'ln-k' })).toBe('https://vkvideo.ru/video-1_2?list=ln-k')
    expect(videoEmbedUrl({ ...ref, list: 'ln-k' })).not.toContain('list')
    expect(videoEmbedUrl(ref)).toBe('https://vkvideo.ru/video_ext.php?oid=-1&id=2&hd=2&autoplay=1')
    expect(videoEmbedUrl({ ...ref, hash: 'ab' })).toBe(
      'https://vkvideo.ru/video_ext.php?oid=-1&id=2&hash=ab&hd=2&autoplay=1',
    )
  })
})

describe('блок «Видео»', () => {
  it('пример проходит схему', () => {
    expect(video.props.safeParse(video.example).success).toBe(true)
  })

  it('чужая ссылка — ошибка у поля url с примером правильной', () => {
    const page = {
      blocks: [
        { id: 'v', type: 'video', props: { url: 'https://example.com/v.mp4', title: 'Ролик' } },
      ],
    }
    const result = PageContent.safeParse(page)
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]).toMatchObject({
      path: ['blocks', 0, 'props', 'url'],
      message: VIDEO_URL_MESSAGE,
    })
  })

  it('ссылка — с шаблоном адреса: в редакторе однострочное поле, ошибка одна', () => {
    const schema = z.toJSONSchema(VideoUrl) as { pattern?: string; maxLength?: number }
    expect(schema.pattern).toBeDefined()
    expect(new RegExp(schema.pattern ?? '').test('https://youtu.be/x')).toBe(true)
    for (const url of ['', 'youtu.be/aqz-KE-bpKQ', 'https://example.com/v.mp4']) {
      const result = VideoUrl.safeParse(url)
      expect(
        result.error?.issues.map((issue) => issue.message),
        url,
      ).toEqual([VIDEO_URL_MESSAGE])
    }
    expect(VideoUrl.parse(` HTTPS://youtu.be/${YT} `)).toBe(`HTTPS://youtu.be/${YT}`)
  })

  it('заголовок обязателен, лишних полей нет', () => {
    const url = `https://youtu.be/${YT}`
    expect(video.props.safeParse({ url }).success).toBe(false)
    expect(video.props.safeParse({ url, title: 'Ролик', autoplay: true }).success).toBe(false)
  })
})
