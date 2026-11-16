import { Checkbox } from '../ui/Checkbox'
import type { CheckboxStyle, SwitchStyle } from '../ui/control-style'
import { PageHeader } from '../ui/PageHeader'
import { Switch } from '../ui/Switch'
import { usePageTitle } from '../ui/use-page-title'
import styles from './ControlsShowcase.module.scss'

const switches: { variant: SwitchStyle; description: string }[] = [
  { variant: 'minimal', description: 'Тонкая плоская дорожка, небольшой ползунок, без теней.' },
  { variant: 'icon', description: 'Галочка и крестик в ползунке: состояние читается без цвета.' },
  {
    variant: 'ios',
    description:
      'Крупная пилюля, белый ползунок с тенью. При нажатии растягивается. Включение — цвет действия.',
  },
]
const checkboxes: { variant: CheckboxStyle; description: string }[] = [
  { variant: 'classic', description: 'Квадрат 18 px, контрастная заливка, прорисовка галочки.' },
  {
    variant: 'soft',
    description: 'Мягкая акцентная заливка, цветная галочка, подсветка всей строки.',
  },
]

function SwitchExamples({ variant }: { variant: SwitchStyle }) {
  return (
    <div className={styles.examples}>
      <Switch variant={variant} label="Выключен" />
      <Switch variant={variant} label="Включён" defaultChecked />
      <Switch variant={variant} label="Tab сюда" />
      <div className={styles.focusDemo}>
        <Switch variant={variant} label="Образец кольца фокуса" />
      </div>
      <Switch variant={variant} label="Недоступен, выключен" disabled />
      <Switch variant={variant} label="Недоступен, включён" disabled defaultChecked />
      <Switch variant={variant} label="С подсказкой" hint="Настройку можно изменить позже" />
      <Switch variant={variant} label="С ошибкой" error="Не удалось сохранить настройку" />
      <Switch
        variant={variant}
        label={
          <>
            Показывать телефон в шапке
            <br />
            на всех страницах сайта
          </>
        }
      />
    </div>
  )
}

function CheckboxExamples({ variant }: { variant: CheckboxStyle }) {
  return (
    <div className={styles.examples}>
      <Checkbox variant={variant} label="Без отметки" />
      <Checkbox variant={variant} label="С отметкой" defaultChecked />
      <Checkbox variant={variant} label="Tab сюда" />
      <div className={styles.focusDemo}>
        <Checkbox variant={variant} label="Образец кольца фокуса" />
      </div>
      <Checkbox variant={variant} label="Недоступен, без отметки" disabled />
      <Checkbox variant={variant} label="Недоступен, с отметкой" disabled defaultChecked />
      <Checkbox variant={variant} label="С подсказкой" hint="Выберите подходящие пункты" />
      <Checkbox variant={variant} label="С ошибкой" error="Выберите хотя бы один пункт" />
      <Checkbox
        variant={variant}
        label={
          <>
            Согласен на обработку
            <br />
            персональных данных
          </>
        }
      />
      <Checkbox variant={variant} label="Частичный выбор" indeterminate />
    </div>
  )
}

/** Области не меняют тему приложения: оба набора ролей видны одновременно. */
export function ControlsShowcase() {
  usePageTitle('Витрина переключателей и флажков')
  return (
    <main className={styles.page}>
      <PageHeader title="Витрина переключателей и флажков" eyebrow="Только в режиме разработки" />
      <a href="/dev/ui">Все компоненты</a>
      <p>
        Стиль всей админки задаётся в control-style.ts. Все примеры интерактивны; Tab показывает
        настоящий фокус, Space меняет состояние.
      </p>
      <div className={styles.themes}>
        {(['light', 'dark'] as const).map((theme) => (
          <section
            key={theme}
            data-theme-scope={theme}
            className={styles.theme}
            aria-label={theme === 'light' ? 'Светлая тема' : 'Тёмная тема'}
          >
            <h2>{theme === 'light' ? 'Светлая тема' : 'Тёмная тема'}</h2>
            {switches.map(({ variant, description }) => (
              <article key={variant} className={styles.variant}>
                <h3>Switch · {variant}</h3>
                <p>{description}</p>
                <code>SWITCH_STYLE = '{variant}'</code>
                <SwitchExamples variant={variant} />
              </article>
            ))}
            {checkboxes.map(({ variant, description }) => (
              <article key={variant} className={styles.variant}>
                <h3>Checkbox · {variant}</h3>
                <p>{description}</p>
                <code>CHECKBOX_STYLE = '{variant}'</code>
                <CheckboxExamples variant={variant} />
              </article>
            ))}
          </section>
        ))}
      </div>
    </main>
  )
}
