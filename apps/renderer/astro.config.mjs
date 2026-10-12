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
  name: 'cms-site-pages',
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
      // Какой сайт собирать (apps/renderer/.env). Список сайтов в API закрыт входом, поэтому
      // «первый сайт» рендерер узнать не может, а снимок сайта открыт и берётся по id
      CMS_SITE_ID: envField.string({ context: 'server', access: 'public', optional: true }),
    },
  },
})
