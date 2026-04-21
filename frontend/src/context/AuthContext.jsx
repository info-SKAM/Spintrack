import React, { createContext, useContext, useState } from 'react'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const s = localStorage.getItem('st_user')
      return s ? JSON.parse(s) : null
    } catch { return null }
  })

  const login = (userData, token) => {
    localStorage.setItem('st_token', token)
    localStorage.setItem('st_user', JSON.stringify(userData))
    setUser(userData)
  }

  const logout = () => {
    localStorage.removeItem('st_token')
    localStorage.removeItem('st_user')
    setUser(null)
  }

  const canManage = user?.role === 'admin' || user?.role === 'manager'
  const isAdmin   = user?.role === 'admin'

  const canEditDate = (dateStr) => {
    if (canManage) return true
    const today     = new Date(); today.setHours(0,0,0,0)
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
    const d = new Date(dateStr + 'T00:00:00')
    return d >= yesterday
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, canManage, isAdmin, canEditDate }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
