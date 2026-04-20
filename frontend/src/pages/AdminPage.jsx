import React, { useState, useEffect } from 'react'
import { api } from '../api.js'
import { calcRow, fmt1, fmt2 } from '../utils/formulas.js'
import { useToast } from '../hooks/useToast.jsx'
import '../components/MasterTable.css'
import './AdminPage.css'

const SHIFTS = ['SHIFT1', 'SHIFT2', 'SHIFT3']

const todayStr = () => new Date().toISOString().split('T')[0]

function offsetDate(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function fmtDateLabel(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function AdminPage() {
  const [date,        setDate]        = useState(todayStr())
  const [shift,       setShift]       = useState('SHIFT1')
  const [mill,        setMill]        = useState('')
  const [mills,       setMills]       = useState([])
  const [preview,     setPreview]     = useState([])
  const [exists,      setExists]      = useState(null)
  const [loadingPrev, setLoadingPrev] = useState(false)
  const [inserting,   setInserting]   = useState(false)
  const [result,      setResult]      = useState(null)
  const { show, ToastContainer } = useToast()

  useEffect(() => {
    api.getMills().then(setMills).catch(() => {})
  }, [])

  useEffect(() => {
    setPreview([])
    setExists(null)
    setResult(null)
  }, [date, shift, mill])

  const loadPreview = async () => {
    if (!mill) { show('Select a mill', 'error'); return }
    setLoadingPrev(true)
    setResult(null)
    try {
      const [frames, chk] = await Promise.all([
        api.getFrames(mill),
        api.checkShiftExists(date, shift, mill),
      ])
      const rows = frames.map(f => ({
        ...f,
        _c: calcRow({ ...f, act_hank: 0, stop_min: 0 }),
      }))
      setPreview(rows)
      setExists(chk)
    } catch(e) {
      show('Preview failed: ' + e.message, 'error')
    } finally {
      setLoadingPrev(false)
    }
  }

  const doInsert = async () => {
    if (!preview.length) { show('Load preview first', 'error'); return }
    setInserting(true)
    try {
      const res = await api.adminInsert({ date, shift, mill })
      setResult(res)
      const chk = await api.checkShiftExists(date, shift, mill)
      setExists(chk)
      if (res.inserted > 0) {
        show(`✓ Inserted ${res.inserted} frames into Daily Working`, 'success')
      } else {
        show(`All ${res.skipped} frames already exist for this shift`, 'info')
      }
    } catch(e) {
      show('Insert failed: ' + e.message, 'error')
    } finally {
      setInserting(false)
    }
  }

  const shiftLabel = s => s.replace('SHIFT', 'Shift ')

  const SHORTCUTS = [
    { label: 'Today',     days: 0  },
    { label: 'Yesterday', days: -1 },
    { label: '-2 days',   days: -2 },
    { label: '-3 days',   days: -3 },
    { label: '-7 days',   days: -7 },
  ]

  return (
    <div className="mp">
      {/* Selector */}
      <div className="card admin-selector-card">
        <div className="page-hdr" style={{ borderBottom:'none', paddingBottom:0 }}>
          <div>
            <div className="page-title">Admin Control</div>
            <div className="page-meta">Pre-populate daily working from machine master</div>
          </div>
        </div>

        <div className="admin-selector-body">
          <div className="selector-row-admin">

            {/* Date field with shortcuts */}
            <div className="field-group">
              <label className="flabel">Date</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
              />
              <div className="date-shortcuts">
                {SHORTCUTS.map(({ label, days }) => (
                  <button
                    key={label}
                    type="button"
                    className={`shortcut-btn${date === offsetDate(days) ? ' shortcut-active' : ''}`}
                    onClick={() => setDate(offsetDate(days))}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {date && (
                <div className="date-display">{fmtDateLabel(date)}</div>
              )}
            </div>

            <div className="field-group">
              <label className="flabel">Shift</label>
              <select value={shift} onChange={e => setShift(e.target.value)}>
                {SHIFTS.map(s => <option key={s} value={s}>{shiftLabel(s)}</option>)}
              </select>
            </div>

            <div className="field-group" style={{ flex: 1.5 }}>
              <label className="flabel">Mill</label>
              <select value={mill} onChange={e => setMill(e.target.value)}>
                <option value="">— Select Mill —</option>
                {mills.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            <button
              className="btn-primary"
              onClick={loadPreview}
              disabled={loadingPrev || !mill}
              style={{ alignSelf: 'flex-end' }}
            >
              {loadingPrev ? <><span className="spinner"/>Loading…</> : 'Preview Frames →'}
            </button>
          </div>

          {/* Exists banner */}
          {exists && (
            <div className={`exists-banner ${exists.exists ? 'banner-warn' : 'banner-ok'}`}>
              {exists.exists
                ? `⚠ ${exists.count} records already exist for ${mill} · ${shiftLabel(shift)} · ${date}. Duplicate RF Nos will be skipped.`
                : `✓ No records yet for ${mill} · ${shiftLabel(shift)} · ${date} — ready to insert.`
              }
            </div>
          )}
        </div>
      </div>

      {/* Result card */}
      {result && (
        <div className="card result-card">
          <div className="result-grid">
            <ResultStat label="Inserted"     value={result.inserted}     color={result.inserted > 0 ? 'green' : 'muted'} />
            <ResultStat label="Skipped"      value={result.skipped}      color={result.skipped  > 0 ? 'amber' : 'muted'} />
            <ResultStat label="Total Frames" value={result.total_frames} />
            <div className="result-msg">{result.message}</div>
          </div>
        </div>
      )}

      {/* Preview table */}
      {preview.length > 0 && (
        <div className="card">
          <div className="page-hdr">
            <div>
              <div className="page-title">Frame Preview — {preview.length} frames</div>
              <div className="page-meta">
                {mill} · {shiftLabel(shift)} · {fmtDateLabel(date)} — act_hank &amp; stop_min will be 0
              </div>
            </div>
            <button
              className="btn-success insert-btn"
              onClick={doInsert}
              disabled={inserting}
            >
              {inserting
                ? <><span className="spinner"/>Inserting…</>
                : <>⬇ Insert {preview.length} Frames into Daily Working</>
              }
            </button>
          </div>

          <div className="preview-stats">
            <StatPill label="Total Target KGS"
              value={fmt1(preview.reduce((a, r) => a + (r._c?.targetKgs || 0), 0))} />
            <StatPill label="Avg Std GPS"
              value={fmt2(preview.reduce((a, r) => a + (r._c?.stdGPS || 0), 0) / preview.length)} />
            <StatPill label="Total Spindles"
              value={preview.reduce((a, r) => a + r.no_of_spindles, 0).toLocaleString()} />
          </div>

          <div className="tscroll">
            <table className="ctable">
              <thead>
                <tr>
                  <th>RF No</th>
                  <th>Count</th>
                  <th className="th-r">Spindles</th>
                  <th className="th-r">Spd RPM</th>
                  <th className="th-r">TPI</th>
                  <th className="th-r">Std Hank</th>
                  <th className="th-r">40s Conv</th>
                  <th className="th-r" style={{ color:'var(--indigo-light)' }}>Std GPS</th>
                  <th className="th-r" style={{ color:'var(--indigo-light)' }}>Target KGS</th>
                  <th style={{ color:'var(--emerald)', textAlign:'center' }}>Act Hank</th>
                  <th style={{ color:'var(--emerald)', textAlign:'center' }}>Stop Min</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => (
                  <tr key={i} className="crow">
                    <td><span className="rf-badge">{row.rf_no}</span></td>
                    <td><span className="count-badge">{row.count}</span></td>
                    <td className="td-r mono">{row.no_of_spindles}</td>
                    <td className="td-r mono">{Number(row.spdl_speed).toLocaleString()}</td>
                    <td className="td-r mono">{Number(row.tpi).toFixed(2)}</td>
                    <td className="td-r mono">{Number(row.std_hank).toFixed(4)}</td>
                    <td className="td-r mono">{Number(row.conv_40s).toFixed(3)}</td>
                    <td className="td-r mono" style={{ color:'var(--indigo-light)' }}>{fmt2(row._c?.stdGPS)}</td>
                    <td className="td-r mono" style={{ color:'var(--indigo-light)', fontWeight:600 }}>{fmt2(row._c?.targetKgs)}</td>
                    <td className="td-r"><span className="placeholder-val">0.00 ✏</span></td>
                    <td className="td-r"><span className="placeholder-val">0 ✏</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="table-footer-bar">
            <span className="td-muted" style={{ fontSize:12 }}>
              Records inserted with act_hank=0 and stop_min=0 — operators fill in from Daily Entry page.
            </span>
            <button className="btn-success" onClick={doInsert} disabled={inserting}>
              {inserting ? <><span className="spinner"/>Inserting…</> : `⬇ Insert ${preview.length} Frames`}
            </button>
          </div>
        </div>
      )}

      {!loadingPrev && preview.length === 0 && (
        <div className="empty" style={{ paddingTop:60 }}>
          <div className="empty-icon">
            <svg width="56" height="56" viewBox="0 0 56 56">
              <circle cx="28" cy="28" r="24" stroke="var(--border2)" strokeWidth="1" fill="none"/>
              <path d="M28 18v10l7 4" stroke="var(--indigo)" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
              <circle cx="28" cy="28" r="2" fill="var(--indigo)" opacity=".6"/>
            </svg>
          </div>
          <p>Select <strong>Date · Shift · Mill</strong> then click <strong>Preview Frames</strong></p>
          <p className="empty-hint">
            Use the shortcut buttons or date picker to select any date.<br/>
            Frames load from machine master — operators fill Act Hank and Stop Min from Daily Entry.
          </p>
        </div>
      )}

      <ToastContainer />
    </div>
  )
}

function ResultStat({ label, value, color = '' }) {
  return (
    <div className="result-stat">
      <div className="result-stat-val" style={{
        color: color === 'green' ? 'var(--emerald)' : color === 'amber' ? 'var(--amber)' : 'var(--text3)'
      }}>
        {value}
      </div>
      <div className="result-stat-label">{label}</div>
    </div>
  )
}

function StatPill({ label, value }) {
  return (
    <div className="stat-pill">
      <span className="stat-pill-label">{label}</span>
      <span className="stat-pill-val mono">{value}</span>
    </div>
  )
}
