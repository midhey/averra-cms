import { NO_SITE_ACCESS_CODE } from '@averra/schema'
import type { ErrorInfo } from 'react'
import { ApiRequestError } from './errors'

/**
 * Отказ 403 при загрузке раздела — не сбой, а ответ «вам сюда нельзя»: его показывает экран «Нет
 * доступа к разделу» (StatusScreens). Нет доступа к сайту целиком (NO_SITE_ACCESS_CODE) —
 * другой случай, там сбой настоящий
 */
export const isSectionForbidden = (error: unknown) =>
  error instanceof ApiRequestError && error.status === 403 && error.code !== NO_SITE_ACCESS_CODE

/**
 * Что делать с ошибкой, которую поймала граница ошибок маршрута (`onCaughtError` корня React).
 * По умолчанию React пишет в консоль каждую такую ошибку, и на каждом экране «Нет доступа» в
 * консоли оставалась «необработанная» ApiRequestError: шум, под которым не видно настоящих
 * сбоев. Закрытый раздел молчит, остальное — в консоль как раньше
 */
export function reportCaughtError(error: unknown, info: ErrorInfo) {
  if (isSectionForbidden(error)) return
  console.error('Экран упал:', error, info.componentStack)
}
