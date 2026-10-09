import { useEffect, useState } from 'react'
import { api } from './api'
import { Editor, type EditorPage, type EditorSite } from './editor/Editor'
import { messageOf } from './errors'

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; site: EditorSite; page: EditorPage }

export function App() {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    loadFirstSite()
      .then(({ site, page }) => setState({ status: 'ready', site, page }))
      .catch((error: unknown) => setState({ status: 'error', message: messageOf(error) }))
  }, [])

  return (
    <div className="admin">
      {state.status === 'ready' ? (
        <Editor site={state.site} page={state.page} />
      ) : (
        <p className="admin-message">{state.status === 'loading' ? 'Загружаю…' : state.message}</p>
      )}
    </div>
  )
}

// Пока редактор открывает главную страницу первого сайта. Навигация по сайтам — следующий шаг
async function loadFirstSite() {
  const [first] = await (await api.sites.$get()).json()
  if (!first) throw new Error('В базе нет ни одного сайта')
  const [siteRes, pageRes] = await Promise.all([
    api.sites[':siteId'].$get({ param: { siteId: first.id } }),
    api.sites[':siteId'].pages[':slug'].$get({ param: { siteId: first.id, slug: 'index' } }),
  ])
  if (siteRes.status !== 200 || pageRes.status !== 200) {
    throw new Error('Не удалось загрузить сайт или его главную страницу')
  }
  return { site: await siteRes.json(), page: await pageRes.json() }
}
