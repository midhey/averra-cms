/**
 * Куда вести старый адрес админки. До «одна установка — один сайт» экраны жили под
 * /sites/<id сайта>/…, теперь id в адресе нет: /sites/<id>/pages → /pages. Закладки и ссылки из
 * старых писем не должны ломаться, поэтому такие адреса перенаправляются, а id не важен — сайт
 * у установки один. Поиск (?…) и якорь (#…) сохраняются. Не старый адрес — undefined
 */
export function legacySiteTarget(pathname: string, searchStr = '', hash = '') {
  const match = /^\/sites(?:\/[^/]+)?(\/.*)?$/.exec(pathname)
  if (!match) return undefined
  // Начальные / и \ схлопываются в одну /: //evil.example или /\evil.example браузер прочёл бы как
  // адрес другого сайта. Роутер такие перенаправления и сам не пускает, но защита — здесь
  const path = (match[1] ?? '').replace(/^[\\/]*/, '/')
  const anchor = hash === '' || hash.startsWith('#') ? hash : `#${hash}`
  return `${path}${searchStr}${anchor}`
}
