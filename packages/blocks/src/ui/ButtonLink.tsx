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

export function ButtonLink({ label, href, appearance = 'filled', wide }: ButtonLinkProps) {
  return (
    <a className={styles.button} href={href} data-appearance={appearance} data-wide={wide}>
      {label}
    </a>
  )
}
