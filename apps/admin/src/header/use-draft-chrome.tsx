import { type CustomBlockMap, LegalFooter } from '@averra/blocks'
import {
  defaultFooter,
  defaultHeader,
  emptyFooterContacts,
  type MediaMap,
  type PageContent,
  sameFooter,
  sameHeader,
  siteLinkHref,
} from '@averra/schema'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { pagePath } from '../pages-format'
import { footerQuery, headerQuery } from '../queries'
import { siteChrome } from './site-chrome'

/**
 * Шапка и подвал в предпросмотре редактора страницы (B12): черновики с экрана «Шапка и подвал» —
 * так страницу проверяют целиком, вместе с правками шапки, которые ещё не на сайте. Шапки, которую
 * не публиковали и не настраивали, нет и здесь — как на сайте. Не suspense: шапка — добавка,
 * сбой её загрузки редактору не помеха
 */
export function useDraftChrome(input: {
  siteId: string
  siteName: string
  slug: string
  content: PageContent
  media: MediaMap
  customBlocks: CustomBlockMap
}): { before: ReactNode; extra: ReactNode; placeKeys: string[]; note: ReactNode } {
  const header = useQuery(headerQuery(input.siteId)).data
  const footer = useQuery(footerQuery(input.siteId)).data
  // Ответ без черновиков (сбой, старый API) — предпросмотр без шапки и подвала, как раньше
  if (!header?.draft || !footer?.draft || !footer.policy || !footer.consent) {
    return { before: null, extra: null, placeKeys: [], note: undefined }
  }
  const headerShown =
    header.published !== null || !sameHeader(header.draft, defaultHeader) ? header.draft : null
  const footerShown =
    footer.published !== null || !sameFooter(footer.draft, defaultFooter) ? footer.draft : null
  const legal = {
    policyHref: footer.policy.published ? pagePath(footer.policy.slug) : null,
    consentHref: footer.consent.published ? siteLinkHref({ page: footer.consent.slug }) : null,
    cookieSettings: footer.cookieSettings,
  }
  const chrome = siteChrome({
    header: headerShown,
    footer: footerShown,
    siteName: input.siteName,
    page: { slug: input.slug, content: input.content },
    pages: header.targets,
    contacts: header.contacts ?? { phone: '', address: '' },
    organization: footer.contacts ?? emptyFooterContacts,
    legal,
    customBlocks: input.customBlocks,
    media: input.media,
  })
  // Подвала нет — внизу прежняя полоса с документами, как на сайте
  const extra =
    chrome.extra ??
    (input.content.hideFooter ? null : (
      <LegalFooter policyHref={legal.policyHref} cookieSettings={false} />
    ))
  const headerDraft = headerShown !== null && header.unpublished
  const footerDraft = footerShown !== null && footer.unpublished
  const subject =
    headerDraft && footerDraft
      ? 'Шапка и подвал показаны черновиками'
      : headerDraft
        ? 'Шапка показана черновиком'
        : 'Подвал показан черновиком'
  const after =
    headerDraft && footerDraft ? 'они попадут' : headerDraft ? 'она попадёт' : 'он попадёт'
  const note =
    headerDraft || footerDraft ? (
      <>
        {subject} с экрана <Link to="/header">«Шапка и подвал»</Link>: на сайт {after} после
        публикации там.
      </>
    ) : undefined
  return { before: chrome.before, extra, placeKeys: chrome.placeKeys, note }
}
