import { useSyncExternalStore } from 'react'
import { SegmentedControl } from './SegmentedControl'

type AdminTheme = 'light' | 'dark' | 'system'

function currentTheme(): AdminTheme {
  const theme = document.documentElement.dataset.theme
  return theme === 'dark' || theme === 'system' ? theme : 'light'
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}

function setTheme(theme: AdminTheme) {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem('averra-admin-theme', theme)
  } catch {
    // В закрытом хранилище выбор работает до перезагрузки страницы
  }
}

/** Один переключатель для профиля и витрины: текущий выбор берём из раннего скрипта */
export function AdminThemeControl() {
  const theme = useSyncExternalStore(subscribe, currentTheme)
  return (
    <SegmentedControl
      legend="Тема админки"
      wrap
      options={[
        { value: 'light', label: 'Светлая' },
        { value: 'dark', label: 'Тёмная' },
        { value: 'system', label: 'Как в системе' },
      ]}
      value={theme}
      onChange={setTheme}
    />
  )
}
