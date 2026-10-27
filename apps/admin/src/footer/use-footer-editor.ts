import { Footer, sameFooter } from '@averra/schema'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { api } from '../api'
import { ApiRequestError, apiRequestError, messageOf } from '../errors'
import { issueFieldErrors, zodFieldErrors } from '../forms/field-errors'
import { useFormErrors } from '../forms/use-form-errors'
import { queryKeys } from '../queries'
import { useReportUnsaved } from '../seo/unsaved'

type Notice = { kind: 'done' | 'error'; text: string }

type Options = {
  siteId: string
  /** Черновик подвала с сервера */
  draft: Footer
  /** Итог действия — в общую строку под кнопками экрана */
  onNotice: (notice: Notice | undefined) => void
  /** Ошибка у поля: открыть вкладку «Подвал» и перевести фокус на поле */
  onFieldError: (name: string) => void
}

/**
 * Форма подвала на экране «Шапка и подвал»: правки, сохранение черновика, публикация и «Убрать с
 * сайта». У подвала своя публикация — отдельная от шапки, как и на сервере
 */
export function useFooterEditor({ siteId, draft, onNotice, onFieldError }: Options) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<Footer>(draft)
  // Черновик сменился на сервере (сохранили в другой вкладке): форма без правок берёт новый
  const [base, setBase] = useState(draft)
  if (!sameFooter(base, draft)) {
    setBase(draft)
    const current = Footer.safeParse(form)
    if (current.success && sameFooter(current.data, base)) setForm(draft)
  }
  const parsed = Footer.safeParse(form)
  const errors = useFormErrors(zodFieldErrors(parsed.error))
  const unsaved = !parsed.success || !sameFooter(parsed.data, draft)
  useReportUnsaved(unsaved)
  // Пока текст недописан, предпросмотр показывает последний целый подвал
  const shown = useRef(draft)
  if (parsed.success) shown.current = parsed.data

  const updateCache = (state: object) =>
    queryClient.setQueryData(queryKeys.footer(siteId), (current) =>
      current ? { ...current, ...state } : current,
    )

  const save = useMutation({
    mutationFn: async (body: Footer) => {
      const res = await api.sites[':siteId'].footer.$put({ param: { siteId }, json: body })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })
  const publish = useMutation({
    mutationFn: async () => {
      const res = await api.sites[':siteId'].footer.publish.$post({ param: { siteId } })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })
  const takeDown = useMutation({
    mutationFn: async () => {
      const res = await api.sites[':siteId'].footer.$delete({ param: { siteId } })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })

  const showError = (error: unknown, action: string) => {
    if (error instanceof ApiRequestError && error.issues.length > 0) {
      const fieldErrors = issueFieldErrors(error.issues)
      errors.showServerErrors(fieldErrors)
      const first = Object.keys(fieldErrors)[0]
      if (first) onFieldError(first)
    }
    onNotice({ kind: 'error', text: `${action}: ${messageOf(error)}` })
  }

  async function saveDraft() {
    if (!parsed.success) {
      errors.attempt()
      onNotice({ kind: 'error', text: 'Подвал не сохранить: поправьте отмеченные поля' })
      const first = Object.keys(zodFieldErrors(parsed.error))[0]
      if (first) onFieldError(first)
      return false
    }
    try {
      const saved = await save.mutateAsync(parsed.data)
      updateCache(saved)
      setForm(saved.draft)
      errors.reset()
      return true
    } catch (error) {
      showError(error, 'Не удалось сохранить')
      return false
    }
  }

  return {
    form,
    errors: errors.errors,
    unsaved,
    shown: shown.current,
    pending: save.isPending || publish.isPending || takeDown.isPending,
    saving: save.isPending && !publish.isPending,
    publishing: publish.isPending,
    takingDown: takeDown.isPending,

    change(next: Footer, field?: string) {
      setForm(next)
      onNotice(undefined)
      if (field) errors.clearServerError(field)
    },

    async save() {
      onNotice(undefined)
      if (await saveDraft()) {
        onNotice({
          kind: 'done',
          text: 'Подвал сохранён. На сайте он появится после публикации',
        })
      }
    },

    async publish() {
      onNotice(undefined)
      if (unsaved && !(await saveDraft())) return
      try {
        const published = await publish.mutateAsync()
        updateCache(published)
        setForm(published.draft)
        onNotice({
          kind: 'done',
          text: 'Подвал опубликован. Сайт пересобирается — через минуту он будет на всех страницах',
        })
        await queryClient.invalidateQueries({ queryKey: queryKeys.build(siteId) })
      } catch (error) {
        showError(error, 'Не удалось опубликовать')
      }
    },

    /** Убрать подвал с сайта: внизу страниц снова только ссылки на документы */
    async takeDown() {
      if (
        !window.confirm(
          'Убрать подвал со всех страниц сайта? Внизу останутся ссылки на документы, настройки — черновиком.',
        )
      ) {
        return
      }
      onNotice(undefined)
      try {
        updateCache(await takeDown.mutateAsync())
        onNotice({ kind: 'done', text: 'Подвал убрали с сайта. Сайт пересобирается' })
        await queryClient.invalidateQueries({ queryKey: queryKeys.build(siteId) })
      } catch (error) {
        showError(error, 'Не удалось убрать подвал')
      }
    },
  }
}

export type FooterEditor = ReturnType<typeof useFooterEditor>
