/**
 * Ссылки собираем из URL, а не заменой строк: относительные адреса и абсолютные ссылки на домен
 * сайта остаются в предпросмотре. Якорь текущей страницы не перезагружает документ.
 */
export function previewHref(href: string, path: string, siteUrl: string | null, prefix: string) {
  if (href.startsWith('#')) return href
  const base = siteUrl || 'https://preview.invalid'
  try {
    const target = new URL(href, new URL(path, base))
    if (!['http:', 'https:', 'mailto:', 'tel:'].includes(target.protocol)) return '#'
    if (target.origin !== new URL(base).origin) return href
    if (
      target.hash &&
      target.pathname.replace(/\/$/, '') === path.replace(/\/$/, '') &&
      !target.search
    )
      return target.hash
    return `${prefix}${target.pathname}${target.search}${target.hash}`
  } catch {
    return '#'
  }
}

/** Дополнительная защита поверх sandbox/CSP: формы и активное содержимое не попадают в HTML. */
export function preparePreviewBody(
  owner: Document,
  path: string,
  siteUrl: string | null,
  prefix: string,
) {
  for (const node of owner.querySelectorAll('script, iframe, object, embed, base, meta, link'))
    node.remove()
  for (const node of owner.querySelectorAll('*')) {
    for (const attr of [...node.attributes]) {
      if (
        /^on/i.test(attr.name) ||
        ['ping', 'srcdoc', 'formaction', 'formtarget', 'autofocus'].includes(attr.name)
      ) {
        node.removeAttribute(attr.name)
      }
    }
  }
  for (const anchor of owner.querySelectorAll<HTMLAnchorElement>('a[href], area[href]')) {
    const href = anchor.getAttribute('href') ?? ''
    if (/^\s*(javascript|data|blob):/i.test(href)) {
      anchor.removeAttribute('href')
      continue
    }
    const rewritten = previewHref(href, path, siteUrl, prefix)
    anchor.setAttribute('href', rewritten)
    anchor.removeAttribute('download')
    anchor.target = rewritten.startsWith('#') ? '_self' : '_top'
    anchor.rel = 'noreferrer noopener'
    anchor.referrerPolicy = 'no-referrer'
  }
  for (const form of owner.querySelectorAll('form')) {
    form.removeAttribute('action')
    form.removeAttribute('method')
    form.removeAttribute('target')
    for (const submit of form.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
      'button, input[type="submit"], input[type="image"]',
    )) {
      submit.disabled = true
    }
    const note = owner.createElement('p')
    note.textContent = 'Это предпросмотр: заявки не отправляются'
    form.append(note)
  }
}

/**
 * Документ в blob сохраняет якорь при переходе с другой страницы. Его адрес не иерархический,
 * поэтому ссылки на ресурсы делаем абсолютными, а #якоря оставляем внутри самого документа.
 */
export function absolutePreviewResources(owner: Document, origin: string) {
  const absolute = (value: string) => new URL(value, origin).href
  const cssUrls = (css: string) =>
    css.replace(
      /url\((['"]?)(\/(?!\/)[^)'"\s]+)\1\)/g,
      (_match, _quote: string, path: string) => `url("${absolute(path)}")`,
    )
  for (const node of owner.querySelectorAll('*')) {
    for (const name of ['src', 'poster', 'href']) {
      const value = node.getAttribute(name)
      if (value?.startsWith('/')) node.setAttribute(name, absolute(value))
    }
    const srcset = node.getAttribute('srcset')
    if (srcset)
      node.setAttribute(
        'srcset',
        srcset.replace(
          /(^|,\s*)(\/[^\s,]+)/g,
          (_match, separator: string, path: string) => separator + absolute(path),
        ),
      )
    const style = node.getAttribute('style')
    if (style) node.setAttribute('style', cssUrls(style))
  }
  for (const style of owner.querySelectorAll('style'))
    style.textContent = cssUrls(style.textContent ?? '')
}
