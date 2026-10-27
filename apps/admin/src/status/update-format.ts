import {
  type AdminUpdateMode,
  type InstallationStatus,
  pendingStale,
  type ReleaseCheck,
  STATUS_LIMITS,
  type UpdateRun,
  type UpdateStep,
  updateActivity,
  updateBlock,
} from '@averra/schema'
import type { StepItem } from '../ui/Steps'

// Обновление из админки словами: что показать в разделе «Обновление» экрана «Состояние
// установки». Что можно и что идёт, решает схема (updateActivity) — здесь слова и шаги

/** Шаги в порядке averra.sh: образы качаются, пока API работает, потом бэкап и запуск */
export const UPDATE_STEPS: readonly { id: UpdateStep; label: string }[] = [
  { id: 'pull', label: 'Загрузка новой версии' },
  { id: 'backup', label: 'Бэкап базы и медиатеки' },
  { id: 'migrate', label: 'Запуск и миграции базы' },
  { id: 'verify', label: 'Проверка админки и сайта' },
]

/** Почему кнопки нет — словами для владельца */
export const UNAVAILABLE_TEXT: Record<Exclude<AdminUpdateMode, 'ready'>, string> = {
  'no-host':
    'Обновление из админки работает только на сервере, установленном install.sh. Здесь хостовой части нет — например, это разработка. Установку обновляет студия по SSH: averra.sh update --version <версия>.',
  disabled:
    'Обновление из админки выключено на сервере (ADMIN_UPDATE=off): установку обновляет студия.',
  'no-watcher':
    'На этом сервере заявки из админки некому забирать: нет systemd или служба заявок выключена. Установку обновляет студия по SSH; включить кнопку — averra.sh install-units на сервере.',
  'no-requests':
    'Сервер не готов принять заявку: у API нет папки заявок. Студии: запустить averra.sh install-units на сервере или обновить установку по SSH.',
}

/** Сколько после конца обновления показывать его шаги рядом с итогом */
const STEPS_AFTER_FINISH_MS = 60 * 60 * 1000

/**
 * Шаги обновления: пройденные, текущий, впереди; на чём не прошло. После непрошедшего — «не
 * начиналось»: обновление на нём кончилось. Нет обновления (заявка ещё ждёт сервер) — всё впереди
 */
export function updateSteps(run: UpdateRun | null): StepItem[] {
  const current = run?.step ?? null
  const index =
    current && current !== 'rollback' ? UPDATE_STEPS.findIndex((s) => s.id === current) : -1
  const result = run?.result ?? null
  const items: StepItem[] = UPDATE_STEPS.map((step, i) => {
    if (!run) return { id: step.id, label: step.label, state: 'pending' }
    if (result === 'updated') return { id: step.id, label: step.label, state: 'done' }
    // Откат: не прошёл шаг, записанный сервером (запуск и миграции или проверка), до него всё
    // пройдено, после — не начнётся. Прежний averra.sh шаг не пишет — тогда проверка
    if (current === 'rollback') {
      const failed = UPDATE_STEPS.findIndex((s) => s.id === (run.failedStep ?? 'verify'))
      return {
        id: step.id,
        label: step.label,
        state: i < failed ? 'done' : i === failed ? 'failed' : 'skipped',
      }
    }
    if (i < index) return { id: step.id, label: step.label, state: 'done' }
    if (i === index) {
      return {
        id: step.id,
        label: step.label,
        state: result === 'in-progress' ? 'current' : 'failed',
      }
    }
    return {
      id: step.id,
      label: step.label,
      state: result === 'in-progress' ? 'pending' : 'skipped',
    }
  })
  const rollback = current === 'rollback'
  const last: StepItem = rollback
    ? {
        id: 'finish',
        label: 'Откат на прежнюю версию',
        state:
          result === 'in-progress' ? 'current' : result === 'rollback-failed' ? 'failed' : 'done',
      }
    : {
        id: 'finish',
        label: 'Готово',
        state:
          result === 'updated'
            ? 'done'
            : result === null || result === 'in-progress'
              ? 'pending'
              : 'skipped',
      }
  return [...items, last]
}

export type UpdateOutcome = {
  tone: 'success' | 'warning' | 'danger'
  title: string
  text: string
}

/**
 * Итог последнего обновления для владельца: что случилось и что делать. retryExplained — рядом уже
 * сказано, почему кнопки на эту версию нет (updateBlock rolled-back): то же не повторять
 */
export function updateOutcome(run: UpdateRun, retryExplained = false): UpdateOutcome | null {
  const kept = run.keptDatabase
    ? ` Данные, принятые после бэкапа (заявки), сохранены в базе ${run.keptDatabase}: студия перенесёт нужное.`
    : ''
  switch (run.result) {
    case 'updated':
      return {
        tone: 'success',
        title: `Обновлено до ${run.to}`,
        text: 'Новая версия прошла проверку и работает. Бэкап перед обновлением сохранён на сервере.',
      }
    case 'rolled-back':
      return {
        tone: 'warning',
        title: `Обновление до ${run.to} не прошло — работает прежняя версия ${run.from}`,
        text:
          `Сервер сам вернул прежнюю версию${run.dbRestored ? ' и базу из бэкапа перед обновлением' : ''}: сайт и админка работают, данные на месте. ` +
          `Сообщите студии — причина в журнале обновления на сервере (update.log).${retryExplained ? '' : ' Повторить из админки можно будет со следующей версией, а эту студия поставит по SSH, когда устранит причину.'}${kept}`,
      }
    case 'rollback-failed':
      return {
        tone: 'danger',
        title: `Обновление до ${run.to} не прошло, и откат не удался`,
        text: `Нужен человек на сервере: сообщите студии. Что делать, сервер записал в журнал обновления (update.log)${run.error ? `; причина: ${run.error}` : ''}.${kept}`,
      }
    case 'failed':
      return {
        tone: 'warning',
        title: `Обновление до ${run.to} не началось`,
        text: `${run.error ? `${capitalize(run.error)}. ` : ''}Версия прежняя, ничего не менялось — можно повторить позже.`,
      }
    default:
      return null
  }
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/**
 * Проверка новых версий выключена на сервере (UPDATE_SOURCE=off): это не сбой, а настройка.
 * Причину пишет averra.sh (check_update) — фиксированной строкой с именем переменной
 */
export const checkTurnedOff = (check: ReleaseCheck) =>
  !check.ok && (check.error ?? '').includes('UPDATE_SOURCE=off')

/** Почему кнопки нет, хотя новая версия есть (updateBlock) — словами для владельца */
const BLOCK_TEXT = {
  breaking: (version: string) =>
    `Версия ${version} требует шага на сервере (смотрите заметки к релизу): её ставит студия по SSH. Сообщите студии, что хотите обновиться.`,
  'rollback-failed': () =>
    'Прошлое обновление закончилось неудачным откатом: пока студия не починит установку, обновлять из админки нельзя. Дальше студия обновит её по SSH.',
  'rolled-back': (version: string) =>
    `Обновление до ${version} уже не прошло и откатилось. Повторная попытка снова оставила бы админку без работы на минуту-две, поэтому из админки — со следующей версией, а эту студия поставит по SSH, когда устранит причину.`,
} as const

export type UpdateView = {
  activity: ReturnType<typeof updateActivity>
  /** К какой версии идёт обновление или заявка */
  target: string | null
  /** Показать шаги: идёт обновление или оно кончилось меньше часа назад */
  steps: StepItem[] | null
  /** Итог последнего обновления, если он свежий (неделя, как проблемы в состоянии) */
  outcome: UpdateOutcome | null
  /**
   * Сервер отклонил последнюю заявку (после последнего обновления) — почему, с большой буквы, и
   * менялась ли версия
   */
  rejected: string | null
  /** Прошлую заявку сервер не забрал за 10 минут: служба заявок, похоже, не работает */
  stale: string | null
  /** Новая версия есть, но обновлять из админки нельзя — почему (ломающий релиз, неудачный откат) */
  blocked: string | null
  /** Кнопка «Обновить до …»: версия, если обновлять можно сейчас */
  canUpdate: string | null
}

/** Всё о разделе «Обновление» из состояния установки */
export function updateView(status: InstallationStatus, now: Date): UpdateView {
  const { update, release } = status
  const activity = updateActivity({ update, release }, now)
  const finishedAt = update?.finishedAt ? Date.parse(update.finishedAt) : null
  const recent = finishedAt !== null && now.getTime() - finishedAt < STATUS_LIMITS.updateNoticeMs
  const fresh = finishedAt !== null && now.getTime() - finishedAt < STEPS_AFTER_FINISH_MS
  // Шаги обновления этой заявки; пока хост её не взял — все впереди
  const run = activity === 'queued' || activity === 'starting' ? null : update
  const target =
    activity === 'queued'
      ? (release.pending?.version ?? null)
      : activity === 'starting'
        ? (release.request?.version ?? null)
        : activity === 'running'
          ? (update?.to ?? null)
          : null
  const request = release.request
  const rejected =
    activity === 'idle' &&
    request?.result === 'rejected' &&
    (!update || Date.parse(request.at) > Date.parse(update.finishedAt ?? update.startedAt))
      ? `${capitalize(request.error ?? 'причина не записана')}.${
          // Перед отказом сервер мог довести прерванное прошлое обновление — тогда версия могла
          // смениться, и «ничего не менялось» было бы неправдой
          update &&
          Date.parse(update.finishedAt ?? update.startedAt) >
            Date.parse(request.requestedAt ?? request.at)
            ? ''
            : ' Версия прежняя, ничего не менялось.'
        }`
      : null
  const stale =
    activity === 'idle' && release.pending && pendingStale(release, now)
      ? `Сервер не забрал заявку на обновление до ${release.pending.version} за 10 минут: служба заявок на сервере, похоже, не работает. Сообщите студии (averra.sh install-units) — или отправьте заявку снова.`
      : null
  const block = updateBlock({ update, release })
  const blocked = !release.available
    ? null
    : block === 'breaking'
      ? BLOCK_TEXT.breaking(release.available)
      : block === 'rollback-failed'
        ? BLOCK_TEXT['rollback-failed']()
        : block === 'rolled-back'
          ? BLOCK_TEXT['rolled-back'](release.available)
          : null
  return {
    activity,
    target,
    steps: activity !== 'idle' || fresh ? updateSteps(run) : null,
    outcome:
      activity === 'idle' && update && recent
        ? updateOutcome(update, release.mode === 'ready' && block === 'rolled-back')
        : null,
    rejected,
    stale,
    blocked: release.mode === 'ready' ? blocked : null,
    canUpdate:
      release.mode === 'ready' && activity === 'idle' && block === null ? release.available : null,
  }
}

/** Опрашивать ли состояние: идёт заявка или обновление — раз в несколько секунд, до итога */
export const shouldPoll = (status: InstallationStatus | undefined, now: Date) =>
  status !== undefined && updateActivity(status, now) !== 'idle'
