// Свои порты, чтобы e2e не мешали pnpm dev (4000, 5173, 4321)
export const ports = { api: 4100, admin: 5273, renderer: 4421 } as const

export const urls = {
  api: `http://localhost:${ports.api}`,
  admin: `http://localhost:${ports.admin}`,
  renderer: `http://localhost:${ports.renderer}`,
} as const
