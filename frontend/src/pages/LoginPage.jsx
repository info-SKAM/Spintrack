import React, { useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { api } from '../api.js'

export default function LoginPage() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!username || !password) { setError('Enter username and password'); return }
    setLoading(true); setError('')
    try {
      const res = await api.login(username, password)
      login({ username: res.username, role: res.role }, res.token)
    } catch (err) {
      setError(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <svg width="32" height="32" viewBox="0 0 18 18">
            <circle cx="9" cy="9" r="7.5" stroke="#6366f1" strokeWidth="1.2" fill="none"/>
            <circle cx="9" cy="9" r="3.5" fill="#6366f1" opacity=".55"/>
            <circle cx="9" cy="9" r="1.4" fill="#a5b4fc"/>
          </svg>
        </div>
        <h2 style={styles.title}>SpinTrack</h2>
        <p style={styles.sub}>Production Management</p>

        <form onSubmit={submit} style={styles.form}>
          <label style={styles.label}>Username</label>
          <input
            style={styles.input}
            value={username}
            onChange={e => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
          />
          <label style={styles.label}>Password</label>
          <input
            style={styles.input}
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          {error && <p style={styles.error}>{error}</p>}
          <button style={styles.btn} disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}

const styles = {
  wrap:  { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f0f11' },
  card:  { background: '#1a1a1f', border: '1px solid #2a2a35', borderRadius: 12, padding: '40px 36px', width: 340, textAlign: 'center' },
  logo:  { marginBottom: 12 },
  title: { margin: '0 0 4px', color: '#e2e2ef', fontSize: 22, fontWeight: 600 },
  sub:   { margin: '0 0 28px', color: '#888', fontSize: 13 },
  form:  { textAlign: 'left' },
  label: { display: 'block', color: '#aaa', fontSize: 12, marginBottom: 5, marginTop: 16 },
  input: { width: '100%', background: '#111116', border: '1px solid #2a2a35', borderRadius: 6, padding: '9px 12px', color: '#e2e2ef', fontSize: 14, boxSizing: 'border-box', outline: 'none' },
  error: { color: '#f87171', fontSize: 13, margin: '10px 0 0' },
  btn:   { width: '100%', marginTop: 24, padding: '10px 0', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 7, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
}
