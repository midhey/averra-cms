import { expect, test } from './fixtures'

// Витрина компонентов (/dev/ui, только в разработке): основа экранов.
// Поведение компонентов проверяют тесты админки (src/ui/*.test.tsx), здесь — настоящий браузер:
// стили, шрифты, кольцо фокуса, клавиатура и ширина телефона

test.describe('витрина компонентов', () => {
  test('открывается, все разделы на месте, шрифты свои', async ({ page }) => {
    const external: string[] = []
    page.on('request', (request) => {
      if (/fonts\.(googleapis|gstatic)\.com/u.test(request.url())) external.push(request.url())
    })
    const fontFiles: string[] = []
    page.on('response', (response) => {
      if (/\.woff2(?:\?|$)/u.test(response.url()) && response.ok()) fontFiles.push(response.url())
    })
    await page.goto('/dev/ui')
    await expect(page).toHaveTitle('Витрина компонентов — Averra CMS')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Витрина компонентов')
    for (const name of [
      'Кнопки',
      'Поля',
      'Выбор',
      'Вкладки',
      'Состояния',
      'Окно',
      'SEO',
      'Иконки',
    ]) {
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible()
    }
    // Старой шапки здесь нет: витрина сама в оболочке AppShell
    await expect(page.getByRole('button', { name: 'Выйти' })).toHaveCount(0)

    // Код выполняется в браузере; строкой, потому что типов DOM у e2e нет.
    // document.fonts.check() не годится: для семейства без @font-face он тоже отвечает true.
    // Смотрим начертания, которые браузер на самом деле скачал и разобрал
    const fonts = (await page.evaluate(`document.fonts.ready.then(() => ({
      body: getComputedStyle(document.body).fontFamily,
      loaded: [...document.fonts]
        .filter((face) => face.status === 'loaded')
        .map((face) => face.family.replace(/["']/g, '') + ' ' + face.weight),
    }))`)) as { body: string; loaded: string[] }
    expect(fonts.body).toContain('Golos Text')
    expect(fonts.loaded).toEqual(
      expect.arrayContaining(['Golos Text 400', 'Golos Text 600', 'JetBrains Mono 400']),
    )
    // Файлы шрифтов пришли с адреса админки, а не со стороннего сервера
    const origin = new URL(page.url()).origin
    expect(fontFiles.length).toBeGreaterThan(0)
    for (const url of fontFiles) expect(new URL(url).origin).toBe(origin)
    expect(external).toEqual([])
  })

  test('с клавиатуры: ссылка на содержимое, кнопки с видимым кольцом фокуса', async ({ page }) => {
    await page.goto('/dev/ui')
    // Витрина грузится лениво: ждём экран, иначе Tab уйдёт в пустую страницу
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: 'Перейти к содержимому' })
    await expect(skip).toBeFocused()
    await expect(skip).toBeInViewport()
    await page.keyboard.press('Enter')
    await expect(page.locator('#content')).toBeFocused()

    const publish = page.getByRole('button', { name: 'Опубликовать', exact: true })
    await publish.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await expect(publish).toBeFocused()
    await expect(publish).toHaveCSS('outline-style', 'solid')

    // Поля: Tab переходит от подписанного поля к следующему, кольцо фокуса видно
    const title = page.getByRole('textbox', { name: 'Заголовок' })
    const slug = page.getByRole('textbox', { name: 'Адрес' })
    await title.focus()
    await page.keyboard.press('Tab')
    await expect(slug).toBeFocused()
    await expect(slug).toHaveCSS('outline-style', 'solid')
    await page.keyboard.type('-dalee')
    await expect(slug).toHaveValue(/-dalee$/u)
  })

  test('поле с ошибкой остаётся красным и при наведении', async ({ page }) => {
    await page.goto('/dev/ui')
    const email = page.getByRole('textbox', { name: 'Почта для уведомлений' })
    await expect(email).toHaveAttribute('aria-invalid', 'true')
    // Код выполняется в браузере строкой: типов DOM у e2e нет
    const borderOf = (label: string) =>
      page.evaluate(
        `getComputedStyle(document.getElementById([...document.querySelectorAll('label')].find((l) => l.textContent === '${label}').htmlFor)).borderTopColor`,
      ) as Promise<string>
    // Цвет ошибки — как у текста под полем (роль --color-danger-text)
    const danger = (await page.evaluate(
      `getComputedStyle([...document.querySelectorAll('p')].find((p) => p.textContent === 'Неверный адрес почты')).color`,
    )) as string
    await expect(email).toHaveCSS('border-top-color', danger)
    await email.hover()
    await expect(email).toHaveCSS('border-top-color', danger)

    // Проверка не пустая: у обычного поля наведение рамку меняет
    const plain = page.getByRole('textbox', { name: 'Адрес' })
    const before = await borderOf('Адрес')
    await plain.hover()
    await expect.poll(() => borderOf('Адрес')).not.toBe(before)
  })

  test('вкладки и переключатель — стрелками', async ({ page }) => {
    await page.goto('/dev/ui')
    const tabs = page.getByRole('tablist', { name: 'Фильтр заявок' })
    await tabs.getByRole('tab', { name: 'Новые · 3' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(tabs.getByRole('tab', { name: 'Обработанные · 24' })).toBeFocused()
    await expect(page.getByRole('tabpanel', { name: /^Обработанные/u })).toHaveText(
      'Обработанные заявки за 180 дней.',
    )
    await page.keyboard.press('End')
    await expect(tabs.getByRole('tab', { name: 'Все' })).toHaveAttribute('aria-selected', 'true')

    const devices = page.getByRole('group', { name: 'Ширина предпросмотра' })
    await devices.getByRole('radio', { name: 'Десктоп' }).focus()
    await page.keyboard.press('ArrowLeft')
    await expect(devices.getByRole('radio', { name: 'Планшет' })).toBeChecked()

    // Пилюли разделов каталога — те же радиокнопки: выбранная тёмная и жирнее, не только цветом
    const sections = page.getByRole('group', { name: 'Раздел каталога' })
    await sections.getByRole('radio', { name: /^Все/u }).focus()
    await page.keyboard.press('ArrowRight')
    const start = sections.getByRole('radio', { name: 'Начало страницы' })
    await expect(start).toBeChecked()
    const label = sections
      .locator('label')
      .filter({ has: page.getByRole('radio', { name: 'Начало страницы' }) })
    await expect(label).toHaveCSS('outline-style', 'solid')
    await expect(label.locator('span').last()).toHaveCSS('font-weight', '600')
  })

  test('каталог блоков: поиск, наброски, пометка «новый», выбор', async ({ page }) => {
    await page.goto('/dev/ui')
    await page.getByRole('button', { name: 'Каталог блоков…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Добавить блок' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('searchbox', { name: 'Найти блок' }).fill('нет такого')
    await expect(dialog.getByRole('heading', { name: 'Такого блока нет' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Показать все блоки' }).click()
    const faq = dialog.getByRole('button', { name: /^Вопросы и ответы/u })
    await expect(faq).toContainText('новый')
    await faq.click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText('Выбран блок «Вопросы и ответы» (понарошку).')).toBeVisible()
  })

  test('карточка SVG-логотипа: превью целиком, без обрезки', async ({ page }) => {
    await page.goto('/dev/ui')
    const card = page.locator('div', { hasText: /^logo-remont\.svg/u }).filter({
      has: page.locator('img'),
    })
    const preview = card.locator('img').first()
    await expect(preview).toBeVisible()
    await expect(preview).toHaveCSS('object-fit', 'contain')
    // Файл показался, а не значок битой картинки
    await expect(preview).toHaveJSProperty('complete', true)
    await expect(preview).not.toHaveJSProperty('naturalWidth', 0)
  })

  // Контрастная тема Windows (forced colors): выбор виден системным «выделением», подписи читаются.
  // Светлая и тёмная системные палитры дают разные пары цветов — проверяем обе
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`принудительные цвета (${colorScheme}): выбранные вариант, вкладка и карточка видны`, async ({
      page,
    }) => {
      await page.emulateMedia({ forcedColors: 'active', colorScheme })
      await page.goto('/dev/ui')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await page.getByRole('radio', { name: 'С картинкой' }).check()

      // Код выполняется в браузере строкой: типов DOM у e2e нет.
      // Системные цвета берём с пробного элемента, контраст — по формуле WCAG
      const result = (await page.evaluate(`(() => {
        const probe = (value) => {
          const el = document.createElement('div')
          el.style.color = value
          document.body.append(el)
          const color = getComputedStyle(el).color
          el.remove()
          return color
        }
        const channels = (color) => color.match(/[\\d.]+/g).slice(0, 3).map(Number)
        const luminance = (color) => {
          const [r, g, b] = channels(color).map((v) => {
            const c = v / 255
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
          })
          return 0.2126 * r + 0.7152 * g + 0.0722 * b
        }
        const contrast = (a, b) => {
          const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
          return (hi + 0.05) / (lo + 0.05)
        }
        const option = (name) =>
          [...document.querySelectorAll('input[type="radio"]')]
            .find((input) => input.closest('label').textContent === name)
            .closest('label')
        const text = (label) => getComputedStyle(label.querySelector(':scope > span:last-child')).color
        const segment = option('Десктоп')
        const card = option('С картинкой')
        const otherCard = option('По центру')
        const tabs = [...document.querySelectorAll('[role="tab"]')]
        const selectedTab = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true')
        const otherTab = tabs.find((tab) => tab.getAttribute('aria-selected') !== 'true')
        const [pick, otherPick] = document.querySelectorAll('[aria-label="Заявки в списке"] a')
        const outline = (el) => {
          const style = getComputedStyle(el)
          return style.outlineStyle + ' ' + style.outlineWidth
        }
        return {
          highlight: probe('Highlight'),
          highlightText: probe('HighlightText'),
          canvas: probe('Canvas'),
          segmentBackground: getComputedStyle(segment).backgroundColor,
          segmentColor: getComputedStyle(segment).color,
          segmentContrast: contrast(text(segment), getComputedStyle(segment).backgroundColor),
          cardContrast: contrast(text(card), getComputedStyle(card).backgroundColor),
          cardBorder: getComputedStyle(card).borderTopColor,
          otherCardBorder: getComputedStyle(otherCard).borderTopColor,
          checkmark: getComputedStyle(card, '::after').borderRightColor,
          selectedTabBorder: getComputedStyle(selectedTab).borderBottomColor,
          otherTabBorder: getComputedStyle(otherTab).borderBottomColor,
          pickCurrent: pick.getAttribute('aria-current'),
          pickBorder: getComputedStyle(pick).borderTopColor,
          pickOutline: outline(pick),
          otherPickBorder: getComputedStyle(otherPick).borderTopColor,
          otherPickOutline: outline(otherPick),
        }
      })()`)) as Record<string, string | number>

      // Сегмент закрашен системной парой «выделение»
      expect(result.segmentBackground).toBe(result.highlight)
      expect(result.segmentColor).toBe(result.highlightText)
      expect(result.segmentContrast).toBeGreaterThanOrEqual(4.5)
      // Карточка: подпись читается, выбор — рамкой и галочкой цвета «выделение»
      expect(result.cardContrast).toBeGreaterThanOrEqual(4.5)
      expect(result.cardBorder).toBe(result.highlight)
      expect(result.checkmark).toBe(result.highlight)
      expect(result.otherCardBorder).not.toBe(result.highlight)
      // Вкладки: подчёркнута только выбранная
      expect(result.selectedTabBorder).toBe(result.highlight)
      expect(result.otherTabBorder).toBe(result.canvas)
      // Выбранная карточка-ссылка: рамка «выделения» и обводка внутри неё — цвет рамки в этом
      // режиме не различить. У соседней нет ни того, ни другого
      expect(result.pickCurrent).toBe('page')
      expect(result.pickBorder).toBe(result.highlight)
      expect(result.pickOutline).toBe('solid 2px')
      expect(result.otherPickBorder).not.toBe(result.highlight)
      expect(result.otherPickOutline).not.toBe('solid 2px')
    })
  }

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`принудительные цвета (${colorScheme}): миниатюры вариантов и спиннер видны`, async ({
      page,
    }) => {
      await page.emulateMedia({ forcedColors: 'active', colorScheme })
      await page.goto('/dev/ui')
      await expect(page.getByRole('button', { name: 'Идёт проверка' })).toBeVisible()
      const result = (await page.evaluate(`(() => {
        const option = (name) =>
          [...document.querySelectorAll('input[type="radio"]')]
            .find((input) => input.closest('label').textContent === name)
            .closest('label')
        const sketch = option('С картинкой').querySelector('[aria-hidden="true"] > span')
        const [lines, media] = sketch.children
        const button = [...document.querySelectorAll('button')]
          .find((el) => el.textContent === 'Идёт проверка')
        const spinner = getComputedStyle(button.querySelector('span'))
        return {
          sketch: getComputedStyle(sketch).backgroundColor,
          line: getComputedStyle(lines.firstElementChild).backgroundColor,
          media: getComputedStyle(media).backgroundColor,
          ringTop: spinner.borderTopColor,
          ringRight: spinner.borderRightColor,
        }
      })()`)) as Record<string, string>
      // Линии и картинка миниатюры не сливаются с её фоном
      expect(result.line).not.toBe(result.sketch)
      expect(result.media).not.toBe(result.sketch)
      // У спиннера сектор другого цвета, чем кольцо: вращение видно
      expect(result.ringRight).not.toBe(result.ringTop)
    })
  }

  test('окно открывается с клавиатуры, Esc закрывает и возвращает фокус', async ({ page }) => {
    await page.goto('/dev/ui')
    const opener = page.getByRole('button', { name: 'Удалить страницу…' })
    await opener.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Удалить страницу «Отзывы»?' })
    await expect(dialog).toBeVisible()
    // Фокус внутри окна, фон недоступен
    await expect(dialog.locator(':focus')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()

    await page.keyboard.press('Enter')
    await dialog.getByRole('button', { name: 'Удалить', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText('Страница «Отзывы» удалена (понарошку).')).toBeVisible()
  })

  test('на телефоне: без горизонтальной прокрутки, меню кнопкой и Esc', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/dev/ui')
    const overflow = await page.evaluate(
      'document.documentElement.scrollWidth - document.documentElement.clientWidth',
    )
    expect(overflow).toBe(0)

    const nav = page.getByRole('navigation', { name: 'Разделы витрины' })
    await expect(nav).toBeHidden()
    const menu = page.getByRole('button', { name: 'Меню', exact: true })
    await menu.click()
    await expect(page.getByRole('button', { name: 'Закрыть меню' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expect(nav).toBeVisible()
    await nav.getByRole('link', { name: 'Кнопки' }).focus()
    await page.keyboard.press('Escape')
    await expect(nav).toBeHidden()
    await expect(menu).toBeFocused()

    // Переход по ссылке меню закрывает его
    await menu.click()
    await nav.getByRole('link', { name: 'Иконки' }).click()
    await expect(nav).toBeHidden()
    await expect(page.getByRole('heading', { level: 2, name: 'Иконки' })).toBeInViewport()
  })
})
