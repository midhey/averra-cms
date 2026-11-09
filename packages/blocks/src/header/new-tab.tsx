// Ссылки шапки и подвала в новой вкладке или в окне: одна разметка везде, где выводятся пункты
// меню шапки

/**
 * Ссылка в новой вкладке — без доступа новой вкладки к этой странице и без адреса откуда; ссылка
 * в окно — с атрибутом data-av-window: скрипт поведений откроет страницу-окно поверх этой
 */
export const tabProps = (link: { newTab: boolean; window?: boolean | undefined }) => ({
  ...(link.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
  ...(link.window && !link.newTab ? { 'data-av-window': '' } : {}),
})

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
