import react from '@astrojs/react'
import { fontFilesPlugin } from '@averra/tokens/vite'
import { defineConfig, envField } from 'astro/config'
import { ICON_FILES } from './src/lib/icon-files.ts'

/**
 * Страницы сайта — один маршрут на все адреса. При сборке он статический: getStaticPaths
 * берёт список опубликованных страниц из API. В dev — рендер по запросу: Astro в dev
 * запоминает результат getStaticPaths до правки файла, и страница, опубликованная после
 * запуска dev-сервера, отдавала бы 404. Файловый маршрут так не настроить: prerender
 * в файле должен быть константой, а здесь он зависит от команды
 */
const sitePages = {
  name: 'averra-site-pages',
  hooks: {
    'astro:config:setup': ({ command, injectRoute }) => {
      const prerender = command !== 'dev'
      injectRoute({ pattern: '/[...slug]', entrypoint: './src/routes/page.astro', prerender })
      // В dev у /404 своя заглушка Astro, и она главнее маршрута [...slug]: страница 404 сайта
      // по её адресу — отдельным маршрутом. При сборке 404.html пишет [...slug]
      if (!prerender) injectRoute({ pattern: '/404', entrypoint: './src/routes/page.astro' })
      // Служебные файлы сайта в корне: robots.txt, sitemap.xml, а при иконке в «SEO» — набор
      // иконок и манифест. Адреса с точкой: страница сайта так называться не может (PageSlug)
      injectRoute({ pattern: '/robots.txt', entrypoint: './src/routes/robots.ts', prerender })
      injectRoute({ pattern: '/sitemap.xml', entrypoint: './src/routes/sitemap.ts', prerender })
      // Карточки страниц для соцсетей из заголовка: /og/<адрес>.png. В dev неизвестный адрес под
      // /og/ — редирект или страница 404 сайта, как на сервере
      injectRoute({ pattern: '/og/[slug].png', entrypoint: './src/routes/og.ts', prerender })
      // Шрифты темы со своего сервера: при сборке — только начертания темы сайта
      injectRoute({
        pattern: '/_fonts/[file].woff2',
        entrypoint: './src/routes/fonts.ts',
        prerender,
      })
      const manifest = './src/routes/manifest.ts'
      const favicon = './src/routes/favicon.ts'
      const icons = './src/routes/icons.ts'
      if (prerender) {
        // Сборке нужен параметр: getStaticPaths без иконки не отдаёт ни одного адреса, и файлов
        // иконок в релизе нет вовсе
        injectRoute({ pattern: '/[name].webmanifest', entrypoint: manifest, prerender })
        injectRoute({ pattern: '/[name].ico', entrypoint: favicon, prerender })
        injectRoute({ pattern: '/[icon].png', entrypoint: icons, prerender })
      } else {
        // В dev — только точные адреса: маршрут /[icon].png забрал бы любой /x.png, и такой адрес
        // не дошёл бы до редиректов и страницы 404 сайта, как доходит на сервере
        injectRoute({ pattern: '/manifest.webmanifest', entrypoint: manifest })
        injectRoute({ pattern: '/favicon.ico', entrypoint: favicon })
        for (const icon of ICON_FILES) injectRoute({ pattern: `/${icon}.png`, entrypoint: icons })
      }
    },
  },
}

export default defineConfig({
  // React нужен только на этапе сборки: блоки превращаются в HTML, JS в браузер не уходит
  integrations: [react(), sitePages],
  // Пути к файлам шрифтов из пакетов @fontsource (virtual:averra/font-files): маршрут /_fonts/
  // читает с диска только файлы темы сайта, остальные в сборку не попадают
  vite: { plugins: [fontFilesPlugin({ as: 'path' })] },
  server: { port: 4321 },
  env: {
    schema: {
      CMS_API_URL: envField.string({
        context: 'server',
        access: 'public',
        default: 'http://localhost:4000',
      }),
      // Какой сайт собирать. Не задан — сайт установки (одна установка — один сайт): его снимок
      // открыт по /api/site/snapshot. Задаёт его API сборщику публикации, руками он не нужен
      CMS_SITE_ID: envField.string({ context: 'server', access: 'public', optional: true }),
      // Куда ведут ссылки на картинки и формы. api — на CMS_API_URL (pnpm dev, e2e, сборка руками).
      // relative — от корня сайта: публикация на сервере кладёт файлы картинок в папку
      // релиза (/media/…), а Caddy домена сайта передаёт /api/forms/… в API. Так сайт не зависит
      // от адреса API, а форма уходит на тот же источник — без CORS
      CMS_LINKS: envField.enum({
        context: 'server',
        access: 'public',
        values: ['api', 'relative'],
        default: 'api',
      }),
    },
  },
})
