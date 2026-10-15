// Имя этого компьютера. Без Node API: им пользуются и config.ts, и почта (mail/link-warning.ts),
// которую подключают маршруты, а их типы читает админка

const LOOPBACK_HOST = /^(localhost|[a-z0-9.-]+\.localhost|127(\.\d{1,3}){3}|\[::1\])$/i

/** Имя этого компьютера: localhost, *.localhost, 127.x.x.x или [::1] */
export const isLoopbackHost = (hostname: string) => LOOPBACK_HOST.test(hostname)
