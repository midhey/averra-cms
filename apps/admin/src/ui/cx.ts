/** Склеивает классы, пропуская пустые: cx(styles.button, primary && styles.primary) */
export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ')
}
