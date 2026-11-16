import type { PublicCheck } from '@averra/schema'
import { formatDateTime } from '../pages-format'
import { Facts, mutedClassName, Section } from '../ui/Screen'

export function PublicChecksSection({
  checks,
  enabled = true,
}: {
  checks: readonly PublicCheck[]
  enabled?: boolean | undefined
}) {
  return (
    <Section title="Доступность и сертификаты" card>
      {!enabled && (
        <p>Проверка выключена в разделе «Уведомления». Ниже — последние сохранённые результаты.</p>
      )}
      {checks.length === 0 ? (
        <p>Проверок ещё не было. В разработке и без публичных HTTPS-доменов проверка выключена.</p>
      ) : (
        checks.map((check) => (
          <Facts
            key={check.target}
            items={[
              [
                check.target === 'site' ? 'Сайт' : 'Админка',
                `${check.available ? 'отвечает' : check.failures < 2 ? 'не ответил, ждём повторной проверки' : 'не отвечает'}${check.status ? ` (HTTP ${check.status})` : ''}`,
              ],
              ['Последняя проверка', formatDateTime(check.checkedAt)],
              [
                'Сертификат',
                check.certificate.state === 'unknown'
                  ? 'не удалось проверить (сеть или TLS-соединение недоступны)'
                  : `${check.certificate.state === 'invalid' ? 'истёк или недействителен' : 'действителен'}${check.certificate.expiresAt ? `, срок до ${formatDateTime(check.certificate.expiresAt)}` : ''}`,
              ],
            ]}
          />
        ))
      )}
      <p className={mutedClassName}>
        Проверка публичных адресов — раз в 5 минут. Если сам API или сервер остановлен, уведомление
        не придёт: для этого нужен внешний мониторинг.
      </p>
    </Section>
  )
}
