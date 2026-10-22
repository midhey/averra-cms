import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { messageOf } from '../errors'
import { ChannelsSection } from '../notifications/ChannelsSection'
import { LeadRecipientsSection } from '../notifications/LeadRecipientsSection'
import styles from '../notifications/Notifications.module.scss'
import { outboxStatusLabel } from '../notifications/notifications-format'
import { ServiceRecipientsSection } from '../notifications/ServiceRecipientsSection'
import { formatDateTime } from '../pages-format'
import { canManageChannels, canSeeNotifications } from '../permissions'
import { notificationOutboxQuery, siteQuery } from '../queries'
import { Button } from '../ui/Button'
import { InlineAlert } from '../ui/InlineAlert'
import { PageHeader } from '../ui/PageHeader'
import { mutedClassName, Screen, Section } from '../ui/Screen'
import { StatusPill, type StatusTone } from '../ui/StatusPill'
import { usePageTitle } from '../ui/use-page-title'
import { useSiteId } from '../use-site'

/**
 * Уведомления: каналы и служебные события — владельцу, получатели заявок — владельцу и клиенту.
 * Что роль не может, не показываем — решает всё равно API (apps/api/src/auth/access.ts)
 */
export function NotificationsScreen() {
  const siteId = useSiteId()
  const { data: site } = useSuspenseQuery(siteQuery(siteId))
  usePageTitle('Уведомления', site.name)
  const owner = canManageChannels(site.access)

  return (
    <Screen narrow>
      <PageHeader eyebrow={site.name} title="Уведомления" />
      {owner && <ChannelsSection />}
      {canSeeNotifications(site.access) && <LeadRecipientsSection siteId={siteId} />}
      {owner && <ServiceRecipientsSection />}
      {owner && <RecentMessages />}
    </Screen>
  )
}

const tones: Record<string, StatusTone> = {
  pending: 'info',
  sending: 'info',
  sent: 'success',
  failed: 'danger',
}

/** Последние сообщения очереди Telegram: ушло ли и почему нет. Письма — на странице «Почта» */
function RecentMessages() {
  const messages = useQuery(notificationOutboxQuery())
  return (
    <Section
      title="Последние сообщения Telegram"
      description="Письма — на странице «Почта». Сообщение пробует уйти с растущей паузой, сбой сети или токена его попытки не тратит."
      actions={
        <Button
          size="small"
          icon="history"
          loading={messages.isFetching}
          onClick={() => void messages.refetch()}
        >
          Обновить
        </Button>
      }
      card
    >
      {messages.isError ? (
        <InlineAlert tone="danger">
          Сообщения не загрузились: {messageOf(messages.error)}
        </InlineAlert>
      ) : messages.data && messages.data.length > 0 ? (
        <ul className={styles.messages} aria-label="Последние сообщения Telegram">
          {messages.data.slice(0, 20).map((message) => (
            <li key={message.id} className={styles.recipient}>
              <span className={styles.recipientText}>
                <span className={styles.recipientName}>{message.title}</span>
                <span className={styles.recipientMeta}>
                  Чат {message.address} · {formatDateTime(message.createdAt)}
                </span>
                {message.lastError && message.status !== 'sent' && (
                  <span className={styles.error}>{message.lastError}</span>
                )}
              </span>
              <StatusPill tone={tones[message.status] ?? 'neutral'}>
                {outboxStatusLabel(message.status)}
              </StatusPill>
            </li>
          ))}
        </ul>
      ) : (
        <p className={mutedClassName}>{messages.isPending ? 'Загружаю…' : 'Сообщений пока нет.'}</p>
      )}
    </Section>
  )
}
