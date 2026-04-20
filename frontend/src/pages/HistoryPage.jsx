import React, { useState, useEffect } from 'react'
import { api } from '../api.js'
import { fmt1, fmt2 } from '../utils/formulas.js'
import { useToast } from '../hooks/useToast.jsx'
import './HistoryPage.css'

const todayStr = () => new Date().toISOString().split('T')[0]
const monthAgo = () => {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString().split('T')[0]
}

export default function HistoryPage() {
  const [mill,     setMill]     = useState('')
  const [mills,    setMills]    = useState([])
  const [fromDate, setFromDate] = useState(monthAgo())
  const [toDate,   setToDate]   = useState(todayStr())
  const [rows,     setRows]     = useState([])
  const [summary,  setSummary]  = useState([])
  const [loading,  setLoading]  = useState(false)
  const [tab,      setTab]      = useState('records')
  const { show, ToastContainer } = useToast()

  useEffect(() => {
    api.getMills().then(setMills).catch(() => {})
  }, [])

  const search = async () => {
    if (!mill) { show('Select a mill', 'error'); return }
    setLoading(true)
    try {
      const [hist, summ] = await Promise.all([
        api.getHistory({ mill, from_date: fromDate, to_date: toDate }),
        api.getSummary(toDate, mill),
      ])
      setRows(hist)
      setSummary(summ)
      if (!hist.length) show('No records found for the selected range', 'info')
      else show(`Loaded ${hist.length} records`)
    } catch(e) {
      show('Error: ' + e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const exportCSV = () => {
    if (!rows.length) { show('Nothing to export', 'error'); return }
    const headers = ['Date','Shift','RF No','Count','Act Hank','Stop Min',
                     'Target KGS','Actual Prdn','Std GPS','Act GPS','Diff','Total Stop']
    const csvRows = [headers.join(',')]
    rows.forEach(r => {
      csvRows.push([
        r.date, r.shift, r.rf_no, r.count,
        r.act_hank, r.stop_min, r.target_kgs, r.actual_prdn,
        r.std_gps, r.actual_gps, r.diff_plus_minus, r.total_stop,
      ].join(','))
    })
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `spintrack_${mill}_${fromDate}_${toDate}.csv`
    a.click()
    show('CSV exported')
  }

  const effColor = e => {
    const n = parseFloat(e)
    return n >= 90 ? 'green' : n >= 75 ? 'amber' : 'red'
  }

  return (
    <div className="hp">
      <div className="card filter-card">
        <div className="filter-row">
          <div className="field-group">
            <label className="flabel">Mill</label>
            <select value={mill} onChange={e => setMill(e.target.value)}>
              <option value="">— Select —</option>
              {mills.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="field-group">
            <label className="flabel">From</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
          </div>
          <div className="field-group">
            <label className="flabel">To</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
          </div>
          <button className="btn-primary" onClick={search} disabled={loading || !mill} style={{ alignSelf:'flex-end' }}>
            {loading ? <><span className="spinner"/>Loading…</> : 'Search →'}
          </button>
          {rows.length > 0 && (
            <button className="btn-ghost" onClick={exportCSV} style={{ alignSelf:'flex-end' }}>
              ↓ CSV
            </button>
          )}
        </div>
      </div>

      {rows.length > 0 && (
        <>
          <div className="htab-row">
            <div className="htabs">
              <button className={`htab ${tab === 'records' ? 'htab-active' : ''}`} onClick={() => setTab('records')}>
                Frame Records ({rows.length})
              </button>
              <button className={`htab ${tab === 'summary' ? 'htab-active' : ''}`} onClick={() => setTab('summary')}>
                Shift Summary ({summary.length})
              </button>
            </div>
          </div>

          {tab === 'records' && (
            <div className="card table-card">
              <div className="tscroll">
                <table className="htable">
                  <thead>
                    <tr>
                      <th className="th-left">Date</th>
                      <th className="th-left">Shift</th>
                      <th className="th-left">RF No</th>
                      <th className="th-left">Count</th>
                      <th>Act Hank</th>
                      <th>Stop Min</th>
                      <th>Target KGS</th>
                      <th>Actual Prdn</th>
                      <th>Std GPS</th>
                      <th>Act GPS</th>
                      <th>Diff ±</th>
                      <th>Eff %</th>
                      <th>Tot Stop</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const eff = r.std_gps > 0
                        ? ((r.actual_gps / r.std_gps) * 100).toFixed(1)
                        : '—'
                      const diff = parseFloat(r.diff_plus_minus)
                      return (
                        <tr key={i} className="hrow">
                          <td className="td-left mono">{r.date}</td>
                          <td className="td-left">
                            <span className="shift-badge">{r.shift?.replace('SHIFT','S')}</span>
                          </td>
                          <td className="td-left"><span className="rf-badge">{r.rf_no}</span></td>
                          <td className="td-left td-muted">{r.count}</td>
                          <td className="mono">{fmt2(r.act_hank)}</td>
                          <td className={`mono ${r.stop_min > 0 ? 'val-amber' : ''}`}>{r.stop_min}</td>
                          <td className="mono">{fmt2(r.target_kgs)}</td>
                          <td className="mono fw6">{fmt2(r.actual_prdn)}</td>
                          <td className="mono td-muted">{fmt2(r.std_gps)}</td>
                          <td className="mono">{fmt2(r.actual_gps)}</td>
                          <td className={`mono ${diff >= 0 ? 'val-green' : 'val-red'}`}>
                            {diff >= 0 ? '+' : ''}{fmt2(diff)}
                          </td>
                          <td>
                            <span className={`badge badge-${effColor(eff)}`}>{eff}%</span>
                          </td>
                          <td className={`mono ${r.total_stop > 0 ? 'val-amber' : 'td-muted'}`}>
                            {r.total_stop}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'summary' && (
            <div className="sum-grid">
              {summary.length > 0 ? summary.map((s, i) => (
                <div key={i} className="card sum-shift-card">
                  <div className="ssh-header">
                    <span className="shift-badge-lg">{s.shift?.replace('SHIFT','Shift ')}</span>
                    <span className={`badge badge-${effColor(s.efficiency_pct)}`}>
                      {s.efficiency_pct}% eff
                    </span>
                  </div>
                  <div className="ssh-metrics">
                    <Metric label="Frames"      value={s.frames} />
                    <Metric label="Target KGS"  value={fmt1(s.total_target)} mono />
                    <Metric label="Actual Prdn" value={fmt1(s.total_actual)} mono />
                    <Metric label="Total Stop"  value={`${s.total_stop_mins} min`} mono />
                  </div>
                  <div className="eff-bar-wrap">
                    <div className="eff-bar-bg">
                      <div
                        className={`eff-bar-fill eff-fill-${effColor(s.efficiency_pct)}`}
                        style={{ width: Math.min(100, parseFloat(s.efficiency_pct)) + '%' }}
                      />
                    </div>
                    <span className="eff-bar-label">{s.efficiency_pct}%</span>
                  </div>
                </div>
              )) : (
                <div className="empty">No summary data for selected date.</div>
              )}
            </div>
          )}
        </>
      )}

      {!loading && rows.length === 0 && (
        <div className="empty" style={{ paddingTop: 80 }}>
          <div className="empty-icon">
            <svg width="52" height="52" viewBox="0 0 52 52">
              <rect x="8" y="8" width="36" height="36" rx="6" stroke="var(--border2)" strokeWidth="1" fill="none"/>
              <line x1="16" y1="20" x2="36" y2="20" stroke="var(--border3)" strokeWidth="1"/>
              <line x1="16" y1="26" x2="30" y2="26" stroke="var(--border3)" strokeWidth="1"/>
              <line x1="16" y1="32" x2="26" y2="32" stroke="var(--border3)" strokeWidth="1"/>
            </svg>
          </div>
          <p>Select a mill and date range, then click <strong>Search</strong></p>
          <p className="empty-hint">All saved shift records will appear here.</p>
        </div>
      )}

      <ToastContainer />
    </div>
  )
}

function Metric({ label, value, mono }) {
  return (
    <div className="ssh-metric">
      <div className="ssh-mlabel">{label}</div>
      <div className={`ssh-mvalue${mono ? ' mono' : ''}`}>{value}</div>
    </div>
  )
}
