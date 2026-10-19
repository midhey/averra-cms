// Время по-человечески, как в концепте: «15 минут назад», «вчера», «12 октября».
// Точную дату экран кладёт рядом в <time dateTime> и в подсказку (formatDateTime)

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** День календаря в нужном поясе: «вчера» считается по календарю, а не «24 часа назад» */
function dayKey(date: Date, timeZone: string | undefined) {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).format(date)
}

/**
 * Давно ли это было. Часовой пояс задаётся только в тестах, в админке — пояс браузера.
 * Время из будущего (часы сервера чуть впереди) — «только что», а не «через минуту»
 */
export function relativeTime(iso: string, now: Date = new Date(), timeZone?: string) {
  const date = new Date(iso)
  const diff = now.getTime() - date.getTime()
  const rtf = new Intl.RelativeTimeFormat('ru', { numeric: 'auto' })
  if (diff < MINUTE) return 'только что'
  if (diff < HOUR) return rtf.format(-Math.floor(diff / MINUTE), 'minute')
  const today = dayKey(now, timeZone)
  if (dayKey(date, timeZone) === today) return rtf.format(-Math.floor(diff / HOUR), 'hour')
  const yesterday = dayKey(new Date(now.getTime() - 24 * HOUR), timeZone)
  if (dayKey(date, timeZone) === yesterday) return 'вчера'
  const sameYear = dayKey(date, timeZone).slice(0, 4) === today.slice(0, 4)
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone,
  }).format(date)
}

/** Время дня: «12:14» */
export function formatTime(iso: string, timeZone?: string) {
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone }).format(
    new Date(iso),
  )
}

/** Длительность сборки: «41 с», «2 мин 5 с» */
export function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} с`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest === 0 ? `${minutes} мин` : `${minutes} мин ${rest} с`
}
