/** Сколько ключей помнит счётчик по умолчанию: около 10 тысяч адресов почты — единицы мегабайт */
export const RATE_LIMIT_MAX_KEYS = 10_000

/**
 * Счётчик запросов в окне: не больше max за windowMs на один ключ. Живёт в памяти процесса,
 * как и лимит входа Better Auth: для одного процесса API этого хватает, для нескольких его
 * придётся перенести в базу. Экземпляр создаёт createApp — глобального состояния нет.
 * Без Node API: модуль подключают маршруты, а их типы читает админка.
 *
 * Память ограничена: ключей не больше maxKeys. Ключи лежат в Map в порядке последнего
 * пропущенного запроса, самые давние — в начале. Поэтому очистка идёт с начала и
 * останавливается на первом живом ключе (в сумме O(1) на запрос), а когда места нет,
 * вытесняется самый давний ключ. Вытесненный ключ теряет свой счёт — это цена предела.
 * Чтобы вытеснить чужой живой ключ, нужно maxKeys новых ключей за одно окно; ключи из
 * открытого запроса учитывают только после лимита по IP (modules/auth/routes.ts)
 */
export function createRateLimiter({
  max,
  windowMs,
  maxKeys = RATE_LIMIT_MAX_KEYS,
  now = () => Date.now(),
}: {
  max: number
  windowMs: number
  maxKeys?: number
  now?: () => number
}) {
  // Время пропущенных запросов ключа в пределах окна, по возрастанию
  const hits = new Map<string, number[]>()

  /** Убирает ключи, у которых окно прошло, — с начала, до первого живого */
  function prune(at: number) {
    for (const [key, times] of hits) {
      const last = times.at(-1)
      if (last !== undefined && at - last < windowMs) return
      hits.delete(key)
    }
  }

  return {
    /**
     * Учесть запрос. allowed: false — лимит исчерпан, запрос не учитывается,
     * а retryAfterMs говорит, когда освободится место
     */
    take(key: string): { allowed: true } | { allowed: false; retryAfterMs: number } {
      const at = now()
      prune(at)
      const recent = (hits.get(key) ?? []).filter((time) => at - time < windowMs)
      if (recent.length >= max) {
        // set существующего ключа не двигает его в Map: отказ не продлевает жизнь ключа
        hits.set(key, recent)
        const oldest = recent[0] ?? at
        return { allowed: false, retryAfterMs: Math.max(oldest + windowMs - at, 0) }
      }
      recent.push(at)
      // В конец Map: теперь это самый свежий ключ
      hits.delete(key)
      if (hits.size >= maxKeys) {
        const oldest = hits.keys().next()
        if (!oldest.done) hits.delete(oldest.value)
      }
      hits.set(key, recent)
      return { allowed: true }
    },

    /**
     * Вернуть последнюю учтённую попытку ключа. Так считают только неудачи: попытку учитывают
     * до проверки (иначе перебор шёл бы без лимита, пока проверка думает), а удачную возвращают
     */
    refund(key: string) {
      const times = hits.get(key)
      if (!times) return
      times.pop()
      if (times.length === 0) hits.delete(key)
    },

    /** Сколько ключей сейчас в памяти: для тестов */
    size: () => hits.size,
  }
}

export type RateLimiter = ReturnType<typeof createRateLimiter>
