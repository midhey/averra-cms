import type { ReactNode } from 'react'
import { Button } from '../ui/Button'
import { InlineAlert } from '../ui/InlineAlert'
import { FormActions, formClassName, Section } from '../ui/Screen'
import { StatusPill } from '../ui/StatusPill'
import type { SettingsForm } from './use-settings-form'

type SettingsCardProps = {
  id: string
  title: string
  description?: ReactNode
  form: SettingsForm
  /** Подпись кнопки: «Сохранить основное» */
  saveLabel?: string
  children: ReactNode
}

/**
 * Карточка раздела «SEO»: заголовок (по нему её находит диктор), форма своих полей, «Сохранить»
 * и итог. Ошибка сохранения — над кнопкой, «Сохранено» — под ней, там, куда смотрит человек
 */
export function SettingsCard({
  id,
  title,
  description,
  form,
  saveLabel = 'Сохранить',
  children,
}: SettingsCardProps) {
  return (
    <Section id={id} title={title} description={description} card>
      <form
        ref={form.formRef}
        aria-label={title}
        className={formClassName}
        onSubmit={form.submit}
        onKeyDown={form.onKeyDown}
        noValidate
      >
        {children}
        {form.notice?.kind === 'error' && (
          <InlineAlert tone="danger">{form.notice.text}</InlineAlert>
        )}
        {form.singleSave ? (
          // Кнопка одна на экран — в полосе внизу. У карточки остаётся пометка, что в ней правки
          form.unsaved && (
            <FormActions>
              <StatusPill tone="warning" appearance="dot">
                Не сохранено
              </StatusPill>
            </FormActions>
          )
        ) : (
          <SettingsCardActions
            saveLabel={saveLabel}
            pending={form.pending}
            unsaved={form.unsaved}
          />
        )}
        {form.notice?.kind === 'done' && (
          <InlineAlert tone="success" live>
            {form.notice.text}
          </InlineAlert>
        )}
      </form>
    </Section>
  )
}

/**
 * «Сохранить» карточки и пометка, что в ней есть несохранённые правки: у раздела много карточек,
 * и без пометки легко сохранить одну и забыть другую. Пометка — текстом, не только цветом
 */
export function SettingsCardActions({
  saveLabel,
  pending,
  unsaved,
}: {
  saveLabel: string
  pending: boolean
  unsaved: boolean
}) {
  return (
    <FormActions>
      {/* Без правок сохранять нечего: кнопка выключена, как в редакторе страницы. aria-disabled,
          а не disabled: после «Сохранить» кнопка гаснет, и фокус с клавиатуры не должен пропасть */}
      <Button
        type="submit"
        variant="primary"
        loading={pending}
        aria-disabled={!unsaved ? true : undefined}
      >
        {saveLabel}
      </Button>
      {unsaved && !pending && (
        <StatusPill tone="warning" appearance="dot">
          Не сохранено
        </StatusPill>
      )}
    </FormActions>
  )
}
