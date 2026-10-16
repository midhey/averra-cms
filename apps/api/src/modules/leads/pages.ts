import { html } from '../../mail/html'

// Страницы, которые API показывает посетителю сайта после отправки формы без JavaScript:
// ошибка (что не так и как вернуться) или «Заявка отправлена», если вернуть его на сайт нечем.
// Всё, что пришло извне (подписи полей, тексты блока, адрес страницы), подставляет html`…`
// с экранированием. Скриптов, внешних стилей и картинок нет: их запрещает и заголовок CSP

/** Заголовки ответа-страницы: только встроенные стили, ничего не грузить и никуда не слать */
export const PAGE_HEADERS = {
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
} as const

type PageInput = {
  title: string
  message: string
  /** Что не так, по пунктам: «Телефон — …» */
  problems?: readonly string[]
  /** Куда вернуться: страница с формой. Нет — только совет нажать «Назад» */
  back?: string | undefined
}

export function messagePage({ title, message, problems = [], back }: PageInput) {
  return html`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
  body { margin: 0; font: 16px/1.5 -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #1f2430; background: #f4f5f7; }
  main { max-width: 36rem; margin: 3rem auto; padding: 1.5rem; background: #fff; border: 1px solid #e3e5e9; border-radius: 8px; }
  h1 { margin: 0 0 1rem; font-size: 1.5rem; line-height: 1.2; }
  p, ul { margin: 0 0 1rem; }
  a { color: #2f5bea; }
</style>
</head>
<body>
<main>
<h1>${title}</h1>
<p>${message}</p>
${problems.length > 0 ? html`<ul>${problems.map((problem) => html`<li>${problem}</li>`)}</ul>` : ''}
${back ? html`<p><a href="${back}">Вернуться к форме</a></p>` : ''}
</main>
</body>
</html>`.value
}
