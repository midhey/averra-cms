import type { ReactNode, SVGProps } from 'react'

/**
 * Один набор иконок админки: линии 1,4 px на сетке 18×18, цвет — от текста (`currentColor`).
 * Иконка всегда рядом с подписью или внутри кнопки с `aria-label`, поэтому сама скрыта от диктора
 */
const icons = {
  overview: (
    <>
      <rect x="2.5" y="2.5" width="5.5" height="5.5" rx="1.2" />
      <rect x="10" y="2.5" width="5.5" height="5.5" rx="1.2" />
      <rect x="2.5" y="10" width="5.5" height="5.5" rx="1.2" />
      <rect x="10" y="10" width="5.5" height="5.5" rx="1.2" />
    </>
  ),
  pages: (
    <>
      <path d="M4 2.5h7l3 3v10H4z" />
      <path d="M6.5 9h5M6.5 12h5" />
    </>
  ),
  media: (
    <>
      <rect x="2.5" y="3.5" width="13" height="11" rx="1.5" />
      <path d="M2.5 12l3.5-3.5 3 3 2-2 4.5 4.5" />
      <circle cx="12" cy="7" r="1.2" />
    </>
  ),
  palette: (
    <>
      <path d="M9 2.5a6.5 6.5 0 1 0 0 13c.9 0 1.5-.6 1.5-1.4 0-.9-.8-1.3-.8-2.1 0-.8.6-1.4 1.5-1.4h1.8c1.5 0 2.5-1 2.5-2.6C15.5 5 12.6 2.5 9 2.5z" />
      <circle cx="5.8" cy="8.2" r="0.9" />
      <circle cx="8.3" cy="5.6" r="0.9" />
      <circle cx="11.6" cy="6.4" r="0.9" />
    </>
  ),
  // Окно страницы с полосой шапки сверху: раздел «Шапка и подвал»
  header: (
    <>
      <rect x="2.5" y="3" width="13" height="12" rx="1.5" />
      <path d="M2.5 6.5h13M5 4.75h3" />
    </>
  ),
  leads: (
    <>
      <path d="M4 3.5h10l1.5 6.5v4.5h-13V10z" />
      <path d="M2.5 10h3.5l1 2h4l1-2h3.5" />
    </>
  ),
  bell: (
    <>
      <path d="M4.5 12.5V8a4.5 4.5 0 0 1 9 0v4.5l1.5 1.5H3z" />
      <path d="M7.5 15.5a1.5 1.5 0 0 0 3 0" />
    </>
  ),
  mail: (
    <>
      <rect x="2.5" y="3.5" width="13" height="11" rx="1.5" />
      <path d="M2.5 5.5l6.5 4.5 6.5-4.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="9" cy="9" r="2.5" />
      <path d="M9 2v2M9 14v2M2 9h2M14 9h2M4 4l1.4 1.4M12.6 12.6L14 14M4 14l1.4-1.4M12.6 5.4L14 4" />
    </>
  ),
  status: <path d="M2 9h3l2-5 4 10 2-5h3" />,
  'chevron-down': <path d="M5 7l4 4 4-4" />,
  'chevron-left': <path d="M11 4L6 9l5 5" />,
  'chevron-right': <path d="M7 4l5 5-5 5" />,
  'arrow-right': <path d="M3.5 9h11M10 4.5L14.5 9 10 13.5" />,
  'arrow-up': <path d="M9 14.5v-11M4.5 8L9 3.5 13.5 8" />,
  'arrow-down': <path d="M9 3.5v11M4.5 10L9 14.5 13.5 10" />,
  search: (
    <>
      <circle cx="8" cy="8" r="5" />
      <path d="M12 12l3.5 3.5" />
    </>
  ),
  drag: (
    <path d="M7 4.5h.01M11 4.5h.01M7 9h.01M11 9h.01M7 13.5h.01M11 13.5h.01" strokeWidth="2.2" />
  ),
  plus: <path d="M9 3.5v11M3.5 9h11" />,
  close: <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />,
  menu: <path d="M3 5h12M3 9h12M3 13h12" />,
  external: <path d="M10 3.5h4.5V8M14.5 3.5L8 10M12.5 10.5v4h-9v-9h4" />,
  check: <path d="M3.5 9.5l3.5 3.5 7.5-8" />,
  warning: (
    <>
      <path d="M9 2.5l7 12.5H2z" />
      <path d="M9 7v3.5M9 13h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="9" cy="9" r="6.5" />
      <path d="M9 8.5v4M9 5.5h.01" />
    </>
  ),
  edit: <path d="M11.5 3.5l3 3L6 15H3v-3l8.5-8.5zM10 5l3 3" />,
  trash: <path d="M3 5h12M7 5V3.5h4V5M4.5 5l.8 10h7.4l.8-10" />,
  download: <path d="M9 3v8.5M5.5 8l3.5 3.5L12.5 8M3.5 14.5h11" />,
  upload: <path d="M9 12V3.5M5.5 7L9 3.5 12.5 7M3.5 14.5h11" />,
  history: (
    <>
      <path d="M3 9a6 6 0 1 0 1.8-4.3M3 3v3h3" />
      <path d="M9 6v3.5l2 1.5" />
    </>
  ),
  logout: <path d="M7 3.5H3.5v11H7M11 6l3 3-3 3M14 9H7" />,
  user: (
    <>
      <circle cx="9" cy="6.5" r="2.8" />
      <path d="M3.5 15.5c1-3 3-4.5 5.5-4.5s4.5 1.5 5.5 4.5" />
    </>
  ),
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof icons
export const iconNames = Object.keys(icons) as IconName[]

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  name: IconName
  /** Размер в пикселях; по умолчанию 18, как в концепте */
  size?: number
}

export function Icon({ name, size = 18, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {icons[name]}
    </svg>
  )
}
