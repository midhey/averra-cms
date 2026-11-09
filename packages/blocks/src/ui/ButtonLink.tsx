import type { BlockData } from '../types'
import styles from './ButtonLink.module.css'

type ButtonLinkProps = BlockData<'cta'>['button'] & {
  /**
   * filled — заливка акцентом (главное действие), outline — рамка акцентом и надпись цветом
   * текста: надпись акцентом на фоне тема проверяет только как крупный текст (3:1)
   */
  appearance?: 'filled' | 'outline'
  /** Кнопка на всю ширину карточки (тарифы) */
  wide?: boolean
}

export function ButtonLink({ label, href, window, appearance = 'filled', wide }: ButtonLinkProps) {
  return (
    <a
      className={styles.button}
      href={href}
      data-appearance={appearance}
      data-wide={wide}
      // «Открывать в окне»: скрипт поведений откроет страницу по ссылке окном, если она — окно
      data-av-window={window ? '' : undefined}
    >
      {label}
    </a>
  )
}
