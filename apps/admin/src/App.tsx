import { useEffect, useState } from 'react'
import { api } from './api'

type Status = 'loading' | 'up' | 'down'

const labels: Record<Status, string> = {
  loading: 'проверяем…',
  up: 'работают',
  down: 'недоступны',
}

export function App() {
  const [status, setStatus] = useState<Status>('loading')

  useEffect(() => {
    const check = async () => {
      try {
        const res = await api.health.ready.$get()
        const body = await res.json()
        setStatus(body.db)
      } catch {
        setStatus('down')
      }
    }
    void check()
  }, [])

  return (
    <main>
      <h1>Админка</h1>
      <p>API и база: {labels[status]}</p>
    </main>
  )
}
