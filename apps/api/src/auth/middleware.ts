import { createMiddleware } from 'hono/factory'
import type { Db } from '../db/client'
import { tokensRepo } from '../modules/tokens/repo'
import {
  type Actor,
  can,
  forbiddenMessages,
  installationRolesOf,
  type Permission,
  personalData,
  type SiteRole,
  siteRoleOf,
  TOKEN_PERSONAL_DATA_MESSAGE,
  tokenDenied,
} from './access'
import type { Auth } from './auth'

/** Что знает о запросе каждый закрытый маршрут: кто пришёл и (под requireSite) его роль на сайте */
export type AuthEnv = { Variables: { actor: Actor; siteRole: SiteRole } }

export const unauthorized = (message = 'Нужно войти') => ({
  error: { code: 'unauthorized', message },
})
export const forbidden = (message: string) => ({ error: { code: 'forbidden', message } })
export const notFound = (message: string) => ({ error: { code: 'not_found', message } })

// Без входа открыто только это. Остальное под /api закрыто по умолчанию: новый маршрут
// не окажется открытым по забывчивости. Опубликованное и так публично — его берёт рендерер.
// Файлы картинок тоже: на них ссылается опубликованный сайт. Экрану «Забыли пароль?» нужно
// знать, работает ли сброс, ещё до входа. Иконки сайта (favicon.ico и PNG) и карточки
// опубликованных страниц для соцсетей (og) берёт рендерер, как снимок. fallback — адреса домена
// сайта, где нет файла: редирект или 404 для посетителя
const publicRoutes = [
  /^\/api\/health(\/ready)?$/,
  /^\/api\/sites\/[^/]+\/snapshot$/,
  /^\/api\/site\/snapshot$/,
  /^\/api\/sites\/[^/]+\/icons\/[^/]+$/,
  /^\/api\/sites\/[^/]+\/og\/[^/]+$/,
  // [\s\S], а не точка: в раскодированном пути посетителя бывает перевод строки (%0A)
  /^\/api\/site\/fallback(\/[\s\S]*)?$/,
  /^\/api\/media\/[^/]+\/[^/]+$/,
  /^\/api\/password-reset$/,
]

// Изменяющие запросы без входа: принять приглашение новым пользователем (у него ещё нет
// входа) — пускает только токен из письма, его проверяет сам маршрут. И приём заявок с форм
// сайта: его шлёт посетитель опубликованного сайта, у него входа нет. Маршрут сам ищет форму
// в опубликованной версии страницы и держит антиспам (modules/leads/public-routes.ts)
const publicPostRoutes = [
  /^\/api\/invitations\/(lookup|register)$/,
  /^\/api\/forms\/[^/]+\/[^/]+\/[^/]+$/,
]

function isPublic(method: string, path: string) {
  // /api/auth/* — эндпоинты Better Auth: что там можно без входа, решает он сам
  if (path === '/api/auth' || path.startsWith('/api/auth/')) return true
  if (method === 'POST') return publicPostRoutes.some((route) => route.test(path))
  return (method === 'GET' || method === 'HEAD') && publicRoutes.some((route) => route.test(path))
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

type AuthenticateOptions = {
  db: Db
  auth: Auth
  /** Откуда принимаем изменяющие запросы с cookie: админка и сам API */
  trustedOrigins: readonly string[]
}

/**
 * Кто делает запрос. Токен из Authorization: Bearer — программа (MCP) с правами на свой
 * сайт; иначе cookie сессии Better Auth. Ни того ни другого — 401 в формате ApiError
 */
export function authenticate({ db, auth, trustedOrigins }: AuthenticateOptions) {
  const tokens = tokensRepo(db)

  return createMiddleware<AuthEnv>(async (c, next) => {
    if (isPublic(c.req.method, c.req.path)) return next()

    const authorization = c.req.header('authorization')
    if (authorization !== undefined && /^bearer\s/i.test(authorization)) {
      // С неверным токеном на cookie не откатываемся: программа должна узнать, что токен плох
      const token = await tokens.verify(authorization.replace(/^bearer\s+/i, '').trim())
      if (!token) return c.json(unauthorized('Токен API недействителен или отозван'), 401)
      c.set('actor', { kind: 'token', tokenId: token.id, siteId: token.siteId })
      return next()
    }

    const { headers, response: session } = await auth.api.getSession({
      headers: c.req.raw.headers,
      returnHeaders: true,
    })
    // Better Auth мог продлить сессию или стереть протухшую cookie: это должно дойти до браузера
    for (const cookie of headers.getSetCookie()) c.header('set-cookie', cookie, { append: true })
    if (!session) return c.json(unauthorized(), 401)

    // Cookie браузер подставляет сам, поэтому изменяющий запрос с ней принимаем только
    // из админки. SameSite=Lax закрывает чужие сайты, а эта проверка — ещё и соседние поддомены
    if (!SAFE_METHODS.has(c.req.method)) {
      const origin = c.req.header('origin')
      if (!origin || !trustedOrigins.includes(origin)) {
        return c.json(forbidden('Запрос пришёл не из админки'), 403)
      }
    }

    const { id, name, email, role } = session.user
    c.set('actor', {
      kind: 'user',
      user: { id, name, email, role: role === 'owner' ? 'owner' : 'member' },
    })
    return next()
  })
}

/**
 * Доступ к сайту из параметра :siteId. Нет сайта или он чужой — 404 «Сайт не найден»:
 * участник не должен узнать даже то, что такой сайт есть. Роль есть, а действие ей
 * не разрешено — 403. Маршрут только объявляет действие, решает таблица в access.ts
 */
export function requireSite(db: Db, permission: Permission) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    // Сырой параметр, не после validate: приводим к строчным, как Uuid, иначе токен сайта
    // (его siteId из базы — строчными) не узнал бы свой сайт в адресе с заглавными буквами
    const siteId = c.req.param('siteId')?.toLowerCase()
    const role = siteId === undefined ? undefined : await siteRoleOf(db, c.var.actor, siteId)
    if (!role) return c.json(notFound('Сайт не найден'), 404)
    if (c.var.actor.kind === 'token' && personalData.has(permission)) {
      return c.json(forbidden(TOKEN_PERSONAL_DATA_MESSAGE), 403)
    }
    const deniedToToken = tokenDenied[permission]
    if (c.var.actor.kind === 'token' && deniedToToken) return c.json(forbidden(deniedToToken), 403)
    if (!can(role, permission)) return c.json(forbidden(forbiddenMessages[permission]), 403)
    c.set('siteRole', role)
    return next()
  })
}

/**
 * Действие с установкой целиком, без сайта в адресе (обновление до новой версии): решает та же
 * таблица access.ts. Участнику подходит роль на любом сайте установки; токену отказ — те же
 * personalData и tokenDenied, что у requireSite
 */
export function requireInstallation(db: Db, permission: Permission) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const { actor } = c.var
    if (actor.kind === 'token' && personalData.has(permission)) {
      return c.json(forbidden(TOKEN_PERSONAL_DATA_MESSAGE), 403)
    }
    const deniedToToken = tokenDenied[permission]
    if (actor.kind === 'token' && deniedToToken) return c.json(forbidden(deniedToToken), 403)
    const roles = await installationRolesOf(db, actor)
    if (!roles.some((role) => can(role, permission))) {
      return c.json(forbidden(forbiddenMessages[permission]), 403)
    }
    return next()
  })
}

/** Только владелец установки: почта, состояние установки */
export const requireOwner = (message: string) =>
  createMiddleware<AuthEnv>(async (c, next) => {
    const { actor } = c.var
    if (actor.kind !== 'user' || actor.user.role !== 'owner') return c.json(forbidden(message), 403)
    return next()
  })
