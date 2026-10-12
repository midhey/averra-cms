import { fileURLToPath } from 'node:url'
import { expect, test as setup } from '@playwright/test'
import { e2eOwner, ownerStateFile, urls } from '../urls'

// Один вход владельцем на весь прогон: cookie сохраняется в файл, и тесты стартуют с ней.
// Вход через API, а не через форму: форму проверяет auth.spec.ts
setup('вход владельцем', async ({ request }) => {
  const res = await request.post(`${urls.admin}/api/auth/sign-in/email`, {
    data: { email: e2eOwner.email, password: e2eOwner.password },
  })
  expect(res.status(), await res.text()).toBe(200)
  await request.storageState({ path: fileURLToPath(ownerStateFile) })
})
