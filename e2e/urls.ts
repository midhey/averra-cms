// Свои порты, чтобы e2e не мешали pnpm dev (4000, 5173, 4321)
export const ports = { api: 4100, admin: 5273, renderer: 4421 } as const

export const urls = {
  api: `http://localhost:${ports.api}`,
  admin: `http://localhost:${ports.admin}`,
  renderer: `http://localhost:${ports.renderer}`,
} as const

/**
 * Владелец админки в базе e2e: API создаёт его при старте (DEV_OWNER_*), тесты входят им.
 * Учебные данные только для e2e — база e2e своя и стирается перед каждым прогоном
 */
export const e2eOwner = {
  email: 'owner@e2e.test',
  password: 'e2e-owner-password',
  name: 'Владелец (разработка)',
} as const

/** Сессия владельца, которую сохраняет проект setup и берут остальные тесты */
export const ownerStateFile = new URL('./.data/owner.json', import.meta.url)
