import { sameTheme, type Theme } from './theme'

// Готовые темы экрана «Тема»: с них начинают, потом подправляют. Каждая проходит контраст по всем
// парам, и блокирующим, и предупреждающим (contrast.test.ts)

export const themePresetIds = ['calm', 'fresh', 'warm', 'strict', 'night', 'bright'] as const
export type ThemePresetId = (typeof themePresetIds)[number]

export type ThemePreset = { id: ThemePresetId; title: string; theme: Theme }

export const themePresets: readonly ThemePreset[] = [
  {
    id: 'calm',
    title: 'Спокойная',
    theme: {
      colors: {
        background: '#fbfbf8',
        surface: '#eef2ee',
        text: '#1f2e25',
        muted: '#4f5d55',
        accent: '#2e6b49',
        onAccent: '#ffffff',
        border: '#dde3de',
      },
      fonts: { heading: 'golos-text', body: 'golos-text' },
      radius: 'medium',
    },
  },
  {
    id: 'fresh',
    title: 'Свежая',
    theme: {
      colors: {
        background: '#ffffff',
        surface: '#eef3fb',
        text: '#14213d',
        muted: '#4a5670',
        accent: '#2457d6',
        onAccent: '#ffffff',
        border: '#dce3ef',
      },
      fonts: { heading: 'manrope', body: 'manrope' },
      radius: 'medium',
    },
  },
  {
    id: 'warm',
    title: 'Тёплая',
    theme: {
      colors: {
        background: '#fbf6ef',
        surface: '#f3e9dc',
        text: '#2b1f17',
        muted: '#5e4b3e',
        accent: '#b4532a',
        onAccent: '#ffffff',
        border: '#e6d8c6',
      },
      fonts: { heading: 'lora', body: 'golos-text' },
      radius: 'small',
    },
  },
  {
    id: 'strict',
    title: 'Строгая',
    theme: {
      colors: {
        background: '#ffffff',
        surface: '#f2f2f2',
        text: '#111111',
        muted: '#555555',
        accent: '#111111',
        onAccent: '#ffffff',
        border: '#e2e2e2',
      },
      fonts: { heading: 'unbounded', body: 'golos-text' },
      radius: 'none',
    },
  },
  {
    id: 'night',
    title: 'Ночная',
    theme: {
      colors: {
        background: '#14171c',
        surface: '#1e232b',
        text: '#eef1f5',
        muted: '#a9b1be',
        accent: '#f2b544',
        onAccent: '#1a1408',
        border: '#2c333d',
      },
      fonts: { heading: 'manrope', body: 'manrope' },
      radius: 'large',
    },
  },
  {
    id: 'bright',
    title: 'Яркая',
    theme: {
      colors: {
        background: '#fffdf7',
        surface: '#fff1d6',
        text: '#1d1a16',
        muted: '#5a5247',
        // Оранжевый концепта (#E0560F) с белым текстом даёт 3,8: кнопки не прошли бы 4,5
        accent: '#c9480c',
        onAccent: '#ffffff',
        border: '#f0dfc0',
      },
      fonts: { heading: 'unbounded', body: 'manrope' },
      radius: 'large',
    },
  },
]

/** Готовая тема, с которой тема совпадает целиком, — её карточка на экране выбрана */
export const presetOf = (theme: Theme) =>
  themePresets.find((preset) => sameTheme(preset.theme, theme))
