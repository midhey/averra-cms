import { z } from 'zod'
import { hero } from './blocks'
import { PageBlock } from './custom-blocks'
import { MediaId } from './media'
import { HTTPS_URL, isInternalPath } from './url'

/** Сколько блоков может быть на странице: редактор пишет «3 из 50» и не даёт добавить больше */
export const PAGE_MAX_BLOCKS = 50

/** Описание для поисковиков и соцсетей (страницы и сайта). Поисковик покажет около 160 символов */
export const SEO_DESCRIPTION_MAX = 300
export const SEO_DESCRIPTION_RECOMMENDED = 160

/** SEO-заголовок страницы: тот же предел, что у заголовка страницы */
export const SEO_TITLE_MAX = 120

/**
 * Canonical страницы: путь на этом сайте (/ceny/) или ссылка https:// — по тем же правилам, что
 * «куда» у редиректов. Пусто — свой адрес страницы. Кавычки, < > и управляющие символы на выходе
 * экранируются, но адрес с ними — всё равно кривой: поисковик его не поймёт. Поэтому их нет и в
 * ссылке https, где правило домена хвост не проверяет
 */
export const PageCanonical = z
  .string()
  .trim()
  .max(2000)
  .refine(
    (href) =>
      href === '' ||
      ((isInternalPath(href) || HTTPS_URL.test(href)) && !/[\s#"<>\\\p{Cc}]/u.test(href)),
    'Путь на этом сайте (/ceny/) или ссылка https://, без пробелов, кавычек, <, > и #',
  )

/**
 * Поиск и соцсети на уровне страницы. Необязательно целиком и по полям: чего нет — берётся у сайта
 * (раздел «SEO») или из самой страницы. Живёт в содержимом страницы, поэтому версионируется вместе
 * с блоками: правка попадает на сайт только с публикацией и остаётся в истории.
 *
 * Картинка — { mediaId }, как у блоков: по ключу mediaId её находят проверка медиатеки, защита от
 * удаления, справочник картинок сборки и «где используется». Описания (alt) у неё нет — картинку
 * для соцсетей показывают превью ссылки
 */
export const PageSeo = z.strictObject({
  title: z
    .string()
    .trim()
    .max(SEO_TITLE_MAX)
    .optional()
    .meta({ title: 'SEO-заголовок', description: 'Целиком, шаблон сайта не добавляется' }),
  description: z
    .string()
    .trim()
    .max(SEO_DESCRIPTION_MAX)
    .optional()
    .meta({ title: 'Описание для поисковиков и соцсетей' }),
  image: z
    .strictObject({ mediaId: MediaId.meta({ title: 'Картинка' }) })
    .optional()
    .meta({ title: 'Картинка для соцсетей' }),
  canonical: PageCanonical.optional().meta({ title: 'Канонический адрес (canonical)' }),
  noindex: z.boolean().optional().meta({ title: 'Скрыть страницу от поисковиков' }),
})
export type PageSeo = z.infer<typeof PageSeo>

export const PageContent = z
  .strictObject({
    // Встроенные и свои блоки. Поля своих проверяет applyCustomBlocks по опубликованным
    // определениям: их нет в коде, они в базе установки
    blocks: z.array(PageBlock).max(PAGE_MAX_BLOCKS),
    seo: PageSeo.optional(),
    // Скрыть шапку сайта на этой странице (промо-лендинг): часть черновика, на сайт — с публикацией
    hideHeader: z.boolean().optional().meta({
      title: 'Скрыть шапку сайта',
      description: 'Для промо-страницы: на ней не будет шапки и меню сайта',
    }),
    // Скрыть подвал сайта на этой странице: остаётся только строка с политикой и cookie
    hideFooter: z.boolean().optional().meta({
      title: 'Скрыть подвал сайта',
      description:
        'Для промо-страницы: внизу останутся только ссылки на политику и настройки cookie',
    }),
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
 * Адреса, которые заняты не страницами. /api/ — приём форм на домене сайта, он закрыт в
 * robots.txt, и страница там попала бы в карту сайта вопреки ему. 500 Astro собирает в 500.html,
 * а не в 500/index.html: на сервере по /500/ такой страницы нет. Уже созданные страницы с этими
 * адресами (ExistingPageSlug их пускает) не индексируются — см. isServicePageSlug
 */
export const RESERVED_PAGE_SLUGS = ['api', '500'] as const

/** Страница со служебным адресом из старой базы: её нет в карте сайта, у неё noindex */
export const isServicePageSlug = (slug: string) =>
  (RESERVED_PAGE_SLUGS as readonly string[]).includes(slug)

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
  .refine((slug) => !isServicePageSlug(slug), {
    error: (issue) =>
      `Адрес /${String(issue.input)}/ занят служебной частью сайта: выберите другой`,
  })

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
