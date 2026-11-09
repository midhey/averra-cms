// Движок своих блоков без React: Liquid, проверка и очистка HTML, CSS внутри блока. Им
// пользуются Page (сайт и предпросмотр) и API (проверка определения при сохранении и публикации)

export { compileWindowCss, WINDOW_CSS_SCOPE } from '../window/css'
export { type CompiledCss, compileCustomCss, customBlockScope } from './css'
export { checkTemplateHtml, isSafeUrl, maskLiquid, sanitizeHtml, visibleLinkHrefs } from './html'
export { LIQUID_LIMITS, safeHref } from './liquid'
export {
  CUSTOM_BLOCK_ATTRIBUTE,
  CUSTOM_BLOCK_ROOT_ATTRIBUTE,
  isReservedDataAttribute,
  isReservedId,
} from './marker'
export {
  PLACE_SHAPE,
  type PlaceData,
  type PlaceDataInput,
  placeData,
  samplePlaceData,
} from './place-data'
export {
  LEGAL_FOOTER_ATTRIBUTE,
  legalFooterCssProblems,
  legalFooterHtml,
  legalFooterLinks,
  type PlaceLegalLinks,
} from './place-legal'
export { type CustomBlockProblem, CustomBlockRenderError } from './problems'
export {
  CUSTOM_FILTERS,
  type CustomBlockMap,
  customBlockCss,
  customBlockProblems,
  customBlocksCss,
  mediaUrlIn,
  type RenderableCustomBlock,
  renderCustomBlockHtml,
  renderCustomPlaceHtml,
} from './render'
export {
  customBlockScriptFile,
  scriptProblems,
  scriptSyntaxError,
  siteScriptFile,
} from './script'
