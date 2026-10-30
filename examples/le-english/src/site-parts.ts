// Тема, шапка, подвал и страница записи для Vallex English: настройки встроенных возможностей Averra,
// близкие к виду исходного сайта (src/styles/tokens.css, header.css, footer.css).

/**
 * Тема. Роли — токены исходного сайта: бумага (--color-page → фон, --color-paper → поверхность),
 * чернила (--color-ink → текст), тёмно-зелёный бренда (--color-green → акцент: кнопки, ссылки,
 * тёмная полоса отзывов). Шрифты те же, что в оригинале: Playfair Display для заголовков, Manrope
 * для текста, Caveat для рукописных подписей (акцентный шрифт, `--font-accent`). Остальные цвета
 * оригинала (терракота, розовая бумага, скотч) — в CSS блоков: в теме для них нет ролей.
 */
export const theme = {
  colors: {
    background: '#f3ece0',
    surface: '#fbf7f0',
    text: '#1e2b25',
    muted: '#5b645e',
    accent: '#213d32',
    onAccent: '#fbf7f0',
    border: '#d6cdbb',
  },
  fonts: { heading: 'playfair-display', body: 'manrope', accent: 'caveat' },
  radius: 'medium',
}

/**
 * Шапка: логотип, меню секций, кнопка «Пробный урок». Не липкая — как в оригинале, где шапка
 * уезжает вместе со страницей.
 */
export const headerBase = {
  layout: 'classic',
  sticky: false,
  condense: false,
  overlay: false,
  phone: false,
  button: { label: 'Пробный урок →', page: 'zapis' },
}

/** Подвал: одна строка с реквизитами и документами на поверхности темы */
export const footer = { layout: 'simple', tone: 'surface', sections: false }

/** Старые адреса документов исходного сайта → страницы документов Averra */
export const redirects = [
  { from: '/politika', to: '/privacy' },
  { from: '/soglasie', to: '/consent' },
]
