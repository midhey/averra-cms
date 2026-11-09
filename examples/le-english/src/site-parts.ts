// Тема, шапка, подвал и окно записи для Vallex English: настройки встроенных возможностей Averra и
// свои виды шапки и подвала, близкие к исходному сайту (src/styles/tokens.css, header.css,
// footer.css, lead-form.css).

/**
 * Тема. Роли — токены исходного сайта: бумага (--color-page → фон, --color-paper → поверхность),
 * чернила (--color-ink → текст), тёмно-зелёный бренда (--color-green → акцент: кнопки, ссылки,
 * тёмная полоса отзывов). Шрифты те же, что в оригинале: Playfair Display для заголовков, Manrope
 * для текста, Caveat для рукописных подписей (акцентный шрифт, `--font-accent`), JetBrains Mono для
 * номеров и надзаголовков (`--font-mono`). Кольцо фокуса — ржавый оригинала (--color-rust): цвета
 * акцента на тёмно-зелёной кнопке его не видно. Строка браузера на телефоне — тёмно-зелёная, как
 * `theme-color` оригинала. Зерно бумаги — фон-картинка (`background`, ставит import по медиатеке).
 * Остальные цвета оригинала (терракота, розовая бумага, скотч) — в CSS блоков: в теме для них ролей
 * нет.
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
  fonts: { heading: 'playfair-display', body: 'manrope', accent: 'caveat', mono: 'jetbrains-mono' },
  radius: 'medium',
  focus: '#b85418',
  browserColor: 'accent',
}

/**
 * CSS окон: окно записи — бумажная карточка оригинала (lead-form.css), заголовок окна —
 * рукописный надзаголовок «Попробуем?», заголовок формы по центру, поля с рамкой 12 px, кнопка —
 * терракотовая «таблетка» со стрелкой. Форма — встроенный блок Averra, поэтому селекторы — по
 * элементам и атрибутам формы, а не по классам: классы встроенных блоков меняются от сборки к сборке
 */
export const windowCss = `:scope {
  --terracotta: #c0503d;
  --terracotta-dark: #a9432f;
  --field-line: rgba(30, 43, 37, 0.32);
  --field-line-hover: rgba(30, 43, 37, 0.6);
  --on-terracotta: #ffffff;
  max-width: 760px;
  border: 0;
  border-radius: 8px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.25);
}

[data-site-window-title] {
  flex: 1;
  margin: 0;
  padding-left: 44px;
  font-family: var(--font-accent);
  font-size: 38px;
  font-weight: 400;
  line-height: 1;
  text-align: center;
  color: var(--color-accent);
  transform: rotate(-4deg);
}

[data-site-window-close] {
  border-color: rgba(33, 61, 50, 0.25);
  color: var(--color-accent);
}

> section {
  padding-top: 0;
}

> section h2 {
  font-size: clamp(30px, 5vw, 44px);
  text-align: center;
  text-wrap: balance;
}

> section [data-form-box] > p {
  text-align: center;
}

> section input:not([type="checkbox"]),
> section select {
  min-height: 56px;
  border: 1px solid var(--field-line);
  border-radius: 12px;
  background-color: transparent;
  font-size: 16px;
}

> section input:not([type="checkbox"]):hover,
> section select:hover {
  border-color: var(--field-line-hover);
}

> section input[type="checkbox"] {
  width: 20px;
  height: 20px;
  accent-color: var(--color-accent);
}

> section button[type="submit"] {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 18px 30px;
  border: 0;
  border-radius: 999px;
  background: var(--terracotta);
  color: var(--on-terracotta);
  font-size: 17px;
  font-weight: 600;
  box-shadow: 0 10px 24px rgba(192, 80, 61, 0.3);
}

> section button[type="submit"]::after {
  content: "→";
}

> section button[type="submit"]:hover {
  background: var(--terracotta-dark);
}

/* Заявка ушла: остаётся только «Ура!», «Заявка у меня» и спасибо (.lead-done оригинала), без
   приглашения над формой. Заголовок окна прячем через visibility: имя окна для читалок остаётся,
   кнопка «Закрыть» не съезжает. Без :has (старые браузеры) «Попробуем?» просто остаётся */
:scope:has([data-form-box][data-sent]) [data-site-window-title] {
  visibility: hidden;
}

> section [data-form-box][data-sent] > h2,
> section [data-form-box][data-sent] > p:not([role="status"]) {
  display: none;
}

> section [data-form-box][data-sent] > [role="status"] {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  max-width: 440px;
  margin: 0 auto;
  padding: 0 0 8px;
  text-align: center;
  font-size: 16px;
  line-height: 1.6;
}

> section [data-form-box][data-sent] > [role="status"]::before {
  content: "Ура!";
  font-family: var(--font-accent);
  font-size: 38px;
  line-height: 1;
  color: var(--color-accent);
  transform: rotate(-4deg);
}

> section [data-form-box][data-sent] [data-done-title] {
  font-family: var(--font-heading);
  font-size: clamp(28px, 4.4vw, 38px);
  font-weight: 500;
  line-height: 1.1;
  color: var(--color-text);
}

@media (max-width: 540px) {
  :scope {
    width: 100%;
    max-width: none;
    height: 100%;
    max-height: none;
    border-radius: 0;
  }
  > section button[type="submit"] {
    justify-content: center;
    width: 100%;
  }
}
`

/**
 * Шапка. Свой вид `le-header` (место «шапка»): разметка и CSS оригинала. Меню, кнопку и логотип
 * клиент правит в «Шапке и подвале» как обычно; подписи строки «Меню» на телефоне — поля вида.
 * Настройки стандартной шапки — запасной вид, если свой вывести нельзя: не липкая, без линии,
 * кнопка-«таблетка», на телефоне кнопка рядом с «Меню». Логотип — текстом (headerBrand), меню —
 * с подписями для телефона, кнопка — в окно записи.
 */
export const headerBase = {
  layout: 'classic',
  sticky: false,
  condense: false,
  overlay: false,
  phone: false,
  button: { label: 'Пробный урок →', page: 'zapis', window: true },
  look: {
    divider: false,
    buttonShape: 'pill',
    buttonHover: 'lift',
    linkHover: 'background',
    mobileButton: 'row',
    mobileMenu: 'panel',
    mobileAlign: 'start',
  },
}

export const HEADER_KEY = 'le-header'
export const headerCustomProps = {
  menu_label: 'Меню',
  menu_cta: 'Записаться на пробный урок →',
}

/**
 * Подвал. Свой вид `le-footer`: знак «Ve» с названием, рукописная подпись (footer.sign оригинала),
 * ссылки на документы с подписями оригинала. Запасной — стандартный подвал одной строкой, фоном
 * страницы и без линии, с той же подписью.
 */
export const footer = {
  layout: 'simple',
  tone: 'background',
  divider: false,
  sections: false,
  textFont: 'accent',
  copyright: false,
  consent: true,
  brand: true,
}

export const FOOTER_KEY = 'le-footer'
export const footerCustomLabels = {
  policy_label: 'Политика обработки персональных данных',
  consent_label: 'Согласие на обработку данных',
}

/**
 * Окно записи: страница /zapis открывается поверх главной (кнопки «Записаться» с «Открывать в
 * окне»). Заголовок окна — рукописное «Попробуем?» оригинала, фон — бумага, клик мимо закрывает
 */
export const signupWindow = {
  title: 'Попробуем?',
  width: 'wide',
  surface: 'surface',
  closeOnBackdrop: true,
}

/** Старые адреса документов исходного сайта → страницы документов Averra */
export const redirects = [
  { from: '/politika', to: '/privacy/' },
  { from: '/soglasie', to: '/consent/' },
]
