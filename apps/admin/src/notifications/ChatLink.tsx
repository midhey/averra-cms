import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { messageOf } from '../errors'
import { queryKeys } from '../queries'
import { Button, buttonClassName, Spinner } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { InlineAlert } from '../ui/InlineAlert'
import styles from './Notifications.module.scss'
import { linkExpiryLabel, recipientName } from './notifications-format'

/** Код привязки так, как его отдаёт API: показывается один раз */
export type LinkCode = {
  id: string
  code: string
  expiresAt: string
  links: { chat: string; group: string }
}

/** Что стало с кодом: ждём «Старт», чат привязан или код истёк */
export type LinkState = {
  status: 'waiting' | 'bound' | 'expired'
  recipient: { channel: string; address: string; label: string | null } | null
  /** Почему опрос Telegram сейчас не идёт (webhook у бота, нет сети): «Старт» не дойдёт */
  problem: string | null
}

/** Как часто спрашивать API, привязан ли чат: человек жмёт «Старт» за секунды */
const POLL_MS = 2000

/**
 * «Привязать чат Telegram»: одноразовый код и ссылки на бота (личный чат и группа). Пока код жив,
 * экран спрашивает API, привязан ли чат, и сообщает, когда это случилось. Chat id руками
 * не вводится: бот сам узнаёт чат по коду
 */
export function ChatLink({
  audience,
  create,
  state,
  onBound,
  disabled,
}: {
  /** Ключ кеша: сайт или служебные (null) */
  audience: string | null
  create: () => Promise<LinkCode>
  state: (id: string) => Promise<LinkState>
  onBound: () => void
  disabled?: boolean
}) {
  const [link, setLink] = useState<LinkCode>()
  const issue = useMutation({ mutationFn: create, onSuccess: setLink })
  const watching = useQuery({
    queryKey: queryKeys.linkState(audience, link?.id ?? ''),
    queryFn: () => state(link?.id ?? ''),
    enabled: link !== undefined,
    refetchInterval: (query) => (query.state.data?.status === 'waiting' ? POLL_MS : false),
  })
  const status = watching.data?.status

  useEffect(() => {
    if (status === 'bound') onBound()
  }, [status, onBound])

  return (
    <div className={styles.stack}>
      <div>
        <Button
          icon="plus"
          loading={issue.isPending}
          disabled={disabled}
          onClick={() => issue.mutate()}
        >
          {link ? 'Новая ссылка' : 'Привязать чат Telegram'}
        </Button>
      </div>
      {issue.isError && (
        <InlineAlert tone="danger">Ссылку не получить: {messageOf(issue.error)}</InlineAlert>
      )}
      {link && (
        <div className={styles.link}>
          <p>
            Откройте ссылку в Telegram и нажмите «Старт» — чат привяжется сам. Для рабочей группы —
            «Добавить в группу».
          </p>
          <div className={styles.linkActions}>
            <a
              className={buttonClassName({ variant: 'primary', size: 'small' })}
              href={link.links.chat}
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="external" />
              Открыть чат с ботом
            </a>
            <a
              className={buttonClassName({ size: 'small' })}
              href={link.links.group}
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="external" />
              Добавить в группу
            </a>
          </div>
          <p>
            Или отправьте боту сообщение <span className={styles.code}>/start {link.code}</span>.{' '}
            {linkExpiryLabel(link.expiresAt)}, сработает один раз.
          </p>
          {status === 'bound' && watching.data?.recipient ? (
            <InlineAlert tone="success" live>
              Чат «{recipientName(watching.data.recipient)}» привязан
            </InlineAlert>
          ) : status === 'expired' ? (
            <InlineAlert tone="warning" live>
              Код истёк или уже использован: получите новую ссылку
            </InlineAlert>
          ) : watching.data?.problem ? (
            <InlineAlert tone="warning" live>
              Бот сейчас не получает «Старт»: {watching.data.problem}
            </InlineAlert>
          ) : (
            <p className={styles.waiting} role="status">
              <Spinner />
              Ждём «Старт» в Telegram…
            </p>
          )}
        </div>
      )}
    </div>
  )
}
