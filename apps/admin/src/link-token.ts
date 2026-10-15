import { useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

/**
 * Токен из ссылки письма: …/reset-password#token=… или …/invite#token=…. Токен во фрагменте,
 * а не в адресе: фрагмент браузер не шлёт на сервер, и токен не попадает в логи и Referer
 */
export function tokenFromHash(hash: string) {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const token = params.get('token')?.trim()
  return token ? token : undefined
}

/**
 * Токен из адреса экрана, один раз при открытии. Сразу после этого он убирается из адресной
 * строки (через историю роутера, чтобы тот не разошёлся с браузером): не останется в истории
 * браузера и не уйдёт дальше, если человек скопирует адрес
 */
export function useLinkToken() {
  const router = useRouter()
  const [token] = useState(() => tokenFromHash(window.location.hash))
  useEffect(() => {
    if (token === undefined || window.location.hash === '') return
    const { pathname, search } = window.location
    router.history.replace(`${pathname}${search}`)
  }, [router, token])
  return token
}
