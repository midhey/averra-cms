// Плеер видео по клику на обложку: маленькое улучшение поверх рабочего HTML. Без скрипта обложка —
// обычная ссылка на страницу ролика. Со скриптом клик ставит на место обложки iframe площадки, а
// под ним — ссылку на ролик на площадке.
// Модуль без зависимостей: Astro собирает его в /_astro/… только на страницы с блоком «Видео»

/**
 * Адреса плееров, которые строит videoEmbedUrl (@averra/schema). Атрибут ставит сборка, но
 * проверка дешёвая: в iframe не попадёт ничего, кроме плеера одной из трёх площадок
 */
const EMBED_PREFIXES = [
  'https://www.youtube-nocookie.com/embed/',
  'https://rutube.ru/play/embed/',
  'https://vkvideo.ru/video_ext.php?',
]

export const isEmbedUrl = (url: string) => EMBED_PREFIXES.some((prefix) => url.startsWith(prefix))

/**
 * Права плеера — минимальные, с которыми плееры площадок работают: свои скрипты и хранилище
 * (allow-scripts, allow-same-origin — без них YouTube и VK не запускают ролик), полноэкранный
 * режим и трансляция (allow-presentation), ссылка «Смотреть на площадке» в новой вкладке
 * (allow-popups и allow-popups-to-escape-sandbox — иначе открытая площадка была бы в песочнице).
 * Ни формы, ни переход страницы сайта (allow-top-navigation), ни модальные окна
 */
export const PLAYER_SANDBOX =
  'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox'
export const PLAYER_ALLOW = 'autoplay; encrypted-media; picture-in-picture; fullscreen'

/** iframe плеера вместо обложки. Referer — только источник сайта: без него YouTube не играет */
export function playerFrame(doc: Document, src: string, title: string) {
  const frame = doc.createElement('iframe')
  frame.src = src
  frame.title = title
  frame.setAttribute('sandbox', PLAYER_SANDBOX)
  frame.setAttribute('allow', PLAYER_ALLOW)
  frame.setAttribute('allowfullscreen', '')
  frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
  return frame
}

/**
 * Клик по обложке (data-video-embed) ставит плеер. Ctrl/⌘/Shift/Alt-клик и средняя кнопка
 * остаются ссылкой: человек хотел открыть ролик в новой вкладке. Один слушатель на документ —
 * блоков видео на странице может быть несколько
 */
export function startVideoPlayers(doc: Document = document) {
  doc.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    const target = event.target
    if (!target || typeof (target as Element).closest !== 'function') return
    const link = (target as Element).closest<HTMLAnchorElement>('a[data-video-embed]')
    const src = link?.getAttribute('data-video-embed') ?? ''
    if (!link || !isEmbedUrl(src)) return
    event.preventDefault()
    const frame = playerFrame(doc, src, link.getAttribute('data-video-title') ?? '')
    // Ссылка на ролик под плеером: если площадка в iframe не откроется, посетитель не останется
    // перед пустым прямоугольником
    const fallback = link.closest('figure')?.querySelector<HTMLElement>('[data-video-fallback]')
    if (fallback) fallback.hidden = false
    link.replaceWith(frame)
    // Фокус — в плеер: с клавиатуры можно сразу управлять роликом
    frame.focus()
  })
}
