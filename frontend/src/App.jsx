import React, { useState } from 'react'
import EntryPage         from './pages/EntryPage.jsx'
import HistoryPage       from './pages/HistoryPage.jsx'
import MachineMasterPage from './pages/MachineMasterPage.jsx'
import CountMasterPage   from './pages/CountMasterPage.jsx'
import AdminPage         from './pages/AdminPage.jsx'
import ReportsPage       from './pages/ReportsPage.jsx'
import './App.css'

const TABS = [
  { id: 'admin',   label: 'Admin Control'  },
  { id: 'entry',   label: 'Daily Entry'    },
  { id: 'reports', label: 'Reports'        },
  { id: 'history', label: 'History'        },
  { id: 'machine', label: 'Machine Master' },
  { id: 'count',   label: 'Count Master'   },
]

export default function App() {
  const [tab, setTab] = useState('admin')
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
      </header>
      <main className="main-wrap">
        {tab === 'admin'   && <AdminPage />}
        {tab === 'entry'   && <EntryPage />}
        {tab === 'reports' && <ReportsPage />}
        {tab === 'history' && <HistoryPage />}
        {tab === 'machine' && <MachineMasterPage />}
        {tab === 'count'   && <CountMasterPage />}
      </main>
    </div>
  )
}
