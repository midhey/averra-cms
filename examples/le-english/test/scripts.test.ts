// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  customBlockScriptFile,
  renderCustomBlockHtml,
  siteScriptFile,
} from '@averra/blocks/custom-engine'
import { parsedExample } from '@averra/schema'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildFile } from '../build-blocks.ts'
import { siteScriptUntouched, stampSiteScript } from '../src/import-site.ts'

// Свой JS набора — так, как он выполняется на сайте: файлом-обёрткой Averra поверх настоящей
// разметки (встроенная форма записи, блок карточек целей). Проверяется поведение, а не строки кода

const here = dirname(fileURLToPath(import.meta.url))
const SITE_SCRIPT = readFileSync(join(here, '..', 'site', 'script.js'), 'utf8')
const GOALS = buildFile().blocks.find((block) => block.key === 'le-goals')
if (!GOALS) throw new Error('Нет блока le-goals')

/** Выполнить файл скрипта как модуль страницы и дать его промисам завершиться */
async function run(file: string) {
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
  await new AsyncFunction(`'use strict';\n${file}`)()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

afterEach(() => {
  document.body.innerHTML = ''
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  vi.restoreAllMocks()
})

/** Разметка встроенного блока «Форма» Averra (Form.tsx): поля по name, подсказка — «id-hint» */
const FORM = `
<section><div data-form-box="">
  <p role="status" tabindex="-1">Спасибо! Заявка отправлена.</p>
  <form method="post" action="/api/forms/x">
    <div><label for="f-name">Имя<span aria-hidden="true"> *</span></label>
      <input id="f-name" type="text" name="name" required></div>
    <div><label for="f-channel">Как связаться<span aria-hidden="true"> *</span></label>
      <select id="f-channel" name="channel" required>
        <option value="">Выберите…</option><option value="Telegram">Telegram</option>
        <option value="ВКонтакте">ВКонтакте</option><option value="Телефон">Телефон</option>
        <option value="Почта">Почта</option>
      </select></div>
    <div><label for="f-contact">Контакт<span aria-hidden="true"> *</span></label>
      <input id="f-contact" type="text" name="contact" required aria-describedby="f-contact-hint">
      <span id="f-contact-hint">Ник, ссылка, номер или почта — смотря что выбрано выше.</span></div>
    <button type="submit">Записаться</button>
  </form>
</div></section>`

const field = () => ({
  select: document.querySelector<HTMLSelectElement>('select[name="channel"]') as HTMLSelectElement,
  contact: document.querySelector<HTMLInputElement>('input[name="contact"]') as HTMLInputElement,
  label: document.querySelector('label[for="f-contact"]') as HTMLLabelElement,
  hint: document.getElementById('f-contact-hint') as HTMLElement,
  status: document.querySelector('[role="status"]') as HTMLElement,
})

describe('скрипт сайта: форма записи', () => {
  it('способ связи сразу Telegram, подпись и подсказка поля — под Telegram', async () => {
    document.body.innerHTML = FORM
    await run(siteScriptFile(SITE_SCRIPT))
    const { select, contact, label, hint } = field()
    expect(select.value).toBe('Telegram')
    expect(label.textContent).toBe('Ник в Telegram *')
    // Звёздочка «обязательное» — отдельный span, она остаётся
    expect(label.querySelector('span')?.textContent).toBe(' *')
    expect(contact.placeholder).toBe('@nickname')
    expect(hint.textContent).toContain('Нет ника')
    expect(hint.hidden).toBe(false)
  })

  it('выбрали «Телефон» — подпись, тип и клавиатура телефона; «ВКонтакте» — пустая подсказка скрыта', async () => {
    document.body.innerHTML = FORM
    await run(siteScriptFile(SITE_SCRIPT))
    const { select, contact, label, hint } = field()
    select.value = 'Телефон'
    select.dispatchEvent(new Event('change'))
    expect(label.textContent).toBe('Номер телефона *')
    expect(contact.type).toBe('tel')
    expect(contact.inputMode).toBe('tel')
    expect(contact.autocomplete).toBe('tel')
    expect(contact.placeholder).toBe('+7 900 000-00-00')
    select.value = 'ВКонтакте'
    select.dispatchEvent(new Event('change'))
    expect(contact.type).toBe('text')
    expect(hint.hidden).toBe(true)
  })

  it('вариант списка переименовали — поле как без скрипта', async () => {
    document.body.innerHTML = FORM.replace('value="Почта">Почта', 'value="E-mail">E-mail')
    await run(siteScriptFile(SITE_SCRIPT))
    const { select, contact, label } = field()
    select.value = 'E-mail'
    select.dispatchEvent(new Event('change'))
    expect(label.textContent).toBe('Контакт *')
    expect(contact.type).toBe('text')
    expect(contact.placeholder).toBe('')
  })

  it('отправка: «Спасибо, <имя>» с каналом в тексте успеха, имя — на миг в sessionStorage', async () => {
    document.body.innerHTML = FORM
    await run(siteScriptFile(SITE_SCRIPT))
    const { select, status } = field()
    ;(document.querySelector('input[name="name"]') as HTMLInputElement).value = ' Вера '
    select.value = 'Телефон'
    const form = document.querySelector('form') as HTMLFormElement
    form.addEventListener('submit', (event) => event.preventDefault())
    form.dispatchEvent(new Event('submit', { cancelable: true }))
    // «Заявка у меня» — заголовком (крючок для CSS окон), под ним спасибо с именем и каналом
    expect(status.querySelector('[data-done-title]')?.textContent).toBe('Заявка у меня')
    expect(status.textContent).toBe(
      'Заявка у меня Спасибо, Вера! Свяжусь с тобой по телефону в течение дня — договоримся о времени первого урока.',
    )
    expect(JSON.parse(sessionStorage.getItem('vallex-lead') ?? '{}')).toEqual({
      name: 'Вера',
      channel: 'Телефон',
    })
  })

  it('вернулись со страницы ответа (?sent=) — «Спасибо» с именем, запись стёрта', async () => {
    document.body.innerHTML = FORM
    window.history.replaceState(null, '', '/zapis/?sent=x')
    sessionStorage.setItem('vallex-lead', JSON.stringify({ name: 'Вера', channel: 'Telegram' }))
    await run(siteScriptFile(SITE_SCRIPT))
    expect(field().status.textContent).toMatch(
      /^Заявка у меня Спасибо, Вера! .* в Telegram в течение дня/,
    )
    expect(sessionStorage.getItem('vallex-lead')).toBeNull()
  })

  it('окно сбросило форму (form.reset) — снова Telegram и подпись под Telegram', async () => {
    document.body.innerHTML = FORM
    await run(siteScriptFile(SITE_SCRIPT))
    const { select, contact, label, hint } = field()
    select.value = 'Телефон'
    select.dispatchEvent(new Event('change'))
    expect(contact.type).toBe('tel')
    ;(document.querySelector('form') as HTMLFormElement).reset()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(select.value).toBe('Telegram')
    expect(label.textContent).toBe('Ник в Telegram *')
    expect(contact.type).toBe('text')
    expect(contact.placeholder).toBe('@nickname')
    expect(hint.textContent).toContain('Нет ника')
  })

  it('без ?sent= текст успеха формы не меняется до отправки', async () => {
    document.body.innerHTML = FORM
    sessionStorage.setItem('vallex-lead', JSON.stringify({ name: 'Вера', channel: 'Telegram' }))
    await run(siteScriptFile(SITE_SCRIPT))
    expect(field().status.textContent).toBe('Спасибо! Заявка отправлена.')
  })
})

describe('скрипт сайта на установке: метка и контрольная сумма', () => {
  it('скрипт набора без правок узнаётся, дописанный интегратором — нет', () => {
    const stamped = stampSiteScript(SITE_SCRIPT)
    expect(siteScriptUntouched('')).toBe(true)
    expect(siteScriptUntouched(stamped)).toBe(true)
    expect(siteScriptUntouched(`${stamped}\n`)).toBe(true)
    // Интегратор дописал своё ниже или поправил строку — уже не наш
    expect(siteScriptUntouched(`${stamped}console.log('свой код')\n`)).toBe(false)
    expect(siteScriptUntouched(stamped.replace("FIRST = 'Telegram'", "FIRST = 'Почта'"))).toBe(
      false,
    )
    // Скрипт набора без суммы (вписан руками) и чужой скрипт — не трогаем
    expect(siteScriptUntouched(SITE_SCRIPT)).toBe(false)
    expect(siteScriptUntouched("console.log('интегратор')")).toBe(false)
  })
})

/** Подменить matchMedia: широкий экран с мышью или телефон */
function screen(wide: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: wide,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  )
}

async function goals() {
  const props = parsedExample(GOALS as NonNullable<typeof GOALS>) as Record<string, unknown>
  const html = renderCustomBlockHtml(GOALS as NonNullable<typeof GOALS>, props, {
    id: 'b',
    media: {},
    priority: false,
  })
  document.body.innerHTML = `<section data-custom-block="le-goals">${html}</section>`
  await run(customBlockScriptFile('le-goals', GOALS?.script ?? ''))
  const toggles = Array.from(document.querySelectorAll<HTMLInputElement>('.goal-card__toggle'))
  return { toggles, reset: document.querySelector<HTMLButtonElement>('.goals__reset') }
}

describe('скрипт карточек целей', () => {
  it('Enter переворачивает карточку и возвращает обратно', async () => {
    screen(false)
    const { toggles } = await goals()
    const first = toggles[0] as HTMLInputElement
    expect(toggles.length).toBeGreaterThan(0)
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    expect(first.checked).toBe(true)
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    expect(first.checked).toBe(false)
    // Другие клавиши скрипт не трогает: пробел флажок переворачивает сам
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', cancelable: true }))
    expect(first.checked).toBe(false)
  })

  it('широкий экран с мышью: кнопка «Разложить заново», курсор «взять», подсказка про перетаскивание', async () => {
    screen(true)
    const { toggles, reset } = await goals()
    expect(reset?.hidden).toBe(false)
    expect(reset?.textContent).toBe('↺ Разложить заново')
    expect(document.querySelector('.goals__board')?.hasAttribute('data-draggable')).toBe(true)
    expect(document.querySelector('.goals__hint')?.textContent).toContain('Перетаскивай')
    // Разложить заново: карточки на место и лицом вверх
    const card = document.querySelector<HTMLElement>('.goal-card') as HTMLElement
    card.style.translate = '40px 10px'
    card.dataset.x = '40'
    ;(toggles[0] as HTMLInputElement).checked = true
    reset?.click()
    expect(card.style.translate).toBe('')
    expect(card.dataset.x).toBeUndefined()
    expect(toggles.every((toggle) => !toggle.checked)).toBe(true)
  })

  it('мышью: карточка едет за указателем в пределах доски и после перетаскивания не переворачивается', async () => {
    screen(true)
    const { toggles } = await goals()
    const board = document.querySelector('.goals__board') as HTMLElement
    const card = document.querySelector<HTMLElement>('.goal-card') as HTMLElement
    const toggle = toggles[0] as HTMLInputElement
    const rect = (left: number, top: number, width: number, height: number) =>
      ({ left, top, right: left + width, bottom: top + height, width, height }) as DOMRect
    // Доска 0…1000 × 0…600, карточка 100…340 × 100…420
    vi.spyOn(board, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 1000, 600))
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(rect(100, 100, 240, 320))
    card.setPointerCapture = vi.fn()
    const pointer = (type: string, x: number, y: number) =>
      card.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          button: 0,
          pointerId: 1,
          pointerType: 'mouse',
          clientX: x,
          clientY: y,
        }),
      )

    // Дрожание меньше 6 px — ещё клик: карточка на месте и переворачивается
    pointer('pointerdown', 200, 200)
    pointer('pointermove', 203, 202)
    pointer('pointerup', 203, 202)
    expect(card.style.translate).toBe('')
    toggle.click()
    expect(toggle.checked).toBe(true)
    toggle.click()
    expect(toggle.checked).toBe(false)

    // Перетаскивание: сдвиг на 50 × 30, захват указателя, карточка сверху
    pointer('pointerdown', 200, 200)
    pointer('pointermove', 250, 230)
    expect(card.style.translate).toBe('50px 30px')
    expect(card.setPointerCapture).toHaveBeenCalledWith(1)
    expect(card.hasAttribute('data-dragging')).toBe(true)
    // Дальше края доски не уезжает: справа запас 1000 − 340 = 660, снизу 600 − 420 + 20 = 200
    pointer('pointermove', 2000, 2000)
    expect(card.style.translate).toBe('660px 200px')
    pointer('pointerup', 2000, 2000)
    expect(card.hasAttribute('data-dragging')).toBe(false)
    // Клик, которым кончилось перетаскивание, карточку не переворачивает
    toggle.click()
    expect(toggle.checked).toBe(false)
    // Следующий обычный клик — переворачивает
    toggle.click()
    expect(toggle.checked).toBe(true)

    // Окно поменяло размер — карточки на место
    window.dispatchEvent(new Event('resize'))
    expect(card.style.translate).toBe('')
  })

  it('касание пальцем карточку не тащит: прокрутка телефона не перехватывается', async () => {
    screen(true)
    await goals()
    const card = document.querySelector<HTMLElement>('.goal-card') as HTMLElement
    for (const [type, x] of [
      ['pointerdown', 200],
      ['pointermove', 300],
    ] as const) {
      card.dispatchEvent(
        new PointerEvent(type, { bubbles: true, pointerId: 2, pointerType: 'touch', clientX: x }),
      )
    }
    expect(card.style.translate).toBe('')
  })

  it('телефон и планшет: кнопка скрыта, карточки не таскаются, подсказка — про нажатие', async () => {
    screen(false)
    const { reset } = await goals()
    expect(reset?.hidden).toBe(true)
    expect(document.querySelector('.goals__board')?.hasAttribute('data-draggable')).toBe(false)
    expect(document.querySelector('.goals__hint')?.textContent).toContain('Нажми на карточку')
  })
})
