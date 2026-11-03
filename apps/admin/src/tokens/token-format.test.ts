import { describe, expect, it } from 'vitest'
import { isDraftsOnly, mcpConfigFragment, rightsSummary, tokenState } from './token-format'

describe('фрагмент .mcp.json', () => {
  it('сервер averra с адресом установки и токеном в env — разбирается как JSON', () => {
    const fragment = mcpConfigFragment('https://admin.example.ru', 'cms_x_y')
    expect(JSON.parse(fragment)).toEqual({
      mcpServers: {
        averra: {
          command: 'node_modules/.bin/node',
          args: ['apps/mcp/node_modules/tsx/dist/cli.mjs', 'apps/mcp/src/index.ts'],
          env: { CMS_API_URL: 'https://admin.example.ru', CMS_API_TOKEN: 'cms_x_y' },
        },
      },
    })
  })
})

describe('права словами', () => {
  it('черновики страниц — всегда, дальше — включённые права', () => {
    expect(rightsSummary({ blocksDraft: false, publish: false, delete: false })).toBe(
      'Черновики страниц',
    )
    expect(rightsSummary({ blocksDraft: true, publish: true, delete: true })).toBe(
      'Черновики страниц, черновики своих блоков, публикация страниц, удаление страниц и картинок',
    )
  })

  it('«только черновики» — без публикации и удаления', () => {
    expect(isDraftsOnly({ blocksDraft: true, publish: false, delete: false })).toBe(true)
    expect(isDraftsOnly({ blocksDraft: true, publish: true, delete: false })).toBe(false)
  })
})

describe('состояние', () => {
  it('действует, пока не отозван', () => {
    expect(tokenState({ revokedAt: '2026-11-01' })).toBe('revoked')
    expect(tokenState({ revokedAt: null })).toBe('active')
  })
})
