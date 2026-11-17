import { customBlocksCss, Page, themeBackgroundCss } from '@averra/blocks'
import baseCss from '@averra/blocks/base.css?inline'
import {
  canonicalPath,
  footerContacts,
  headerContacts,
  legalPages,
  PreviewToken,
} from '@averra/schema'
import { themeToCss } from '@averra/tokens'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import type { draftSnapshot } from '../../../api/src/modules/preview/snapshot'
import { siteChrome } from '../header/site-chrome'
import globalCss from '../styles/global.scss?inline'
import { installGlobalStyle, previewStyleNodes } from '../styles/global-style'
import { previewFontCss } from '../theme/preview-fonts'
import { absolutePreviewResources, preparePreviewBody } from './document'
import styles from './Preview.module.scss'

type Snapshot = NonNullable<Awaited<ReturnType<typeof draftSnapshot>>> & { expiresAt: string }

installGlobalStyle(document, globalCss)

async function showPreview() {
  const root = document.getElementById('root')
  if (!root) return
  const parts = window.location.pathname.split('/')
  const token = parts[2] ?? ''
  const path = `/${parts.slice(3).join('/')}`
  const status = document.createElement('p')
  status.className = styles.status ?? ''
  status.textContent = 'Загружаем черновик сайта…'
  root.replaceChildren(status)
  try {
    if (!PreviewToken.safeParse(token).success) throw new Error('Ссылка недействительна')
    const response = await fetch(`/api/preview/${token}${path}`, {
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    })
    if (!response.ok) {
      throw new Error(
        response.status === 404
          ? 'Предпросмотр недоступен: ссылка истекла, отозвана или страница не найдена. Попросите новую ссылку у владельца сайта.'
          : 'Не удалось загрузить предпросмотр. Попробуйте обновить страницу.',
      )
    }
    const snapshot: Snapshot = await response.json()
    const { site, page, media, customBlocks } = snapshot
    document.title = `${page.title} — черновик сайта`
    const legalHref = (slug: string) =>
      snapshot.pages.some((page) => page.slug === slug) ? canonicalPath(slug) : null
    const chrome = siteChrome({
      header: site.header,
      footer: site.footer,
      siteName: site.name,
      page,
      pages: snapshot.pages.map(({ slug, content }) => ({ slug, blocks: content.blocks })),
      contacts: headerContacts(site.organization),
      organization: footerContacts(site.organization),
      legal: {
        policyHref: legalHref(site.policyPage),
        consentHref: legalHref(legalPages.consent.slug),
        cookieSettings: false,
      },
      customBlocks,
      media,
    })
    const body = new DOMParser().parseFromString(
      renderToStaticMarkup(
        <>
          {chrome.before}
          <Page content={page.content} media={media} customBlocks={customBlocks} preview />
          {chrome.extra}
        </>,
      ),
      'text/html',
    )
    preparePreviewBody(body, path, site.url, `/preview/${token}`)
    const doc = document.implementation.createHTMLDocument(page.title)
    doc.documentElement.lang = site.language
    const viewport = doc.createElement('meta')
    viewport.name = 'viewport'
    viewport.content = 'width=device-width, initial-scale=1'
    doc.head.append(viewport)
    const header = body.querySelector<HTMLElement>('[data-site-header][data-sticky]')
    if (header) {
      doc.documentElement.dataset.stickyHeader = header.dataset.layout ?? 'custom'
      if (header.hasAttribute('data-row-button')) doc.documentElement.dataset.stickyHeaderRow = ''
      if (header.hasAttribute('data-menu-row')) doc.documentElement.dataset.stickyHeaderMenuRow = ''
    }
    const csp = doc.createElement('meta')
    csp.httpEquiv = 'Content-Security-Policy'
    csp.content =
      "default-src 'none'; script-src 'none'; style-src 'unsafe-inline' https: http:; img-src https: http: data:; font-src https: http: data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"
    doc.head.append(csp)
    const referrer = doc.createElement('meta')
    referrer.name = 'referrer'
    referrer.content = 'no-referrer'
    doc.head.append(referrer)
    for (const style of previewStyleNodes(document)) doc.head.append(style.cloneNode(true))
    const css = doc.createElement('style')
    css.textContent =
      baseCss +
      previewFontCss(site.theme) +
      themeToCss(site.theme) +
      themeBackgroundCss(site.theme, media) +
      customBlocksCss(Object.keys(customBlocks), customBlocks, media)
    doc.head.append(css)
    doc.body.innerHTML = body.body.innerHTML
    doc.body.id = 'page-top'
    absolutePreviewResources(doc, window.location.origin)
    // В srcdoc «#якорь» считается от адреса страницы-родителя и уводил бы рамку на адрес админки
    // (а base запрещён CSP рамки): якорь — явным адресом самого документа рамки
    for (const anchor of doc.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
      anchor.setAttribute('href', `about:srcdoc${anchor.getAttribute('href')}`)
    }
    // srcdoc, как у предпросмотра в редакторе: blob-адрес родителя изолированная рамка (sandbox без
    // allow-same-origin) в Chrome не открывает — рамка оставалась пустой
    const html = `<!doctype html>${doc.documentElement.outerHTML}`
    createRoot(root).render(
      <div className={styles.shell}>
        <div className={styles.banner}>
          Черновик сайта, не опубликовано · до{' '}
          {new Date(snapshot.expiresAt).toLocaleString('ru-RU')}
        </div>
        <iframe
          title="Черновик сайта"
          className={styles.frame}
          sandbox="allow-top-navigation-by-user-activation"
          referrerPolicy="no-referrer"
          srcDoc={html}
        />
      </div>,
    )
  } catch (error) {
    status.setAttribute('role', 'alert')
    status.textContent = error instanceof Error ? error.message : 'Предпросмотр недоступен'
  }
}

void showPreview()
