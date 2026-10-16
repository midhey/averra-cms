import { NewSite } from '@averra/schema'
import { defaultTheme } from '@averra/tokens'
import { sitesRepo } from '../modules/sites/repo'
import { args, check, openDb, run } from './common'

const usage = `Создать сайт (как «Новый сайт» в админке):
  pnpm site:create --name "Ремонт квартир" [--print-id]

Главная страница создаётся сразу (черновик). --print-id печатает только id сайта — так его
берёт установщик (deploy/install.sh), чтобы Caddy отдавал этот сайт на домене сайта.`

await run(async () => {
  const values = args({ name: { type: 'string' }, 'print-id': { type: 'boolean' } }, usage)
  const { name } = check(NewSite, { name: values.name }, usage)
  const { db, config, close } = await openDb()
  try {
    const site = await sitesRepo(db).createSite(name, defaultTheme)
    if (values['print-id']) {
      console.log(site.id)
      return
    }
    console.log(`Создан сайт «${site.name}»: ${site.id}`)
    console.log(`Админка: ${config.ADMIN_URL}/sites/${site.id}`)
  } finally {
    await close()
  }
})
