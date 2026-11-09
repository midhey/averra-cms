// Проверка поведения переноса действием, в настоящем Chromium: окно записи (клик, Esc, клик по
// фону, фокус, отправка с плохим и хорошим контактом), появление при прокрутке, рисование линий,
// подсказка-поворот, плавный FAQ, карточки целей (Enter, перетаскивание, «Разложить заново»),
// наведение в шапке, кольцо фокуса, меню телефона, «уменьшить движение» и сайт без JS.
//   node compare/check.mjs <адрес собранного сайта Averra>
// Сайт — опубликованный перенос (import.ts --publish) за сервером, который, как Caddy, отдаёт
// /api/forms/* в API: проверка отправляет две настоящие заявки. Playwright — из пакета @averra/e2e.
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(join(here, '..', '..', '..', 'e2e', 'package.json'))
const { chromium } = require('@playwright/test')
const URL = process.argv[2]
if (!URL) {
  console.error('Нужно: <адрес сайта Averra>')
  process.exit(2)
}
const show = (v) => (typeof v === 'string' ? v : JSON.stringify(v))
const out = (k, v) => console.log(`  ${k.padEnd(46)} ${show(v)}`)
let failed = 0
/** Проверка: значение и условие; не прошла — строка с «✗» и код выхода 1 в конце */
const check = (k, ok, v) => {
  const pass = ok(v)
  if (!pass) failed += 1
  console.log(`${pass ? '✓' : '✗'} ${k.padEnd(46)} ${show(v)}`)
}
const b = await chromium.launch()
// ── 1440 с JS
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
  const p = await ctx.newPage()
  const errors = []
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  p.on('pageerror', (e) => errors.push(String(e)))
  await p.goto(`${URL}/`, { waitUntil: 'networkidle' })
  out('ждут появления ниже экрана', await p.locator('[data-av-pending]').count())
  for (let y = 0; y < 9000; y += 300) {
    await p.mouse.wheel(0, 300)
    await p.waitForTimeout(60)
  }
  await p.waitForTimeout(1500)
  out('появились / всего', [
    await p.locator('[data-av-shown]').count(),
    await p.locator('[data-av-reveal]').count(),
  ])
  check(
    'не появились после прокрутки',
    (v) => v === 0,
    await p.locator('[data-av-pending]').count(),
  )
  check(
    'первой карточке — подсказка',
    (v) => v === 1,
    await p.locator('[data-av-hint][data-av-hinted]').count(),
  )
  check(
    'линии SVG готовы рисоваться',
    (v) => v > 0,
    await p.locator('[data-av-draw="svg"][data-av-armed]').count(),
  )
  const det = p.locator('#faq details').first()
  await det.locator('summary').click()
  out('FAQ занят сразу после клика', await det.getAttribute('data-av-busy'))
  await p.waitForTimeout(500)
  check('FAQ открыт после анимации', (v) => v === true, await det.evaluate((d) => d.open))
  await p.evaluate(() => scrollTo(0, 0))
  const reset = p.locator('.goals__reset')
  out('кнопка «Разложить» видна / подсказка', [
    await reset.isVisible(),
    (await p.locator('.goals__hint').innerText()).split('\n').join(' '),
  ])
  const toggle = p.locator('.goal-card__toggle').first()
  await toggle.focus()
  await p.keyboard.press('Enter')
  check('Enter переворачивает карточку', (v) => v === true, await toggle.isChecked())
  await p.keyboard.press('Enter')
  check('второй Enter переворачивает обратно', (v) => v === false, await toggle.isChecked())
  const card = p.locator('.goal-card').nth(1)
  await card.scrollIntoViewIfNeeded()
  const box = await card.boundingBox()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await p.mouse.move(cx, cy)
  await p.mouse.down()
  await p.mouse.move(cx + 60, cy + 30, { steps: 8 })
  await p.mouse.up()
  check('сдвиг после перетаскивания / не перевёрнута', (v) => v[0] !== '' && v[1] === false, [
    await card.evaluate((c) => c.style.translate),
    await card.locator('input').isChecked(),
  ])
  await p.mouse.click(cx + 60, cy + 30)
  check('простой клик переворачивает', (v) => v === true, await card.locator('input').isChecked())
  await reset.click()
  check('«Разложить заново»: сдвиг / перевёрнута', (v) => v[0] === '' && v[1] === false, [
    await card.evaluate((c) => c.style.translate),
    await card.locator('input').isChecked(),
  ])
  await p.evaluate(() => scrollTo(0, 0))
  const cta = p.locator('[data-site-header] .cta')
  const bg0 = await cta.evaluate((e) => getComputedStyle(e).backgroundColor)
  await cta.hover()
  await p.waitForTimeout(400)
  check(
    'кнопка шапки: фон / фон при наведении / сдвиг',
    (v) => v[0] !== v[1] && v[2] === '0px -2px',
    [
      bg0,
      await cta.evaluate((e) => getComputedStyle(e).backgroundColor),
      await cta.evaluate((e) => getComputedStyle(e).translate),
    ],
  )
  const link = p.locator('[data-site-header] .nav__link').first()
  await link.hover()
  await p.waitForTimeout(200)
  check(
    'цвет пункта меню при наведении',
    (v) => v === 'rgb(192, 80, 61)',
    await link.evaluate((e) => getComputedStyle(e).color),
  )
  await p.mouse.move(700, 600)
  await p.keyboard.press('Tab')
  await p.keyboard.press('Tab')
  check(
    'кольцо фокуса',
    (v) => v.includes('rgb(184, 84, 24)'),
    await p.evaluate(() => {
      const s = getComputedStyle(document.activeElement)
      return `${document.activeElement.className} ${s.outlineColor} ${s.outlineWidth} off ${s.outlineOffset}`
    }),
  )
  const hero = p.locator('#top a.cta-dark')
  await hero.click()
  await p.waitForTimeout(500)
  const dlg = p.locator('dialog[data-site-window][open]')
  check('окно открыто / адрес', (v) => v[0] === 1 && v[1] === `${URL}/`, [
    await dlg.count(),
    p.url(),
  ])
  check(
    'фокус в окне',
    (v) => v === true,
    await p.evaluate(() => !!document.activeElement.closest('dialog')),
  )
  check(
    'канал по умолчанию / подпись контакта / тип',
    (v) => v[0] === 'Telegram' && v[1].startsWith('Ник в Telegram'),
    await dlg.evaluate((d) => [
      d.querySelector('select').value,
      d.querySelector('label[for$="contact"]').textContent,
      d.querySelector('input[name=contact]').type,
    ]),
  )
  await dlg.locator('select').selectOption('Телефон')
  check(
    'телефон: подпись / тип / placeholder',
    (v) => v[1] === 'tel',
    await dlg.evaluate((d) => [
      d.querySelector('label[for$="contact"]').textContent,
      d.querySelector('input[name=contact]').type,
      d.querySelector('input[name=contact]').placeholder,
    ]),
  )
  await dlg.locator('select').selectOption('Telegram')
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)
  check('Esc закрывает / фокус вернулся', (v) => v[0] === 0 && v[1] === 'cta-dark', [
    await dlg.count(),
    await p.evaluate(() => document.activeElement.className),
  ])
  await hero.click()
  await p.waitForTimeout(400)
  await p.mouse.click(10, 450)
  await p.waitForTimeout(300)
  check('клик по фону закрывает', (v) => v === 0, await dlg.count())
  await hero.click()
  await p.waitForTimeout(400)
  await dlg.locator('input[name=name]').fill('Аня')
  await dlg.locator('input[name=contact]').fill('ab')
  await dlg.locator('input[type=checkbox]').check()
  await dlg.evaluate((d) => d.querySelector('form').setAttribute('novalidate', ''))
  await dlg.locator('button[type=submit]').click()
  await p.waitForTimeout(1500)
  check(
    'плохой контакт: ошибка сервера',
    (v) => v.includes('@nickname'),
    await dlg.evaluate((d) =>
      [...d.querySelectorAll('[data-field-error]:not([hidden]), [data-form-error]:not([hidden])')]
        .map((e) => e.textContent)
        .join(' | '),
    ),
  )
  await dlg.locator('input[name=contact]').fill('@anya_test')
  await dlg.locator('button[type=submit]').click()
  await p.waitForTimeout(1500)
  check(
    'верный контакт: успех',
    (v) => v.startsWith('Заявка у меня Спасибо, Аня!'),
    await dlg.evaluate(
      (d) => d.querySelector('[data-form-box][data-sent] [role=status]')?.textContent ?? 'нет',
    ),
  )
  // Как .lead-done оригинала: «Ура!», заголовок «Заявка у меня», без приглашения над формой
  check(
    'успех: только «Ура!» и спасибо',
    (v) => v.ura === '"Ура!"' && v.hidden === 0 && v.title === 'hidden',
    await dlg.evaluate((d) => {
      const box = d.querySelector('[data-form-box][data-sent]')
      const shown = (e) => getComputedStyle(e).display !== 'none'
      return {
        ura: getComputedStyle(box.querySelector('[role=status]'), '::before').content,
        hidden: [...box.querySelectorAll(':scope > h2, :scope > p:not([role])')].filter(shown)
          .length,
        title: getComputedStyle(d.querySelector('[data-site-window-title]')).visibility,
      }
    }),
  )
  // Закрыли и открыли снова: окно сбросило форму, а способ связи — снова Telegram с его подписью
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)
  await hero.click()
  await p.waitForTimeout(400)
  check(
    'после успеха и повторного открытия: Telegram',
    (v) => v === 'Telegram|Ник в Telegram *',
    await dlg.evaluate((d) => {
      const contact = d.querySelector('input[name=contact]')
      return `${d.querySelector('select[name=channel]').value}|${d.querySelector(`label[for="${contact.id}"]`).textContent}`
    }),
  )
  // Ошибка 400 — ответ API на плохой контакт выше, она ожидаема; любых других (CSP, скрипты) нет
  check(
    'ошибки консоли (кроме ответа 400)',
    (v) => v.length === 0,
    errors.filter((e) => !e.includes('status of 400')),
  )
  await ctx.close()
}
// ── 375 с JS
{
  const ctx = await b.newContext({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
  })
  const p = await ctx.newPage()
  await p.goto(`${URL}/`, { waitUntil: 'networkidle' })
  const top0 = await p.locator('main').evaluate((e) => e.getBoundingClientRect().top)
  await p.locator('[data-site-header] summary').click()
  await p.waitForTimeout(500)
  check(
    '375: меню открыто, main сдвинулся на',
    (v) => v > 200,
    Math.round((await p.locator('main').evaluate((e) => e.getBoundingClientRect().top)) - top0),
  )
  check(
    '375: последний пункт меню',
    (v) => v.startsWith('Записаться'),
    await p.locator('.menu__link').last().innerText(),
  )
  await p.keyboard.press('Escape')
  await p.waitForTimeout(400)
  check(
    '375: Esc закрывает меню',
    (v) => v === true,
    !(await p.locator('[data-site-header] details').evaluate((d) => d.open)),
  )
  await p.locator('[data-site-header] summary').click()
  await p.waitForTimeout(400)
  await p.locator('.menu__link').last().click()
  await p.waitForTimeout(600)
  check('375: последний пункт открывает окно', (v) => v[0] === 1, [
    await p.locator('dialog[data-site-window][open]').count(),
    p.url(),
  ])
  check(
    '375: горизонтальная прокрутка',
    (v) => v === 0,
    await p.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  )
  check(
    '375: кнопки «Разложить» нет',
    (v) => v === true,
    await p.locator('.goals__reset').isHidden(),
  )
  await ctx.close()
}
// ── reduced motion
{
  const ctx = await b.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  })
  const p = await ctx.newPage()
  await p.goto(`${URL}/`, { waitUntil: 'networkidle' })
  check(
    'меньше движения: невидимых элементов',
    (v) => v === 0,
    await p.evaluate(
      () =>
        [...document.querySelectorAll('[data-av-reveal]')].filter(
          (e) => getComputedStyle(e).opacity === '0',
        ).length,
    ),
  )
  await ctx.close()
}
// ── без JS
{
  const ctx = await b.newContext({
    viewport: { width: 375, height: 812 },
    javaScriptEnabled: false,
  })
  const p = await ctx.newPage()
  await p.goto(`${URL}/`, { waitUntil: 'load' })
  await p.locator('[data-site-header] summary').click()
  check(
    'без JS: меню открывается',
    (v) => v === true,
    await p.locator('.menu__link').first().isVisible(),
  )
  await p.locator('#top a.cta-dark').click()
  await p.waitForLoadState()
  check('без JS: кнопка записи → адрес', (v) => v.endsWith('/zapis/'), p.url())
  await p.locator('input[name=name]').fill('Петя')
  await p.locator('select').selectOption('Telegram')
  await p.locator('input[name=contact]').fill('@petya_test')
  await p.locator('input[type=checkbox]').check()
  await p.locator('button[type=submit]').click()
  await p.waitForLoadState()
  check('без JS: отправка → адрес', (v) => v.includes('sent='), p.url())
  check(
    'без JS: «Спасибо» видно',
    (v) => v === true,
    await p.locator('[role=status]').first().isVisible(),
  )
  await ctx.close()
}
await b.close()
if (failed > 0) {
  console.error(`Не прошло проверок: ${failed}`)
  process.exit(1)
}
