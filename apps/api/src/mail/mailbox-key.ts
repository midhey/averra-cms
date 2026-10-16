// Ключ ящика для лимитов «не чаще раза на адрес»: один ящик прячется за разными адресами

/** Почта Google: у одного ящика оба домена, а точки в имени ничего не значат */
const GMAIL_DOMAINS: ReadonlySet<string> = new Set(['gmail.com', 'googlemail.com'])
/** Почта Яндекса: один ящик на всех доменах, а точка в логине равна дефису */
const YANDEX_DOMAINS: ReadonlySet<string> = new Set([
  'yandex.ru',
  'ya.ru',
  'yandex.com',
  'yandex.by',
  'yandex.kz',
  'yandex.ua',
])

/** Домен в punycode и нижнем регистре: «пример.рф» и «xn--e1afmkfd.xn--p1ai» — один домен */
function asciiDomain(domain: string) {
  try {
    return new URL(`http://${domain}`).hostname
  } catch {
    return domain.toLowerCase()
  }
}

/**
 * Ящик, куда на самом деле ведёт адрес, — ключ для лимитов «не чаще раза на адрес». Нижний
 * регистр, без метки после «+» (vasya+1@… и vasya+2@… — один ящик у Gmail, Яндекса, Mail.ru
 * и большинства сервисов), домен в punycode; у Gmail ещё без точек в имени, у Яндекса — один
 * домен и точка как дефис. Письмо уходит на адрес как его ввели: ключ — только для сравнения.
 * Сервис без меток разделит с соседним ящиком один лимит — это безвредно
 */
export function mailboxKey(address: string) {
  const at = address.lastIndexOf('@')
  if (at < 0) return address.toLowerCase()
  let local = address.slice(0, at).toLowerCase()
  let domain = asciiDomain(address.slice(at + 1))
  const plus = local.indexOf('+')
  if (plus > 0) local = local.slice(0, plus)
  if (GMAIL_DOMAINS.has(domain)) {
    domain = 'gmail.com'
    local = local.replaceAll('.', '')
  } else if (YANDEX_DOMAINS.has(domain)) {
    domain = 'yandex.ru'
    local = local.replaceAll('.', '-')
  }
  return `${local}@${domain}`
}
