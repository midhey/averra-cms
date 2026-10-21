import { useBlocker } from '@tanstack/react-router'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useState,
} from 'react'

// У каждой карточки раздела «SEO» своя кнопка «Сохранить». Поправили две, сохранили одну — уход
// с экрана молча потерял бы вторую. Карточки сообщают экрану, есть ли у них несохранённое, а
// экран спрашивает перед уходом, как редактор страницы

type Report = (card: string, unsaved: boolean) => void

const UnsavedContext = createContext<Report | null>(null)

/**
 * Экран с карточками: собирает, у каких карточек есть несохранённые правки, и спрашивает перед
 * уходом с экрана, если такие есть
 */
export function UnsavedChangesGuard({ children }: { children: ReactNode }) {
  const [cards, setCards] = useState<ReadonlySet<string>>(() => new Set())
  const report = useCallback<Report>((card, unsaved) => {
    setCards((current) => {
      if (current.has(card) === unsaved) return current
      const next = new Set(current)
      if (unsaved) next.add(card)
      else next.delete(card)
      return next
    })
  }, [])

  useBlocker({
    shouldBlockFn: () =>
      !window.confirm(
        cards.size === 1
          ? 'В одной карточке есть несохранённые правки. Уйти без сохранения?'
          : `В карточках (${cards.size}) есть несохранённые правки. Уйти без сохранения?`,
      ),
    disabled: cards.size === 0,
    enableBeforeUnload: false,
  })

  return <UnsavedContext.Provider value={report}>{children}</UnsavedContext.Provider>
}

/** Карточка сообщает экрану, есть ли у неё несохранённые правки. Вне экрана — ничего не делает */
export function useReportUnsaved(unsaved: boolean) {
  const report = useContext(UnsavedContext)
  const card = useId()
  useEffect(() => {
    report?.(card, unsaved)
  }, [report, card, unsaved])
  // Карточка ушла с экрана — её правки больше не держат уход
  useEffect(() => () => report?.(card, false), [report, card])
}
