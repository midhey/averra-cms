// Маленький клиент API Averra для скрипта переноса: вход владельца, cookie сессии и понятные
// ошибки. Без зависимостей: скрипт запускают на любой машине с Node 24, без установки репозитория.

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

/** Ответ API с ошибкой: статус, сообщение и пути до кривых полей */
export class ApiFailure extends Error {
  status: number
  issues: readonly { path: string; message: string }[]
  constructor(
    status: number,
    message: string,
    issues: readonly { path: string; message: string }[] = [],
  ) {
    super(message)
    this.name = 'ApiFailure'
    this.status = status
    this.issues = issues
  }
}

type Issue = { path: string; message: string }

const describe = (status: number, body: unknown) => {
  const error = (body as { error?: { message?: string; issues?: Issue[] } } | null)?.error
  const issues = error?.issues ?? []
  const lines = issues.map((issue) => `  - ${issue.path}: ${issue.message}`)
  return [`API ответил ${status}: ${error?.message ?? 'без объяснения'}`, ...lines].join('\n')
}

export type ClientOptions = {
  /** Адрес API, например http://localhost:4000 или https://admin.example.ru (на установке API живёт на адресе админки) */
  baseUrl: string
  /** Адрес админки (ADMIN_URL установки): API принимает запросы с cookie только с неё */
  origin: string
  fetch?: Fetch
}

export function createClient({ baseUrl, origin, fetch = globalThis.fetch }: ClientOptions) {
  const cookies = new Map<string, string>()
  const root = baseUrl.replace(/\/+$/, '')

  async function send(method: string, path: string, body?: { json?: unknown; form?: FormData }) {
    const headers: Record<string, string> = { origin }
    if (cookies.size > 0) {
      headers.cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ')
    }
    if (body?.json !== undefined) headers['content-type'] = 'application/json'
    const res = await fetch(`${root}${path}`, {
      method,
      headers,
      body: body?.json !== undefined ? JSON.stringify(body.json) : body?.form,
    })
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';')
      const at = pair?.indexOf('=') ?? -1
      if (pair && at > 0) cookies.set(pair.slice(0, at), pair.slice(at + 1))
    }
    return res
  }

  /** Ответ как JSON; ошибка API — ApiFailure с текстом и путями до полей */
  async function call<T = unknown>(
    method: string,
    path: string,
    body?: { json?: unknown; form?: FormData },
    accept: readonly number[] = [],
  ) {
    const res = await send(method, path, body)
    const text = await res.text()
    let parsed: unknown = null
    try {
      parsed = text === '' ? null : JSON.parse(text)
    } catch {
      parsed = null
    }
    if (!res.ok && !accept.includes(res.status)) {
      const error = (parsed as { error?: { message?: string; issues?: Issue[] } } | null)?.error
      throw new ApiFailure(res.status, describe(res.status, parsed), error?.issues ?? [])
    }
    return { status: res.status, body: parsed as T }
  }

  return {
    get: <T>(path: string) => call<T>('GET', path).then((r) => r.body),
    put: <T>(path: string, json: unknown) => call<T>('PUT', path, { json }).then((r) => r.body),
    patch: <T>(path: string, json: unknown) => call<T>('PATCH', path, { json }).then((r) => r.body),
    post: <T>(path: string, json?: unknown) =>
      call<T>('POST', path, json === undefined ? undefined : { json }).then((r) => r.body),
    /** Статус ответа вместе с телом; перечисленные статусы — не ошибка (например, 409 «уже есть») */
    postTolerant: <T>(path: string, json: unknown, accept: readonly number[]) =>
      call<T>('POST', path, { json }, accept),
    upload: <T>(path: string, form: FormData) =>
      call<T>('POST', path, { form }).then((r) => r.body),
    /** Вход владельца: cookie сессии запоминаются клиентом */
    async signIn(email: string, password: string) {
      const res = await send('POST', '/api/auth/sign-in/email', { json: { email, password } })
      if (!res.ok) {
        const text = await res.text()
        let body: unknown = null
        try {
          body = JSON.parse(text)
        } catch {
          body = null
        }
        throw new ApiFailure(res.status, `Вход не удался. ${describe(res.status, body)}`)
      }
    },
  }
}

export type Client = ReturnType<typeof createClient>
