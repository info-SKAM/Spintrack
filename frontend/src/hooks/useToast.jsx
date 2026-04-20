import { useState, useCallback } from 'react'

let _id = 0

export function useToast() {
  const [toasts, setToasts] = useState([])

  const show = useCallback((msg, type = 'success') => {
    const id = ++_id
    setToasts(t => [...t, { id, msg, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3800)
  }, [])

  const ToastContainer = () => (
    <div className="toast-wrap">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`}>{t.msg}</div>
      ))}
    </div>
  )

  return { show, ToastContainer }
}
