import type { SameSitePath } from '@averra/schema'

/**
 * Узнаёт ссылку https на свой сайт для проверки петель редиректов (redirectTableIssues). Хост
 * сравнивает URL, а не текст: https://example.ru:443/b и https://xn--e1afmkfd.xn--p1ai/b — тот же
 * сайт, что https://example.ru и https://пример.рф (порт по умолчанию отбрасывается, домен — в
 * punycode). Путь возвращается закодированным, раскодирует его схема
 */
export function sameSitePathOf(siteUrl: string): SameSitePath {
  const site = new URL(siteUrl)
  return (href) => {
    let target: URL
    try {
      target = new URL(href)
    } catch {
      return undefined
    }
    return target.protocol === site.protocol && target.host === site.host
      ? target.pathname
      : undefined
  }
}
