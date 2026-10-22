import {
  CurrentPassword,
  TelegramBotToken,
  TelegramChannelDetails,
  TelegramProxy,
} from '@averra/schema'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { api } from '../api'
import { ApiRequestError, apiRequestError, messageOf } from '../errors'
import { type FieldErrors, issueFieldErrors } from '../forms/field-errors'
import { focusField } from '../forms/use-form-errors'
import { notificationsQuery, queryKeys } from '../queries'
import { Button } from '../ui/Button'
import { Checkbox, TextInput } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { InlineAlert } from '../ui/InlineAlert'
import { Facts, FormActions, formClassName, mutedClassName, Section } from '../ui/Screen'
import { StatusPill } from '../ui/StatusPill'
import styles from './Notifications.module.scss'
import { checkStepLabel } from './notifications-format'

type Notice = { kind: 'error'; text: string }
type Channel = ReturnType<typeof useChannels>['channels'][number]

function useChannels() {
  return useSuspenseQuery(notificationsQuery()).data
}

/** Канал словами: работает, выключен или не настроен — точкой и текстом, не только цветом */
function ChannelState({ channel }: { channel: Channel }) {
  return (
    <StatusPill
      tone={channel.ready ? 'success' : channel.enabled ? 'warning' : 'neutral'}
      appearance="dot"
    >
      {channel.ready ? 'работает' : channel.enabled ? 'не работает' : 'выключен'}
    </StatusPill>
  )
}

/**
 * Каналы уведомлений — только владельцу: почта (поверх почты установки), Telegram (бот, прокси)
 * и любой следующий канал API. Включить или выключить канал целиком, проверить кнопкой «Проверить».
 * Канал без своей карточки получает общую: состояние, переключатель и проверку
 */
export function ChannelsSection() {
  const { channels, telegramLock } = useChannels()
  return (
    <Section
      title="Каналы"
      description="Куда вообще можно слать уведомления. Получатели — в разделах ниже."
      card
    >
      {channels.map((channel) =>
        channel.kind === 'telegram' ? (
          <TelegramChannel key={channel.kind} channel={channel} lock={telegramLock} />
        ) : (
          <ChannelCard key={channel.kind} channel={channel} />
        ),
      )}
    </Section>
  )
}

/** Включить или выключить канал: без пароля — выключение ничего не открывает */
function ChannelToggle({ channel }: { channel: Channel }) {
  const queryClient = useQueryClient()
  const toggle = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await api.notifications.channels[':kind'].$put({
        param: { kind: channel.kind },
        json: { enabled },
      })
      if (res.status !== 200) throw await apiRequestError(res)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications }),
  })
  return (
    <>
      <Checkbox
        name={`${channel.kind}-enabled`}
        checked={toggle.isPending ? toggle.variables : channel.enabled}
        disabled={toggle.isPending}
        onChange={(event) => toggle.mutate(event.target.checked)}
        label={channelToggleLabels[channel.kind] ?? `Отправлять уведомления: ${channel.title}`}
      />
      {toggle.isError && (
        <InlineAlert tone="danger">Не удалось переключить: {messageOf(toggle.error)}</InlineAlert>
      )}
    </>
  )
}

const channelToggleLabels: Record<string, string> = {
  email: 'Отправлять уведомления почтой',
  telegram: 'Отправлять уведомления в Telegram',
}

/**
 * «Проверить» у канала: как проверять, решает его адаптер в API (почта — письмо себе через
 * очередь, Telegram — подключение и сообщение в каждый чат). Итог — по шагам
 */
function ChannelCheck({ channel, disabled }: { channel: Channel; disabled?: boolean }) {
  const check = useMutation({
    mutationFn: async () => {
      const res = await api.notifications.channels[':kind'].check.$post({
        param: { kind: channel.kind },
      })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
  })
  return (
    <>
      <FormActions>
        <Button loading={check.isPending} disabled={disabled} onClick={() => check.mutate()}>
          Проверить
        </Button>
      </FormActions>
      {check.isSuccess && (
        <ol className={styles.steps} aria-label={`Шаги проверки: ${channel.title}`}>
          {check.data.steps.map((step, index) => (
            // Шаги не переставляются: ключ по месту
            <li key={index} className={step.ok ? styles.stepOk : styles.stepFailed}>
              <Icon name={step.ok ? 'check' : 'close'} className={styles.stepIcon} />
              <span>
                <span className="visually-hidden">{checkStepLabel(step)}</span>{' '}
                <strong>{step.step}</strong>: {step.message}
              </span>
            </li>
          ))}
        </ol>
      )}
      {check.isError && <InlineAlert tone="danger">{messageOf(check.error)}</InlineAlert>}
    </>
  )
}

/** Почему канал не работает и ждут ли его сообщения слишком долго */
function ChannelProblems({
  channel,
  configured = true,
}: {
  channel: Channel
  configured?: boolean
}) {
  return (
    <>
      {channel.reason && configured && channel.enabled && (
        <InlineAlert tone="warning">{channel.reason}</InlineAlert>
      )}
      {channel.warning && (
        <InlineAlert tone="warning">
          Сообщения не уходят — {channel.warning}. Попытки они не тратят и уйдут, когда канал
          заработает.
        </InlineAlert>
      )}
    </>
  )
}

/** Описание канала без своей карточки: свои слова пока есть только у почты */
const channelHints: Record<string, ReactNode> = {
  email: (
    <>
      Письма уходят через почту установки, с её повторами и очередью —{' '}
      <Link to="/mail">раздел «Почта»</Link>. «Почта не работает» по почте не приходит: для него
      нужен Telegram.
    </>
  ),
}

/** Карточка канала без своих настроек: почта и любой новый канал API */
function ChannelCard({ channel }: { channel: Channel }) {
  const headingId = useId()
  const hint = channelHints[channel.kind]
  return (
    <section className={styles.channel} aria-labelledby={headingId}>
      <div className={styles.channelHead}>
        <h3 id={headingId} className={styles.channelTitle}>
          {channel.title}
        </h3>
        <ChannelState channel={channel} />
      </div>
      {hint && <p className={mutedClassName}>{hint}</p>}
      <ChannelProblems channel={channel} />
      <ChannelToggle channel={channel} />
      <ChannelCheck channel={channel} disabled={!channel.ready} />
    </section>
  )
}

function TelegramChannel({ channel, lock }: { channel: Channel; lock: string | null }) {
  const headingId = useId()
  const queryClient = useQueryClient()
  // Что Telegram рассказывает о себе (describe в API): бот, прокси без пароля, есть ли токен
  const parsed = TelegramChannelDetails.safeParse(channel.details)
  const details = parsed.success ? parsed.data : undefined
  const configured = details?.token !== null && details?.token !== undefined
  // Итог сохранения живёт здесь: форма после него собирается заново (key) и своё бы забыла
  const [saved, setSaved] = useState<string>()
  const savedRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (saved) savedRef.current?.focus()
  }, [saved])

  return (
    <section className={styles.channel} aria-labelledby={headingId}>
      <div className={styles.channelHead}>
        <h3 id={headingId} className={styles.channelTitle}>
          {channel.title}
        </h3>
        <ChannelState channel={channel} />
      </div>
      {details?.bot ? (
        <Facts
          label="Бот Telegram"
          items={[
            ['Бот', `@${details.bot.username} (${details.bot.name})`],
            ['Прокси', details.proxy ?? 'нет, напрямую'],
            ['Токен', details.token === 'set' ? 'задан' : 'не расшифровывается — введите заново'],
          ]}
        />
      ) : (
        <p className={mutedClassName}>
          Бот не подключён. Создайте его у @BotFather в Telegram и вставьте токен ниже — инструкция
          в документации: «Установка → Telegram-бот».
        </p>
      )}
      <ChannelProblems channel={channel} configured={configured} />
      {configured && <ChannelToggle channel={channel} />}
      {configured && <ChannelCheck channel={channel} />}
      {lock ? (
        <InlineAlert tone="info">{lock}</InlineAlert>
      ) : (
        <TelegramForm
          key={`${details?.bot?.username ?? 'none'}-${details?.proxy ?? ''}`}
          configured={configured}
          proxy={details?.proxy ?? ''}
          onStart={() => setSaved(undefined)}
          onSaved={async (text) => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.notifications })
            setSaved(text)
          }}
        />
      )}
      {saved && (
        <p ref={savedRef} tabIndex={-1} role="status" className={styles.notice}>
          {saved}
        </p>
      )}
    </section>
  )
}

const fieldOrder = ['token', 'proxy', 'currentPassword']

/**
 * Токен бота и прокси. Токен — только на запись: API его не отдаёт, после сохранения поле пустое,
 * рядом — «задан». Сохранить и удалить — с паролем владельца, как SMTP: через бота уходят заявки
 */
function TelegramForm({
  configured,
  proxy: savedProxy,
  onStart,
  onSaved,
}: {
  configured: boolean
  proxy: string
  /** Человек начал новое действие: прежнее «сохранено» больше не про него */
  onStart: () => void
  onSaved: (notice: string) => Promise<unknown>
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const legendId = useId()
  const [token, setToken] = useState('')
  // Прокси с паролем API не отдаёт: поле пустое, сохранённый (без пароля) — в подсказке
  const [proxy, setProxy] = useState('')
  const [keepProxy, setKeepProxy] = useState(savedProxy !== '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [notice, setNotice] = useState<Notice>()

  function localErrors(): FieldErrors {
    const found: Record<string, string> = {}
    if (!configured || token !== '') {
      const parsed = TelegramBotToken.safeParse(token)
      if (!parsed.success) found.token = parsed.error.issues[0]?.message ?? 'Нужен токен'
    }
    if (!keepProxy && proxy !== '') {
      const parsed = TelegramProxy.safeParse(proxy)
      if (!parsed.success) found.proxy = parsed.error.issues[0]?.message ?? 'Нужен адрес прокси'
    }
    const password = CurrentPassword.safeParse(currentPassword)
    if (!password.success) {
      found.currentPassword = password.error.issues[0]?.message ?? 'Введите пароль'
    }
    return found
  }

  function showError(error: unknown) {
    if (error instanceof ApiRequestError && error.issues.length > 0) {
      const fieldErrors = issueFieldErrors(error.issues)
      setErrors(fieldErrors)
      focusField(
        formRef.current,
        fieldOrder.find((name) => fieldErrors[name]),
      )
      return
    }
    setNotice({ kind: 'error', text: messageOf(error) })
  }

  const save = useMutation({
    mutationFn: async () => {
      const res = await api.notifications.telegram.$put({
        json: {
          token: token.trim(),
          // Прокси с паролем знает только API: «оставить» — не присылать поле вовсе
          ...(keepProxy ? {} : { proxy: proxy.trim() }),
          currentPassword,
        },
      })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
    onSuccess: async (result) => {
      setToken('')
      setCurrentPassword('')
      await onSaved(
        result.dropped > 0
          ? `Бот сохранён. Чаты прежнего бота отвязаны (${result.dropped}): привяжите их заново`
          : 'Бот сохранён',
      )
    },
    onError: showError,
  })

  const remove = useMutation({
    mutationFn: async () => {
      const res = await api.notifications.telegram.$delete({ json: { currentPassword } })
      if (res.status !== 200) throw await apiRequestError(res)
      return res.json()
    },
    onSuccess: async () => {
      setCurrentPassword('')
      await onSaved('Бот удалён, чаты отвязаны')
    },
    onError: showError,
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onStart()
    setNotice(undefined)
    const found = localErrors()
    setErrors(found)
    const first = fieldOrder.find((name) => found[name])
    if (first) {
      focusField(formRef.current, first)
      return
    }
    save.mutate()
  }

  function runRemove() {
    onStart()
    setNotice(undefined)
    const password = CurrentPassword.safeParse(currentPassword)
    if (!password.success) {
      setErrors({ currentPassword: password.error.issues[0]?.message ?? 'Введите пароль' })
      focusField(formRef.current, 'currentPassword')
      return
    }
    if (
      !window.confirm('Удалить бота? Все чаты отвяжутся, уведомления в Telegram перестанут уходить')
    ) {
      return
    }
    remove.mutate()
  }

  const busy = save.isPending || remove.isPending

  return (
    <form
      ref={formRef}
      aria-labelledby={legendId}
      className={styles.group}
      onSubmit={submit}
      noValidate
    >
      <h4 id={legendId} className={styles.legend}>
        {configured ? 'Сменить бота или прокси' : 'Подключить бота'}
      </h4>
      <div className={formClassName}>
        <TextInput
          label="Токен бота"
          name="token"
          type="password"
          autoComplete="off"
          mono
          value={token}
          onChange={(event) => {
            setToken(event.target.value)
            setErrors((current) => ({ ...current, token: undefined }))
          }}
          error={errors.token}
          hint={
            configured
              ? 'Токен задан и не показывается. Пусто — оставить прежний'
              : 'Выдаёт @BotFather: «123456789:AA…». Хранится зашифрованным и не показывается'
          }
        />
        {savedProxy !== '' && (
          <Checkbox
            name="keepProxy"
            checked={keepProxy}
            onChange={(event) => setKeepProxy(event.target.checked)}
            label={`Оставить прокси ${savedProxy}`}
          />
        )}
        {(savedProxy === '' || !keepProxy) && (
          <TextInput
            label="Прокси (необязательно)"
            name="proxy"
            mono
            autoComplete="off"
            value={proxy}
            onChange={(event) => {
              setProxy(event.target.value)
              setErrors((current) => ({ ...current, proxy: undefined }))
            }}
            error={errors.proxy}
            hint="С российских VPS Telegram часто недоступен напрямую: socks5://логин:пароль@host:1080 или http://host:3128. Спецсимволы в логине и пароле — %-кодами: # → %23, ? → %3F, @ → %40. Пусто — напрямую"
          />
        )}
        <TextInput
          label="Ваш пароль от админки"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => {
            setCurrentPassword(event.target.value)
            setErrors((current) => ({ ...current, currentPassword: undefined }))
          }}
          error={errors.currentPassword}
          hint="Бота меняют только с паролем: через него уходят заявки с персональными данными"
        />
      </div>
      {notice?.kind === 'error' && <InlineAlert tone="danger">{notice.text}</InlineAlert>}
      <FormActions>
        <Button
          type="submit"
          variant="primary"
          loading={save.isPending}
          disabled={busy && !save.isPending}
        >
          {configured ? 'Сохранить' : 'Подключить бота'}
        </Button>
        {configured && (
          <Button
            variant="danger"
            icon="trash"
            loading={remove.isPending}
            disabled={busy && !remove.isPending}
            onClick={runRemove}
          >
            Удалить бота
          </Button>
        )}
      </FormActions>
    </form>
  )
}
