// Ссылки шапки и подвала в новой вкладке: одна разметка везде, где выводятся пункты меню шапки

/** Ссылка в новой вкладке: без доступа новой вкладки к этой странице и без адреса откуда */
export const tabProps = (link: { newTab: boolean }) =>
  link.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {}

/**
 * Диктору заранее — что ссылка откроется в новой вкладке (WCAG 3.2.5). className — класс
 * «только для диктора» того модуля стилей, где выводится ссылка
 */
export function NewTabNote({
  link,
  className,
}: {
  link: { newTab: boolean }
  className: string | undefined
}) {
  if (!link.newTab) return null
  return <span className={className}> (откроется в новой вкладке)</span>
}
