export { CookieNotice, type CookieNoticeProps, LegalFooter } from './cookie/CookieNotice'
export { cookieNoticeView, policyHref } from './cookie/view'
export type { CustomBlockMap, RenderableCustomBlock } from './custom/render'
export { customBlocksCss } from './custom/render'
export { customBlockScriptFile, scriptSyntaxError, siteScriptFile } from './custom/script'
export { SiteFooter } from './footer/SiteFooter'
export {
  consentPageHref,
  type FooterCallbackView,
  type SiteFooterView,
  siteFooterView,
} from './footer/view'
export { sentAnchor } from './form/Form'
export { SiteHeader } from './header/SiteHeader'
export {
  CONTENT_ID,
  type CustomPlaceView,
  headerMenuRow,
  headerRowButton,
  headerScriptNeeded,
  type SiteBrandView,
  type SiteHeaderLink,
  type SiteHeaderView,
  siteBrandView,
  siteHeaderView,
} from './header/view'
export { Page } from './Page'
export {
  CustomSiteFooter,
  CustomSiteHeader,
  FooterSlot,
  HeaderSlot,
  settlePlace,
} from './place/CustomPlace'
export type { BlockComponentProps, BlockData } from './types'
export { themeBackgroundCss } from './ui/theme-background'
export { compileWindowCss, WINDOW_CSS_SCOPE, windowCssForPage } from './window/css'
export { windowsAndBehaviors } from './window/needed'
export { SiteWindows } from './window/SiteWindows'
export { type SiteWindowView, siteWindowView, windowIdPrefix } from './window/view'
