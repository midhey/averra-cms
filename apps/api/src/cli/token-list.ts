import { tokensRepo } from '../modules/tokens/repo'
import { openDb, run } from './common'

const date = (value: Date | null) => (value ? value.toLocaleString('ru-RU') : '—')

await run(async () => {
  const { db, close } = await openDb()
  try {
    const tokens = await tokensRepo(db).list()
    if (tokens.length === 0) {
      console.log('Токенов нет. Выпустить: pnpm token:create --name <имя>')
      return
    }
    console.table(
      tokens.map((token) => ({
        id: token.id,
        имя: token.name,
        сайт: token.siteName,
        выпустил: token.createdBy ?? '—',
        создан: date(token.createdAt),
        'черновики блоков': token.rights.blocksDraft ? 'да' : 'нет',
        публикация: token.rights.publish ? 'да' : 'нет',
        удаление: token.rights.delete ? 'да' : 'нет',
        'последний раз': date(token.lastUsedAt),
        отозван: date(token.revokedAt),
      })),
    )
  } finally {
    await close()
  }
})
