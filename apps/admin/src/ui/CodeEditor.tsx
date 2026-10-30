import { type CSSProperties, type ReactNode, type Ref, useMemo, useRef } from 'react'
import styles from './CodeEditor.module.scss'
import { type CodeLanguage, highlightCode } from './code-highlight'
import { cx } from './cx'
import { Field } from './Field'

export type LineMark = 'error' | 'warning'

type CodeEditorProps = {
  label: ReactNode
  hint?: ReactNode
  /** Ошибка поля целиком (не строки): текст под полем */
  error?: string | undefined
  value: string
  onChange: (value: string) => void
  language: CodeLanguage
  /** Строки с замечаниями: номер строки (с 1) → ошибка или предупреждение. Видно у номера */
  marks?: ReadonlyMap<number, LineMark>
  /** Высота поля в строках */
  rows?: number
  /** Свои описания (замечания под полем): поле добавит к ним подсказку и ошибку */
  'aria-describedby'?: string | undefined
  textareaRef?: Ref<HTMLTextAreaElement>
  readOnly?: boolean
}

/**
 * Поле для кода (шаблон Liquid, CSS): настоящий <textarea> с подписью, а под ним — та же строка с
 * подсветкой и номера строк. Клавиатура — как у обычного поля: Tab уходит к следующему элементу,
 * а не вставляет отступ (иначе с клавиатуры из поля не выйти), отступы пишут пробелами. Диктор
 * читает поле как поле, подсветка и номера от него скрыты. Строки с ошибкой отмечены у номера
 * цветом и знаком — не только цветом
 */
export function CodeEditor({
  label,
  hint,
  error,
  value,
  onChange,
  language,
  marks,
  rows = 16,
  textareaRef,
  readOnly,
  'aria-describedby': describedBy,
}: CodeEditorProps) {
  const highlightRef = useRef<HTMLPreElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const tokens = useMemo(() => highlightCode(value, language), [value, language])
  const lineCount = value.split('\n').length

  // Подсветка и номера едут вместе с текстом поля: прокрутка у них своя, скрытая
  const sync = (target: HTMLTextAreaElement) => {
    if (highlightRef.current) {
      highlightRef.current.scrollTop = target.scrollTop
      highlightRef.current.scrollLeft = target.scrollLeft
    }
    if (gutterRef.current) gutterRef.current.scrollTop = target.scrollTop
  }

  return (
    <Field label={label} hint={hint} error={error} aria-describedby={describedBy}>
      {(control) => (
        <div className={styles.editor} style={{ '--code-rows': rows } as CSSProperties}>
          <div ref={gutterRef} className={styles.gutter} aria-hidden="true">
            {Array.from({ length: lineCount }, (_, index) => {
              const mark = marks?.get(index + 1)
              return (
                <span key={index} className={cx(styles.line, mark && styles[mark])}>
                  {mark === 'error' ? '! ' : mark === 'warning' ? '· ' : ''}
                  {index + 1}
                </span>
              )
            })}
          </div>
          <div className={styles.area}>
            <pre ref={highlightRef} className={styles.highlight} aria-hidden="true">
              <code>
                {tokens.map((token, index) =>
                  token.kind ? (
                    // Куски не переставляются: ключ по месту
                    <span key={index} className={styles[token.kind]}>
                      {token.text}
                    </span>
                  ) : (
                    token.text
                  ),
                )}
                {/* Последняя пустая строка тоже должна занимать место, как в поле */}
                {'\n'}
              </code>
            </pre>
            <textarea
              {...control}
              ref={textareaRef}
              className={styles.input}
              value={value}
              rows={rows}
              readOnly={readOnly}
              wrap="off"
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              onChange={(event) => onChange(event.target.value)}
              onScroll={(event) => sync(event.currentTarget)}
            />
          </div>
        </div>
      )}
    </Field>
  )
}
