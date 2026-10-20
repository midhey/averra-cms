import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'
import starlightLinksValidator from 'starlight-links-validator'

const repo = 'https://github.com/midhey/averra-cms'

export default defineConfig({
  // GitHub Pages проекта: сайт живёт в подпапке /averra-cms/. Ссылки в Markdown пишем с ней
  site: 'https://midhey.github.io',
  base: '/averra-cms',
  // Порт рендерера (4321) не занимаем: docs можно запустить рядом с pnpm dev
  server: { port: 4330 },
  integrations: [
    starlight({
      title: 'Averra',
      description: 'Документация Averra — лёгкой CMS для лендингов: установка, админка, MCP.',
      logo: { src: './src/assets/mark.svg' },
      // Русский — корневая локаль: страницы прямо в src/content/docs, адреса без /ru/.
      // Английский добавится папкой src/content/docs/en и строкой en: { label: 'English', lang: 'en' }
      defaultLocale: 'root',
      locales: {
        root: { label: 'Русский', lang: 'ru' },
      },
      social: [{ icon: 'github', label: 'GitHub', href: repo }],
      editLink: { baseUrl: `${repo}/edit/master/apps/docs/` },
      customCss: ['./src/styles/theme.css'],
      // Битая внутренняя ссылка или якорь роняет сборку (а с ней pnpm check)
      plugins: [starlightLinksValidator()],
      sidebar: [
        { label: 'Обзор', items: [{ autogenerate: { directory: 'overview' } }] },
        { label: 'Установка и сопровождение', items: [{ autogenerate: { directory: 'install' } }] },
        { label: 'Работа в админке', items: [{ autogenerate: { directory: 'admin' } }] },
        { label: 'Нейронки и MCP', items: [{ autogenerate: { directory: 'mcp' } }] },
        // Разделы из одной страницы — просто ссылки: группа с единственным пунктом лишняя
        { label: 'Разработчику', slug: 'dev' },
        { label: 'Решения', slug: 'decisions' },
        { label: 'Дорожная карта', slug: 'roadmap' },
      ],
    }),
  ],
})
