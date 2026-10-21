import { z } from 'zod'
import { BlockInstance, hero } from './blocks'

/** Сколько блоков может быть на странице: редактор пишет «3 из 50» и не даёт добавить больше */
export const PAGE_MAX_BLOCKS = 50

/** Описание для поисковиков и соцсетей (страницы и сайта). Поисковик покажет около 160 символов */
export const SEO_DESCRIPTION_MAX = 300
export const SEO_DESCRIPTION_RECOMMENDED = 160

/**
 * Поиск и соцсети на уровне страницы. Необязательно целиком и по полям: страница без них берёт
 * описание сайта (раздел «SEO»). Живёт в содержимом страницы, поэтому версионируется вместе с
 * блоками: правка описания попадает на сайт только с публикацией
 */
export const PageSeo = z.strictObject({
  description: z
    .string()
    .trim()
    .max(SEO_DESCRIPTION_MAX)
    .optional()
    .meta({ title: 'Описание для поисковиков и соцсетей' }),
  noindex: z.boolean().optional().meta({ title: 'Скрыть страницу от поисковиков' }),
})
export type PageSeo = z.infer<typeof PageSeo>

export const PageContent = z
  .strictObject({
    blocks: z.array(BlockInstance).max(PAGE_MAX_BLOCKS),
    seo: PageSeo.optional(),
  })
  .refine((page) => new Set(page.blocks.map((block) => block.id)).size === page.blocks.length, {
    error: 'Id блоков на странице должны быть уникальными',
    path: ['blocks'],
  })

/** Страница после проверки: значения по умолчанию уже подставлены */
export type PageContent = z.infer<typeof PageContent>
/** Что можно прислать в API: поля со значениями по умолчанию необязательны */
export type PageContentInput = z.input<typeof PageContent>

/** Заголовок страницы (тег title). Одна схема для API и для поля в редакторе */
export const PageTitle = z.string().trim().min(1).max(120)

/** Адрес главной страницы сайта: она открывается по корню, и удалить её нельзя */
export const MAIN_PAGE_SLUG = 'index'

/**
 * Служебный адрес страницы 404: её показывают по любому адресу, где страницы нет. Это обычная
 * страница из блоков; нет своей — на сайте стандартная. Она всегда скрыта от поисковиков
 */
export const NOT_FOUND_PAGE_SLUG = '404'

/**
 * Адрес страницы — часть URL сайта: латиница в нижнем регистре и цифры, дефис только между
 * ними. Без пробелов, кириллицы и висящих дефисов: такой адрес не надо кодировать в ссылке
 */
export const PageSlug = z
  .string()
  // Пустой или длинный адрес — одна понятная ошибка, а не ещё и «не та латиница»
  .min(1, { abort: true })
  .max(64, { abort: true })
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    'Только латиница в нижнем регистре, цифры и дефис между ними, например o-nas',
  )

/**
 * Адрес уже существующей страницы — мягче, чем PageSlug. До строгой схемы адресов API принимал
 * любые латинские буквы, цифры и дефисы (например, «a-» или «--a»), и такие страницы могут
 * лежать в базе. Их можно открыть, сохранить, опубликовать и удалить; новая страница — только
 * по PageSlug
 */
export const ExistingPageSlug = z
  .string()
  .regex(/^[a-z0-9-]{1,64}$/, 'Только латиница в нижнем регистре, цифры и дефис')

/** С чего начинается новая страница: пустая или с первым экраном из каталога блоков */
export const PageTemplate = z.enum(['empty', 'hero'])
export type PageTemplate = z.infer<typeof PageTemplate>

/** Что присылают в API, чтобы создать страницу */
export const NewPage = z.strictObject({
  slug: PageSlug,
  title: PageTitle,
  template: PageTemplate.default('empty'),
})
export type NewPage = z.infer<typeof NewPage>

/** Содержимое новой страницы по шаблону. Проходит через схему, поэтому не разойдётся с ней */
export function pageTemplateContent(template: PageTemplate): PageContent {
  const blocks = template === 'hero' ? [{ id: 'hero', type: 'hero', props: hero.example }] : []
  return PageContent.parse({ blocks })
}

/** Заголовок стандартной страницы 404: она на сайте, пока своей страницы с адресом 404 нет */
export const NOT_FOUND_PAGE_TITLE = 'Страница не найдена'

/**
 * Стандартная страница 404 — первый экран в теме сайта с кнопкой на главную. Проходит через
 * схему, как и страницы из редактора
 */
export function defaultNotFoundContent(): PageContent {
  return PageContent.parse({
    blocks: [
      {
        id: 'not-found',
        type: 'hero',
        props: {
          title: NOT_FOUND_PAGE_TITLE,
          subtitle: 'Возможно, её удалили или в адресе опечатка.',
          button: { label: 'На главную', href: '/' },
        },
      },
    ],
    seo: { noindex: true },
  })
}
