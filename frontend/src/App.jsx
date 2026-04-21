import React, { useState } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
import LoginPage        from './pages/LoginPage.jsx'
import EntryPage        from './pages/EntryPage.jsx'
import HistoryPage      from './pages/HistoryPage.jsx'
import MachineMasterPage from './pages/MachineMasterPage.jsx'
import CountMasterPage  from './pages/CountMasterPage.jsx'
import AdminPage        from './pages/AdminPage.jsx'
import ReportsPage      from './pages/ReportsPage.jsx'
import UsersPage        from './pages/UsersPage.jsx'
import './App.css'

function AppShell() {
  const { user, logout, canManage, isAdmin } = useAuth()
  const [tab, setTab] = useState('entry')

  if (!user) return <LoginPage />

  const TABS = [
    { id: 'entry',   label: 'Daily Entry'    },
    { id: 'reports', label: 'Reports'        },
    { id: 'history', label: 'History'        },
    { id: 'machine', label: 'Machine Master' },
    { id: 'count',   label: 'Count Master'   },
    ...(canManage ? [{ id: 'admin', label: 'Admin Control' }] : []),
    ...(isAdmin   ? [{ id: 'users', label: 'Users'         }] : []),
  ]

  return (
    <div className="shell">
      <header className="hdr">
        <div className="hdr-brand">
          <div className="hdr-logo">
            <svg width="18" height="18" viewBox="0 0 18 18">
              <circle cx="9" cy="9" r="7.5" stroke="#6366f1" strokeWidth="1.2" fill="none"/>
              <circle cx="9" cy="9" r="3.5" fill="#6366f1" opacity=".55"/>
              <circle cx="9" cy="9" r="1.4" fill="#a5b4fc"/>
            </svg>
          </div>
          <span className="hdr-name">SpinTrack</span>
          <span className="hdr-sub">Production Management</span>
        </div>
        <nav className="hdr-nav">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`nav-btn${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
          <span style={{ color: '#888', fontSize: 12 }}>
            {user.username}
            <span style={{ marginLeft: 6, padding: '2px 7px', borderRadius: 4, fontSize: 11,
              background: user.role === 'admin' ? '#4f46e5' : user.role === 'manager' ? '#0e7490' : '#374151',
              color: '#fff' }}>
              {user.role}
            </span>
          </span>
          <button
            onClick={logout}
            style={{ background: 'none', border: '1px solid #2a2a35', borderRadius: 6,
              color: '#888', fontSize: 12, padding: '4px 10px', cursor: 'pointer' }}
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="main-wrap">
        {tab === 'entry'   && <EntryPage />}
        {tab === 'reports' && <ReportsPage />}
        {tab === 'history' && <HistoryPage />}
        {tab === 'machine' && <MachineMasterPage />}
        {tab === 'count'   && <CountMasterPage />}
        {tab === 'admin'   && canManage && <AdminPage />}
        {tab === 'users'   && isAdmin   && <UsersPage />}
      </main>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  )
}
