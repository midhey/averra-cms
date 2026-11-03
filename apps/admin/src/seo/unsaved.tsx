import { useBlocker } from '@tanstack/react-router'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { Button } from '../ui/Button'
import { FormActions } from '../ui/Screen'
import { StatusPill } from '../ui/StatusPill'
import styles from './unsaved.module.scss'

// Единое правило несохранённого для всех экранов с формами: форма сообщает экрану, есть ли у неё
// правки, а экран спрашивает перед уходом, как редактор страницы. Экран с несколькими карточками
// (SEO) к тому же собирает одну кнопку «Сохранить» на все: карточки регистрируют, как себя
// проверить и сохранить

/** Как карточка проверяется и сохраняется, когда кнопка одна на экран */
export type CardSaver = {
  unsaved: boolean
  /** Показывает ошибки полей; false — сохранять нечего из-за ошибки */
  validate: () => boolean
  /** Ставит фокус на первое поле с ошибкой */
  focusError: () => void
  /** true — сохранено; false — не вышло (карточка уже показала причину у себя) */
  save: () => Promise<boolean>
}

type Context = {
  report: (card: string, unsaved: boolean) => void
  /** Единая кнопка «Сохранить» на экране: карточки без своих кнопок и их сохранение */
  saveAll: boolean
  saveAllCards: () => void
  register: (card: string, saver: CardSaver | null) => void
  pending: boolean
}

const UnsavedContext = createContext<Context | null>(null)

type GuardProps = {
  children: ReactNode
  /**
   * Одна кнопка «Сохранить» на весь экран вместо кнопки в каждой карточке: липкая полоса внизу,
   * активная, пока есть несохранённое. Сначала проверяются поля всех карточек: ошибка в любой — и не
   * сохранено ничего. Дальше карточки сохраняются по очереди; сбой сервера в одной оставляет
   * сохранёнными те, что были до неё, остальные ждут
   */
  saveAll?: boolean
}

/**
 * Экран с формами: собирает, у каких есть несохранённые правки, и спрашивает перед уходом с
 * экрана, если такие есть
 */
export function UnsavedChangesGuard({ children, saveAll = false }: GuardProps) {
  const [cards, setCards] = useState<ReadonlySet<string>>(() => new Set())
  const savers = useRef(new Map<string, CardSaver>())
  const [pending, setPending] = useState(false)
  const bar = useRef<HTMLDivElement>(null)
  const [notice, setNotice] = useState<{ kind: 'done' | 'error'; text: string }>()

  const report = useCallback<Context['report']>((card, unsaved) => {
    setCards((current) => {
      if (current.has(card) === unsaved) return current
      const next = new Set(current)
      if (unsaved) next.add(card)
      else next.delete(card)
      return next
    })
  }, [])

  const register = useCallback<Context['register']>((card, saver) => {
    if (saver) savers.current.set(card, saver)
    else savers.current.delete(card)
  }, [])

  const saveAllCards = useCallback(() => {
    const changed = [...savers.current.values()].filter((saver) => saver.unsaved)
    if (changed.length === 0) return
    setNotice(undefined)
    setPending(true)
    void (async () => {
      try {
        // Проверяем все до одной, чтобы ошибки были видны везде, а не только в первой карточке
        const checked = changed.map((saver) => ({ saver, valid: saver.validate() }))
        const invalid = checked.find((item) => !item.valid)
        if (invalid) {
          invalid.saver.focusError()
          setNotice({ kind: 'error', text: 'Ничего не сохранено: поправьте поля с ошибками' })
          return
        }
        for (const saver of changed) {
          if (!(await saver.save())) {
            setNotice({
              kind: 'error',
              text: 'Не всё сохранено: причина — в карточке, где не вышло. Остальные ждут',
            })
            return
          }
        }
        setNotice({ kind: 'done', text: 'Всё сохранено' })
      } finally {
        setPending(false)
      }
    })()
  }, [])

  // Липкая полоса не должна закрывать поле, на которое ушёл фокус с клавиатуры (WCAG 2.4.11).
  // scroll-padding тут не помогает: браузер не прокручивает, если поле целиком в окне, пусть и под
  // полосой, — поэтому при фокусе подкручиваем страницу сами
  useEffect(() => {
    if (!saveAll) return
    const onFocusIn = (event: FocusEvent) => {
      const element = bar.current
      const target = event.target
      if (!element || !(target instanceof HTMLElement) || element.contains(target)) return
      const box = target.getBoundingClientRect()
      const barTop = element.getBoundingClientRect().top
      if (box.bottom > barTop && box.top < window.innerHeight) {
        window.scrollBy({ top: box.bottom - barTop + 8, behavior: 'instant' })
      }
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [saveAll])

  useBlocker({
    shouldBlockFn: () =>
      !window.confirm(
        // Карточки — только там, где они есть на экране (SEO); у остальных «карточек» нет
        !saveAll
          ? 'На странице есть несохранённые правки. Уйти без сохранения?'
          : cards.size === 1
            ? 'В одной карточке есть несохранённые правки. Уйти без сохранения?'
            : `В карточках (${cards.size}) есть несохранённые правки. Уйти без сохранения?`,
      ),
    disabled: cards.size === 0,
    // Закрытие вкладки и перезагрузка спрашивают так же, как в редакторе страницы
    enableBeforeUnload: cards.size > 0,
  })

  return (
    <UnsavedContext.Provider value={{ report, saveAll, saveAllCards, register, pending }}>
      {children}
      {saveAll && (
        <div ref={bar} className={styles.bar}>
          <FormActions>
            <Button
              variant="primary"
              loading={pending}
              aria-disabled={cards.size === 0 ? true : undefined}
              onClick={saveAllCards}
            >
              Сохранить
            </Button>
            {cards.size > 0 && !pending && (
              <StatusPill tone="warning" appearance="dot">
                {cards.size === 1
                  ? 'Не сохранена одна карточка'
                  : `Не сохранено карточек: ${cards.size}`}
              </StatusPill>
            )}
          </FormActions>
          {notice && (
            <p
              role={notice.kind === 'error' ? 'alert' : 'status'}
              className={notice.kind === 'error' ? styles.error : styles.done}
            >
              {notice.text}
            </p>
          )}
        </div>
      )}
    </UnsavedContext.Provider>
  )
}

/**
 * Карточка сообщает экрану, есть ли у неё несохранённые правки. Вне экрана — ничего не делает.
 * saver нужен, когда у экрана одна кнопка «Сохранить» (saveAll)
 */
export function useReportUnsaved(unsaved: boolean, saver?: Omit<CardSaver, 'unsaved'>) {
  const context = useContext(UnsavedContext)
  const card = useId()
  const report = context?.report
  const register = context?.register
  useEffect(() => {
    report?.(card, unsaved)
  }, [report, card, unsaved])
  // Свежие функции — на каждый кадр: сохранение берёт значения полей, а не те, что были при показе
  useEffect(() => {
    if (saver) register?.(card, { ...saver, unsaved })
  })
  // Карточка ушла с экрана — её правки больше не держат уход
  useEffect(
    () => () => {
      report?.(card, false)
      register?.(card, null)
    },
    [report, register, card],
  )
}

/** Одна кнопка на экран: карточка не рисует свою «Сохранить», а Enter в поле сохраняет всё */
export function useSaveAll() {
  const context = useContext(UnsavedContext)
  return context?.saveAll ? { saveAll: context.saveAllCards, pending: context.pending } : null
}
