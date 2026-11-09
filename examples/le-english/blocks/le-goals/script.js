// Карточки целей — то, что у исходного сайта держалось на main.js и чего нет у блока без скрипта:
// Enter переворачивает карточку (флажок без скрипта знает только пробел), мышью на широком экране
// карточки можно разложить по доске, «↺ Разложить заново» возвращает их на место. Без JS
// карточки переворачиваются по нажатию и пробелу, просто не таскаются. Касание и прокрутка на
// телефоне не перехватываются: перетаскивание — только мышью и только от 820 px
const wide = window.matchMedia('(min-width: 820px) and (pointer: fine)')
const DRAG_HINT = 'Перетаскивай карточки<br>и нажми, чтобы перевернуть ↓'

for (const root of blocks) {
  const board = root.querySelector('.goals__board')
  if (!board) continue
  const cards = Array.from(board.querySelectorAll('.goal-card'))
  const toggles = cards.map((card) => card.querySelector('.goal-card__toggle'))
  let layer = cards.length

  for (const toggle of toggles) {
    toggle?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      toggle.click()
    })
  }

  const place = (card, x, y) => {
    card.style.translate = x === 0 && y === 0 ? '' : `${x}px ${y}px`
  }
  const resetPositions = () => {
    for (const card of cards) {
      card.style.translate = ''
      card.style.zIndex = ''
      delete card.dataset.x
      delete card.dataset.y
    }
  }

  for (const card of cards) {
    let drag = null
    let moved = false
    card.addEventListener('pointerdown', (event) => {
      moved = false
      if (event.button !== 0 || event.pointerType !== 'mouse' || !wide.matches) return
      const rect = card.getBoundingClientRect()
      const bounds = board.getBoundingClientRect()
      const x = Number(card.dataset.x ?? 0)
      const y = Number(card.dataset.y ?? 0)
      drag = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        x,
        y,
        minX: x + bounds.left - rect.left,
        maxX: x + bounds.right - rect.right,
        minY: y + bounds.top - rect.top - 20,
        maxY: y + bounds.bottom - rect.bottom + 20,
      }
    })
    card.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.id) return
      const dx = event.clientX - drag.startX
      const dy = event.clientY - drag.startY
      // Дрожание руки при нажатии — ещё клик, а не перетаскивание
      if (!moved && Math.hypot(dx, dy) < 6) return
      if (!moved) {
        // Захват — только когда карточку правда тащат: иначе клик ушёл бы карточке, а не метке,
        // и простое нажатие перестало бы её переворачивать
        moved = true
        card.setPointerCapture(event.pointerId)
        layer += 1
        card.style.zIndex = String(layer)
        card.setAttribute('data-dragging', '')
      }
      const x = Math.max(drag.minX, Math.min(drag.maxX, drag.x + dx))
      const y = Math.max(drag.minY, Math.min(drag.maxY, drag.y + dy))
      card.dataset.x = String(x)
      card.dataset.y = String(y)
      place(card, x, y)
    })
    const finish = () => {
      drag = null
      card.removeAttribute('data-dragging')
    }
    card.addEventListener('pointerup', finish)
    card.addEventListener('pointercancel', finish)
    card.addEventListener('lostpointercapture', finish)
    // Отпустили после перетаскивания — карточка остаётся как лежала, не переворачивается
    card.addEventListener(
      'click',
      (event) => {
        if (!moved) return
        moved = false
        event.preventDefault()
        event.stopPropagation()
      },
      true,
    )
  }

  // Подсказка и кнопка — только там, где перетаскивание работает
  const controls = root.querySelector('.goals__controls')
  const hint = root.querySelector('.goals__hint')
  const tapHint = hint?.innerHTML ?? ''
  const reset = document.createElement('button')
  reset.type = 'button'
  reset.className = 'goals__reset'
  reset.textContent = '↺ Разложить заново'
  reset.addEventListener('click', () => {
    resetPositions()
    for (const toggle of toggles) if (toggle) toggle.checked = false
  })
  controls?.append(reset)
  const fit = () => {
    reset.hidden = !wide.matches
    board.toggleAttribute('data-draggable', wide.matches)
    if (hint) hint.innerHTML = wide.matches ? DRAG_HINT : tapHint
    if (!wide.matches) resetPositions()
  }
  fit()
  wide.addEventListener?.('change', fit)
  window.addEventListener('resize', resetPositions)
}
