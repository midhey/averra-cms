import { type SiteSettings, SiteSettingsPatch, type SiteSettingsPatchInput } from '@averra/schema'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import type { InferResponseType } from 'hono/client'
import { type FormEvent, useRef, useState } from 'react'
import { api } from '../api'
import { ApiRequestError, apiRequestError, messageOf } from '../errors'
import { type FieldErrors, issueFieldErrors, zodFieldErrors } from '../forms/field-errors'
import { useFormErrors } from '../forms/use-form-errors'
import { queryKeys, siteSettingsQuery } from '../queries'
import { fieldError, hasUnsavedChanges } from './seo-format'
import { useReportUnsaved } from './unsaved'

/** Настройки так, как их отдаёт API: сами настройки, адрес установки и адрес сайта */
export type SettingsView = InferResponseType<(typeof api.sites)[':siteId']['settings']['$get'], 200>

export type Notice = { kind: 'done' | 'error'; text: string }

/**
 * Фокус на первое поле формы с ошибкой — в порядке полей на экране. Имя поля — путь в настройках
 * (verification.yandex, redirects.2.to): так ошибки схемы и API ложатся на свои поля
 */
function focusFirstError(form: HTMLFormElement | null, errors: FieldErrors) {
  if (!form) return
  for (const element of Array.from(form.elements)) {
    const name = element.getAttribute('name')
    if (name && fieldError(errors, name) !== undefined && element instanceof HTMLElement) {
      element.focus()
      return
    }
  }
}

type SettingsFormOptions = {
  siteId: string
  /** Что сохраняет карточка: свои поля настроек */
  patch: SiteSettingsPatchInput
  /** Текст после сохранения: «Основное сохранено» */
  done: string
  /** Сохранено: карточка берёт значения из ответа (API приводит адреса к одному виду) */
  onSaved: (settings: SiteSettings) => void
}

/**
 * Форма одной карточки раздела «SEO»: проверка той же схемой, что у API (SiteSettingsPatch),
 * сохранение только своих полей (PATCH), ошибки у полей и итог. Сохранение пересобирает сайт —
 * экран сборки и обзор узнают о новой сборке, панель — о новом названии
 */
export function useSettingsForm({ siteId, patch, done, onSaved }: SettingsFormOptions) {
  const queryClient = useQueryClient()
  const formRef = useRef<HTMLFormElement>(null)
  const [notice, setNotice] = useState<Notice>()
  const parsed = SiteSettingsPatch.safeParse(patch)
  const form = useFormErrors(zodFieldErrors(parsed.error))
  // Сохранённое — из того же запроса, что у экрана: после сохранения его заменяет ответ API
  const { data: view } = useSuspenseQuery(siteSettingsQuery(siteId))
  const unsaved = hasUnsavedChanges(patch, view.settings)
  useReportUnsaved(unsaved)

  const save = useMutation({
    mutationFn: async (body: SiteSettingsPatch) => {
      const res = await api.sites[':siteId'].settings.$patch({ param: { siteId }, json: body })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
    onSuccess: async (view) => {
      queryClient.setQueryData(queryKeys.siteSettings(siteId), view)
      form.reset()
      onSaved(view.settings)
      setNotice({ kind: 'done', text: done })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.site(siteId), exact: true }),
        queryClient.invalidateQueries({ queryKey: queryKeys.currentSite }),
        queryClient.invalidateQueries({ queryKey: queryKeys.build(siteId) }),
      ])
    },
    onError: (error) => {
      if (error instanceof ApiRequestError && error.issues.length > 0) {
        const errors = issueFieldErrors(error.issues)
        form.showServerErrors(errors)
        setNotice({ kind: 'error', text: error.message })
        // Ошибки отрисуются со следующим кадром — фокус после них
        requestAnimationFrame(() => focusFirstError(formRef.current, errors))
      } else {
        setNotice({ kind: 'error', text: `Не удалось сохранить: ${messageOf(error)}` })
      }
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    form.attempt()
    setNotice(undefined)
    if (!parsed.success) {
      focusFirstError(formRef.current, zodFieldErrors(parsed.error))
      return
    }
    save.mutate(parsed.data)
  }

  return {
    formRef,
    errors: form.errors,
    /** Ошибка поля по имени: своя или у его частей */
    error: (name: string) => fieldError(form.errors, name),
    /** Поле поправили — ошибка от API у него уходит */
    clear: form.clearServerError,
    submit,
    notice,
    pending: save.isPending,
    /** Есть правки, которых нет на сервере */
    unsaved,
  }
}

export type SettingsForm = ReturnType<typeof useSettingsForm>
