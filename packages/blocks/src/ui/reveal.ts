import type { CSSProperties } from 'react'

/**
 * Атрибуты карточки с «Появлением при прокрутке»: data-av-reveal включает поведение скрипта
 * поведений, а порядок карточки (--av-reveal-order) даёт небольшую лесенку задержек. Без JS и при
 * «уменьшить движение» карточка видна сразу: прячет её только скрипт, и только ниже экрана
 */
export function revealProps(reveal: 'none' | 'up' | 'fade' | undefined, index: number) {
  if (reveal === undefined || reveal === 'none') return {}
  return {
    'data-av-reveal': reveal,
    style: { '--av-reveal-order': String(index) } as CSSProperties,
  }
}
