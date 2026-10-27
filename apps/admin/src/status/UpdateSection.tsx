import type { InstallationStatus } from '@averra/schema'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { api } from '../api'
import { apiRequestError } from '../errors'
import { RelativeTime } from '../pages/PagesTable'
import { formatDateTime } from '../pages-format'
import { queryKeys } from '../queries'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { InlineAlert } from '../ui/InlineAlert'
import { mutedClassName, Section } from '../ui/Screen'
import { Steps } from '../ui/Steps'
import styles from './UpdateSection.module.scss'
import { checkTurnedOff, UNAVAILABLE_TEXT, updateView } from './update-format'

type UpdateSectionProps = {
  status: InstallationStatus
  now: Date
  /**
   * Версия этой сборки админки (или, в разработке, API на момент открытия экрана): другая после
   * обновления — админка на сервере уже новая, страницу стоит обновить
   */
  loadedVersion: string
  /** Последний опрос не удался: во время обновления это API перезапускается, а не ошибка */
  offline: boolean
}

/**
 * Раздел «Обновление» в «Состоянии установки»: установленная и доступная версии, заметки к
 * релизу, кнопка «Обновить до X» с подтверждением, ход по шагам и итог. Обновляет хост (averra.sh):
 * админка только отправляет заявку и опрашивает состояние — экран (InstallationScreen) делает это
 * сам, пока идёт обновление
 */
export function UpdateSection({ status, now, loadedVersion, offline }: UpdateSectionProps) {
  const view = updateView(status, now)
  const { release } = status
  const [confirming, setConfirming] = useState<string | null>(null)
  const notesId = useId()
  const queryClient = useQueryClient()
  const request = useMutation({
    mutationFn: async (version: string) => {
      const res = await api.status.update.$post({ json: { version } })
      if (res.status !== 202) throw await apiRequestError(res)
      return res.json()
    },
    onSuccess: async () => {
      setConfirming(null)
      await queryClient.invalidateQueries({ queryKey: queryKeys.status })
    },
  })

  const latest = release.latest
  const check = release.check
  const updating = view.activity !== 'idle'

  return (
    <Section title="Обновление" card>
      <p className={styles.versions}>
        Установлена <span className={styles.version}>{status.version}</span>
        {view.canUpdate ? (
          <>
            {' · '}доступна <span className={styles.version}>{view.canUpdate}</span>
          </>
        ) : release.mode !== 'no-host' && latest && !release.available && check ? (
          ' · это последняя версия'
        ) : null}
      </p>

      {release.mode !== 'ready' && (
        <p className={mutedClassName}>{UNAVAILABLE_TEXT[release.mode]}</p>
      )}

      {check && checkTurnedOff(check) && (
        <p className={mutedClassName}>
          Проверка новых версий выключена на сервере (UPDATE_SOURCE=off): о новых версиях скажет
          студия.
        </p>
      )}

      {check && !checkTurnedOff(check) && (
        <p className={mutedClassName}>
          {check.ok ? (
            <>
              Последняя проверка новых версий — <RelativeTime iso={check.checkedAt} />.
            </>
          ) : (
            <>
              Не удалось проверить новые версии <RelativeTime iso={check.checkedAt} />:{' '}
              {check.error ?? 'причина не записана'}.{latest && ' Ниже — что сервер нашёл раньше.'}
            </>
          )}{' '}
          Сервер проверяет раз в сутки.
        </p>
      )}

      {updating && (
        <InlineAlert
          tone="info"
          live
          title={
            view.activity === 'running'
              ? `Идёт обновление до ${view.target ?? 'новой версии'}`
              : `Заявка на обновление до ${view.target ?? 'новой версии'} отправлена`
          }
        >
          {offline
            ? 'Админка ждёт, пока API перезапустится: так и должно быть посреди обновления. Страницу можно не закрывать — она покажет итог сама.'
            : view.activity === 'running'
              ? 'Админка и приём заявок недоступны минуту-две, сайт для посетителей открыт (кроме нескольких секунд перезапуска). Страницу можно не закрывать — она покажет итог сама.'
              : view.activity === 'queued'
                ? 'Сервер заберёт её в течение минуты, сделает бэкап и обновит установку.'
                : 'Сервер принял заявку и запускает обновление.'}
        </InlineAlert>
      )}

      {view.outcome && (
        <InlineAlert
          tone={view.outcome.tone}
          live
          title={view.outcome.title}
          action={
            status.update?.result === 'updated' && status.version !== loadedVersion ? (
              <Button variant="primary" size="small" onClick={() => window.location.reload()}>
                Обновить страницу
              </Button>
            ) : undefined
          }
        >
          {view.outcome.text}
          {status.update?.result === 'updated' && status.version !== loadedVersion
            ? ' Админка тоже обновилась — обновите страницу, чтобы открыть её новую версию.'
            : ''}
        </InlineAlert>
      )}

      {view.rejected && (
        <InlineAlert tone="warning" title="Сервер отклонил заявку на обновление">
          {view.rejected}. Версия прежняя, ничего не менялось.
        </InlineAlert>
      )}

      {view.stale && (
        <InlineAlert tone="warning" title="Заявка не дошла до сервера">
          {view.stale}
        </InlineAlert>
      )}

      {view.blocked && (
        <InlineAlert tone="warning" title="Обновление из админки недоступно">
          {view.blocked}
        </InlineAlert>
      )}

      {view.steps && <Steps label="Шаги обновления" items={view.steps} />}

      {latest && release.available && (
        <div className={styles.notes}>
          <h3 id={notesId} className={styles.notesTitle}>
            Что нового в {latest.version}
            {latest.publishedAt && (
              <span className={styles.published}> · {formatDateTime(latest.publishedAt)}</span>
            )}
          </h3>
          {/* Заметки — простой текст с сервера: React выводит его как текст, не как HTML */}
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: прокручиваемую область листают с клавиатуры */}
          <section className={styles.notesText} aria-labelledby={notesId} tabIndex={0}>
            {latest.notes || 'Заметок к релизу нет.'}
          </section>
        </div>
      )}

      {view.canUpdate && (
        <div className={styles.actions}>
          <Button variant="primary" icon="download" onClick={() => setConfirming(view.canUpdate)}>
            Обновить до {view.canUpdate}
          </Button>
        </div>
      )}

      <Dialog
        open={confirming !== null}
        onClose={() => {
          setConfirming(null)
          request.reset()
        }}
        title={`Обновить до ${confirming ?? ''}?`}
        description={
          <ul className={styles.consequences}>
            <li>
              Сервер скачает новую версию, затем сделает бэкап базы и медиатеки и проверит его.
            </li>
            <li>
              Админка и приём заявок будут недоступны минуту-две. Сайт для посетителей открыт, кроме
              нескольких секунд перезапуска.
            </li>
            <li>
              Если новая версия не встанет, сервер сам вернёт прежнюю ({status.version}) — с базой
              из бэкапа, если понадобится.
            </li>
          </ul>
        }
        footer={
          <>
            <Button
              onClick={() => {
                setConfirming(null)
                request.reset()
              }}
            >
              Отмена
            </Button>
            <Button
              variant="primary"
              loading={request.isPending}
              onClick={() => confirming && request.mutate(confirming)}
            >
              Обновить до {confirming}
            </Button>
          </>
        }
      >
        {request.isError && (
          <InlineAlert tone="danger">Заявка не отправлена: {request.error.message}</InlineAlert>
        )}
      </Dialog>
    </Section>
  )
}
