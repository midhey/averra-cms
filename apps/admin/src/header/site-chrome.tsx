import {
  type CustomBlockMap,
  customBlockScriptFile,
  FooterSlot,
  HeaderSlot,
  siteFooterView,
  siteHeaderView,
} from '@averra/blocks'
import {
  type CustomBlockDraft,
  defaultFooter,
  type Footer,
  type FooterContacts,
  Header,
  type MediaMap,
  type PageContent,
} from '@averra/schema'
import type { ReactNode } from 'react'
import type { SandboxScript } from '../editor/sandbox-document'

// Шапка и подвал сайта в предпросмотре админки — те же компоненты, что у рендерера (HeaderSlot,
// FooterSlot): стандартные или свой вид. Один расчёт для «Шапки и подвала», редактора страницы и
// экрана своего блока с местом «шапка»/«подвал»

export type ChromeInput = {
  header: Header | null
  footer: Footer | null
  siteName: string
  /** Открытая страница: её адрес (текущий пункт) и скрыты ли на ней шапка и подвал */
  page: { slug: string; content: PageContent }
  pages: readonly { slug: string; blocks: readonly { id: string }[] }[]
  /** Телефон и адрес для стандартной шапки */
  contacts: { phone: string; address: string }
  /** «Организация» целиком — для подвала и своих видов */
  organization: FooterContacts
  legal: { policyHref: string | null; consentHref: string | null; cookieSettings: boolean }
  customBlocks: CustomBlockMap
  media: MediaMap
}

export type Chrome = {
  before: ReactNode
  extra: ReactNode
  /** Ключи своих видов: их CSS нужен предпросмотру */
  placeKeys: string[]
  /** Скрипты своих видов — для предпросмотра со скриптами */
  scripts: SandboxScript[]
}

/** Шапка и подвал для предпросмотра. Ссылки меню ведут и на неопубликованное: виден черновик */
export function siteChrome(input: ChromeInput): Chrome {
  const linkable = input.pages.map((page) => ({
    slug: page.slug,
    blockIds: page.blocks.map((block) => block.id),
  }))
  const year = new Date().getFullYear()
  const headerView = siteHeaderView({
    header: input.header,
    siteName: input.siteName,
    page: input.page,
    pages: linkable,
    contacts: input.contacts,
    organization: input.organization,
    legal: input.legal,
    year,
  })
  const footerView = siteFooterView({
    footer: input.footer,
    siteName: input.siteName,
    page: input.page,
    header: input.header,
    pages: linkable,
    contacts: input.organization,
    legal: { policyHref: input.legal.policyHref, cookieSettings: input.legal.cookieSettings },
    consentHref: input.legal.consentHref,
    year,
  })
  const pageIds = input.page.content.blocks.map((block) => block.id)
  const placeKeys = [headerView?.custom?.key, footerView?.custom?.key].filter(
    (key): key is string => key !== undefined,
  )
  const scripts = placeKeys.flatMap((key) => {
    const script = input.customBlocks[key]?.script ?? ''
    return script.trim() === '' ? [] : [{ label: key, file: customBlockScriptFile(key, script) }]
  })
  return {
    before: headerView && (
      <HeaderSlot
        view={headerView}
        media={input.media}
        definitions={input.customBlocks}
        pageIds={pageIds}
        preview
      />
    ),
    extra: footerView && (
      <FooterSlot
        view={footerView}
        media={input.media}
        definitions={input.customBlocks}
        pageIds={pageIds}
        preview
      />
    ),
    placeKeys,
    scripts,
  }
}

/** Страницы образца: главная с блоками «Услуги» и «Заявка» и «О нас» — цели меню */
const samplePages = [
  { slug: 'index', blocks: [{ id: 'services' }, { id: 'form' }] },
  { slug: 'about', blocks: [] },
]

/**
 * Шапка и подвал образца для экрана своего блока с местом: меню из трёх пунктов (открыта «О нас»,
 * она текущая), кнопка, текстовый логотип, «Организация» и документы — как у настоящего сайта
 */
export function sampleChrome(
  definition: CustomBlockDraft,
  content: PageContent,
  media: MediaMap,
  siteName: string,
): Chrome {
  const custom = { key: definition.key, props: definition.example }
  const header = Header.parse({
    menu: [
      { label: 'Услуги', page: 'index', block: 'services' },
      { label: 'О нас', page: 'about' },
      { label: 'Telegram', url: 'https://t.me/example' },
    ],
    button: { label: 'Оставить заявку', mobileLabel: 'Заявка', page: 'index', block: 'form' },
    brand: 'text',
    logoMark: 'Аб',
    custom: definition.placement === 'header' ? custom : null,
  })
  // Подвал образца: свой вид — только у определения подвала, у шапки — без подвала
  const footer =
    definition.placement === 'footer' ? { ...defaultFooter, consent: true, custom } : null
  return siteChrome({
    header,
    footer,
    siteName,
    page: { slug: 'about', content },
    pages: samplePages,
    contacts: { phone: '', address: '' },
    organization: {
      name: 'ООО «Пример»',
      phone: '+7 900 000-00-00',
      email: 'hello@example.ru',
      address: 'Москва, ул. Примерная, 1',
      inn: '7700000000',
      ogrn: '1027700000000',
      socials: ['https://vk.com/example'],
    },
    legal: { policyHref: '/privacy/', consentHref: '/consent/', cookieSettings: true },
    customBlocks: { [definition.key]: definition },
    media,
  })
}
