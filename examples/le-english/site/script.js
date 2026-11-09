// Скрипт сайта Vallex English — улучшения формы записи, как у lead-form.js исходного сайта. Форма
// и без него работает: сервер проверяет контакт по выбранному способу связи, а «Спасибо» приходит
// со страницы ответа. Со скриптом:
//   - способ связи сразу «Telegram», как у оригинала (без JS человек выбирает сам);
//   - подпись, placeholder, клавиатура и подсказка поля контакта следуют выбранному способу;
//   - после отправки — «Спасибо, <имя>! Свяжусь с тобой в Telegram…», с именем и каналом.
// Форма — встроенный блок «Форма» Averra: её поля находятся по name (channel, contact, name), а
// варианты списка — по подписи (Telegram, ВКонтакте, Телефон, Почта)
const CHANNELS = {
  Telegram: {
    label: 'Ник в Telegram',
    placeholder: '@nickname',
    type: 'text',
    inputMode: 'text',
    autocomplete: 'off',
    hint: 'Нет ника — подойдёт номер, к которому привязан Telegram.',
    via: 'в Telegram',
  },
  ВКонтакте: {
    label: 'Ссылка на страницу ВКонтакте',
    placeholder: 'vk.com/nickname',
    type: 'text',
    inputMode: 'url',
    autocomplete: 'off',
    hint: '',
    via: 'во ВКонтакте',
  },
  Телефон: {
    label: 'Номер телефона',
    placeholder: '+7 900 000-00-00',
    type: 'tel',
    inputMode: 'tel',
    autocomplete: 'tel',
    hint: 'Позвоню или напишу СМС.',
    via: 'по телефону',
  },
  Почта: {
    label: 'Электронная почта',
    placeholder: 'name@mail.ru',
    type: 'email',
    inputMode: 'email',
    autocomplete: 'email',
    hint: '',
    via: 'по почте',
  },
}
const FIRST = 'Telegram'
const SAVED = 'vallex-lead'

const thanks = (name, channel) => {
  const via = (CHANNELS[channel] ?? CHANNELS[FIRST]).via
  return `${name ? `Спасибо, ${name}!` : 'Спасибо!'} Свяжусь с тобой ${via} в течение дня — договоримся о времени первого урока.`
}

/**
 * Текст успеха как у оригинала: заголовок «Заявка у меня» отдельной строкой (крючок
 * data-done-title — для CSS окон темы), под ним спасибо с именем и каналом. «Ура!» рисует CSS
 */
const showThanks = (status, name, channel) => {
  // strong: на странице /zapis CSS окон не действует, и заголовок выделен хотя бы жирным; в окне
  // начертание задаёт CSS окон. Своей строкой — через CSSOM, а не атрибут style (его CSP не пускает)
  const title = document.createElement('strong')
  title.setAttribute('data-done-title', '')
  title.textContent = 'Заявка у меня'
  title.style.display = 'block'
  const text = document.createElement('span')
  text.textContent = thanks(name, channel)
  status.replaceChildren(title, ' ', text)
}

/** Первый текстовый узел подписи: звёздочка «обязательное» в ней — отдельный span, её не трогаем */
const labelText = (label) =>
  Array.from(label?.childNodes ?? []).find((node) => node.nodeType === Node.TEXT_NODE)

for (const form of document.querySelectorAll('form')) {
  const select = form.querySelector('select[name="channel"]')
  const contact = form.querySelector('input[name="contact"]')
  if (!select || !contact) continue
  const label = labelText(form.querySelector(`label[for="${contact.id}"]`))
  const hint = document.getElementById(`${contact.id}-hint`)
  // Как было без скрипта: к этому возвращаемся, если вариант списка переименовали
  const plain = {
    label: label?.textContent ?? '',
    hint: hint?.textContent ?? '',
    type: contact.type,
    inputMode: contact.inputMode,
    autocomplete: contact.autocomplete,
  }
  const fit = () => {
    const channel = CHANNELS[select.value]
    if (label) label.textContent = channel ? channel.label : plain.label
    if (hint) {
      hint.textContent = channel ? channel.hint : plain.hint
      hint.hidden = hint.textContent === ''
    }
    contact.type = channel ? channel.type : plain.type
    contact.inputMode = channel ? channel.inputMode : plain.inputMode
    contact.autocomplete = channel ? channel.autocomplete : plain.autocomplete
    contact.placeholder = channel ? channel.placeholder : ''
  }
  const start = () => {
    if (select.value === '' && Array.from(select.options).some((one) => one.value === FIRST)) {
      select.value = FIRST
    }
    fit()
  }
  start()
  select.addEventListener('change', fit)
  // Окно после отправки или закрытия сбрасывает форму (form.reset): список возвращается к
  // «Выберите…», а подпись поля осталась бы от прежнего способа. Событие reset приходит до
  // сброса значений — снова ставим Telegram на следующем тике, когда значения уже сброшены
  form.addEventListener('reset', () => setTimeout(start, 0))

  // «Спасибо» с именем и каналом: текст успеха готовим до отправки. В окне форма уходит без
  // перехода, и этот текст покажется сразу; со страницы ответ API возвращает на ту же страницу —
  // имя на миг кладём в sessionStorage (только у этого посетителя, до закрытия вкладки)
  form.addEventListener(
    'submit',
    () => {
      const name = form.querySelector('input[name="name"]')?.value.trim() ?? ''
      const status = form.closest('[data-form-box]')?.querySelector('[role="status"]')
      if (status) showThanks(status, name, select.value)
      try {
        sessionStorage.setItem(SAVED, JSON.stringify({ name, channel: select.value }))
      } catch {
        // Без sessionStorage — общий текст успеха
      }
    },
    true,
  )
}

// Вернулись со страницы ответа после отправки без окна: «Спасибо» с именем, если оно есть
if (/[?&]sent=/.test(location.search)) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SAVED) ?? 'null')
    sessionStorage.removeItem(SAVED)
    const status = saved && document.querySelector('[data-form-box] [role="status"]')
    if (status) showThanks(status, saved.name, saved.channel)
  } catch {
    // Нечего подставить — остаётся текст успеха формы
  }
}
