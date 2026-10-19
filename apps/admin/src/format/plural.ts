/**
 * Русское склонение после числа: pluralRu(3, ['страница', 'страницы', 'страниц']) → «страницы».
 * Только слово: число экран пишет сам, как ему нужно
 */
export function pluralRu(count: number, [one, few, many]: readonly [string, string, string]) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

/** Число и слово: «3 страницы» */
export const countRu = (count: number, forms: readonly [string, string, string]) =>
  `${count} ${pluralRu(count, forms)}`
