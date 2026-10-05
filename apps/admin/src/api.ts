import type { AppType } from '@cms/api'
import { hc } from 'hono/client'

// Клиент знает все маршруты и типы ответов API без кодогенерации:
// поменяется ответ в API — админка перестанет компилироваться, пока не поправишь
export const api = hc<AppType>(window.location.origin).api
