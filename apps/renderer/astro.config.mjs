import react from '@astrojs/react'
import { defineConfig, envField } from 'astro/config'

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
      injectRoute({
        pattern: '/[...slug]',
        entrypoint: './src/routes/page.astro',
        prerender: command !== 'dev',
      })
    },
  },
}

export default defineConfig({
  // React нужен только на этапе сборки: блоки превращаются в HTML, JS в браузер не уходит
  integrations: [react(), sitePages],
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
