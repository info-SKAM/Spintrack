import React, { useState, useEffect, useRef } from 'react'
import { api } from '../api.js'
import { useToast } from '../hooks/useToast.jsx'
import './ReportsPage.css'

const todayStr = () => new Date().toISOString().split('T')[0]
const monthAgo = () => {
  const d = new Date(); d.setDate(d.getDate() - 30)
  return d.toISOString().split('T')[0]
}

const REPORT_TYPES = [
  { id: 'date',       label: 'Single Date',  icon: '📅', desc: 'One day, all shifts consolidated' },
  { id: 'date_range', label: 'Date Range',   icon: '📆', desc: 'Custom from/to date range' },
  { id: 'count',      label: 'By Count',     icon: '🧵', desc: 'One count type across dates' },
  { id: 'shift',      label: 'Single Shift', icon: '⏱',  desc: 'One shift — all or one mill' },
  { id: 'mill',       label: 'Single Mill',  icon: '🏭', desc: 'One mill across date range' },
]

const n2  = v => (v == null || isNaN(+v)) ? '—' : Number(v).toFixed(2)
const n1  = v => (v == null || isNaN(+v)) ? '—' : Number(v).toFixed(1)
const n0  = v => (v == null || isNaN(+v)) ? '—' : Math.round(Number(v)).toString()
const pct = v => (v == null || isNaN(+v)) ? '—' : Number(v).toFixed(1) + '%'
const effCls = e => {
  const n = parseFloat(e) || 0
  return n >= 90 ? 'c-green' : n >= 75 ? 'c-amber' : 'c-red'
}

// Compute totals for an array of data rows
function computeTotals(rows) {
  const t = {
    frames_run: 0, frames_installed: 0,
    spls_alloted: 0, spls_worked: 0,
    target_kgs_total: 0, target_kgs_run: 0, actual_kgs: 0,
    woh: 0, mw: 0, clg_lc: 0, er: 0, la_pf: 0, bss: 0, lap: 0, dd: 0,
    stop_total: 0,
    std_gps_sum: 0, actual_gps_sum: 0, avg_speed_sum: 0,
    n: rows.length,
  }
  rows.forEach(r => {
    t.frames_run       += +r.frames_run       || 0
    t.frames_installed += +r.frames_installed || 0
    t.spls_alloted     += +r.spls_alloted     || 0
    t.spls_worked      += +r.spls_worked      || 0
    t.target_kgs_total += +r.target_kgs_total || 0
    t.target_kgs_run   += +r.target_kgs_run   || 0
    t.actual_kgs       += +r.actual_kgs       || 0
    t.woh    += +r.woh    || 0; t.mw  += +r.mw    || 0
    t.clg_lc += +r.clg_lc || 0; t.er += +r.er     || 0
    t.la_pf  += +r.la_pf  || 0; t.bss+= +r.bss    || 0
    t.lap    += +r.lap    || 0; t.dd += +r.dd     || 0
    t.stop_total       += +r.stop_total       || 0
    t.std_gps_sum      += +r.std_gps_avg      || 0
    t.actual_gps_sum   += +r.actual_gps_avg   || 0
    t.avg_speed_sum    += +r.avg_speed        || 0
  })
  t.uti_pct       = t.spls_alloted > 0 ? t.spls_worked / t.spls_alloted * 100 : 0
  t.eff_pct_run   = t.target_kgs_run > 0 ? t.actual_kgs / t.target_kgs_run * 100 : 0
  t.target_prod_spl = t.spls_alloted > 0 ? t.target_kgs_total * 1000 / t.spls_alloted : 0
  t.actual_prod_spl = t.spls_worked  > 0 ? t.actual_kgs * 1000 / t.spls_worked : 0
  t.std_gps_avg   = t.n > 0 ? t.std_gps_sum / t.n : 0
  t.actual_gps_avg= t.n > 0 ? t.actual_gps_sum / t.n : 0
  t.avg_speed     = t.n > 0 ? t.avg_speed_sum / t.n : 0
  return t
}

export default function ReportsPage() {
  const [options,    setOptions]   = useState({ mills:[], counts:[], shifts:[], dates:[] })
  const [rtype,      setRtype]     = useState('date')
  const [date,       setDate]      = useState(todayStr())
  const [fromDate,   setFromDate]  = useState(monthAgo())
  const [toDate,     setToDate]    = useState(todayStr())
  const [shift,      setShift]     = useState('ALL')
  const [mill,       setMill]      = useState('ALL')
  const [count,      setCount]     = useState('ALL')
  const [data,       setData]      = useState([])
  const [loading,    setLoading]   = useState(false)
  const [generating, setGenerating]= useState(false)
  const [reportLabel,setReportLabel]=useState('')
  const printRef = useRef()
  const { show, ToastContainer } = useToast()

  useEffect(() => {
    api.getReportOptions().then(setOptions).catch(() => {})
  }, [])

  const buildParams = () => {
    const p = {}
    if (rtype === 'date')       { p.date = date }
    if (rtype === 'date_range') { p.from_date = fromDate; p.to_date = toDate }
    if (rtype === 'count')      { p.from_date = fromDate; p.to_date = toDate; if (count !== 'ALL') p.count = count }
    if (rtype === 'shift')      { p.date = date; if (shift !== 'ALL') p.shift = shift }
    if (rtype === 'mill')       { p.from_date = fromDate; p.to_date = toDate; if (mill !== 'ALL') p.mill = mill }
    if (shift !== 'ALL' && rtype !== 'shift') p.shift = shift
    if (mill  !== 'ALL' && rtype !== 'mill')  p.mill  = mill
    return p
  }

  const buildLabel = () => {
    const rt = REPORT_TYPES.find(r => r.id === rtype)?.label || ''
    const d  = rtype === 'date' || rtype === 'shift' ? date : `${fromDate} → ${toDate}`
    const s  = shift !== 'ALL' ? ` · ${shift.replace('SHIFT','Shift ')}` : ''
    const m  = mill  !== 'ALL' ? ` · ${mill}` : ''
    const c  = count !== 'ALL' ? ` · ${count}` : ''
    return `${rt}: ${d}${s}${m}${c}`
  }

  const runReport = async () => {
    setLoading(true)
    try {
      const rows = await api.getReportData(buildParams())
      setData(rows)
      setReportLabel(buildLabel())
      if (!rows.length) show('No data found for selected filters', 'info')
      else show(`Report loaded — ${rows.length} count rows`)
    } catch(e) { show('Error: ' + e.message, 'error') }
    finally { setLoading(false) }
  }

  const downloadPDF = async () => {
    setGenerating(true)
    try {
      const p = { ...buildParams(), report_type: REPORT_TYPES.find(r=>r.id===rtype)?.label || 'Standard' }
      const url = api.getReportPdfUrl(p)
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to generate PDF')
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `SpinTrack_${p.date || p.from_date || 'report'}.pdf`
      a.click()
      show('PDF downloaded')
    } catch(e) { show('PDF failed: ' + e.message, 'error') }
    finally { setGenerating(false) }
  }

  const printReport = () => {
    window.print()
  }

  // Group by mill
  const mills = [...new Set(data.map(r => r.mill))]
  const grandTotals = computeTotals(data)

  return (
    <div className="rp">
      {/* ── Filter sidebar ── */}
      <div className="rp-layout">
        <aside className="rp-sidebar card">
          <div className="sidebar-title">Report Builder</div>

          <div className="sidebar-section">
            <div className="sidebar-label">Report Type</div>
            <div className="rtype-list">
              {REPORT_TYPES.map(rt => (
                <button key={rt.id}
                  className={`rtype-btn${rtype === rt.id ? ' rtype-active' : ''}`}
                  onClick={() => setRtype(rt.id)}>
                  <span>{rt.icon} {rt.label}</span>
                  <span className="rtype-desc-inline">{rt.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="sidebar-section">
            <div className="sidebar-label">Date</div>
            {(rtype === 'date' || rtype === 'shift') && (
              <div className="field-group">
                <label className="flabel">Date</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} />
              </div>
            )}
            {(rtype === 'date_range' || rtype === 'count' || rtype === 'mill') && (
              <>
                <div className="field-group" style={{marginBottom:6}}>
                  <label className="flabel">From</label>
                  <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
                </div>
                <div className="field-group">
                  <label className="flabel">To</label>
                  <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
                </div>
              </>
            )}
          </div>

          <div className="sidebar-section">
            <div className="sidebar-label">Filters</div>
            <div className="field-group" style={{marginBottom:6}}>
              <label className="flabel">Shift</label>
              <select value={shift} onChange={e => setShift(e.target.value)}>
                <option value="ALL">All Shifts</option>
                {options.shifts.map(s => <option key={s} value={s}>{s.replace('SHIFT','Shift ')}</option>)}
              </select>
            </div>
            <div className="field-group" style={{marginBottom:6}}>
              <label className="flabel">Mill</label>
              <select value={mill} onChange={e => setMill(e.target.value)}>
                <option value="ALL">All Mills</option>
                {options.mills.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="field-group">
              <label className="flabel">Count</label>
              <select value={count} onChange={e => setCount(e.target.value)}>
                <option value="ALL">All Counts</option>
                {options.counts.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="sidebar-actions">
            <button className="btn-primary" onClick={runReport} disabled={loading} style={{width:'100%'}}>
              {loading ? <><span className="spinner"/>Loading…</> : '▶ Run Report'}
            </button>
            {data.length > 0 && (<>
              <button className="btn-ghost" onClick={printReport} style={{width:'100%'}}>
                🖨 Print / Save PDF
              </button>
              <button className="btn-success" onClick={downloadPDF} disabled={generating} style={{width:'100%'}}>
                {generating ? <><span className="spinner"/>Generating…</> : '⬇ Download PDF'}
              </button>
            </>)}
          </div>
        </aside>

        {/* ── Report view ── */}
        <div className="rp-main">
          {data.length > 0 ? (
            <div className="card report-card" ref={printRef}>

              {/* Report header */}
              <div className="report-hdr">
                <div className="report-title">PRODUCTION REPORT</div>
                <div className="report-subtitle">{reportLabel}</div>
                <div className="report-actions no-print">
                  <button className="btn-ghost btn-sm" onClick={printReport}>🖨 Print</button>
                  <button className="btn-success btn-sm" onClick={downloadPDF} disabled={generating}>
                    {generating ? <><span className="spinner"/>…</> : '⬇ PDF'}
                  </button>
                </div>
              </div>

              {/* Grand summary strip */}
              <div className="grand-strip">
                <StripStat label="Mills"        value={mills.length} />
                <StripStat label="Count Types"  value={data.length} />
                <StripStat label="Frames Run"   value={n0(grandTotals.frames_run)} />
                <StripStat label="Target KGS"   value={n1(grandTotals.target_kgs_total)} mono />
                <StripStat label="Actual KGS"   value={n1(grandTotals.actual_kgs)} mono />
                <StripStat label="Overall Eff"  value={pct(grandTotals.eff_pct_run)}
                  color={effCls(grandTotals.eff_pct_run)} />
                <StripStat label="Total Stop"   value={n0(grandTotals.stop_total) + ' min'} />
                <StripStat label="Avg Spd"      value={n0(grandTotals.avg_speed)} mono />
              </div>

              {/* Full data table */}
              <div className="full-tscroll">
                <table className="full-table">
                  <thead>
                    <tr>
                      <th rowSpan={2} className="th-l th-mill">Mill</th>
                      <th rowSpan={2} className="th-l">Count</th>
                      <th rowSpan={2}>Avg<br/>Count</th>
                      <th colSpan={2} className="th-group">Frames</th>
                      <th colSpan={3} className="th-group">Spindles</th>
                      <th colSpan={4} className="th-group th-group-kgs">KGS & Efficiency</th>
                      <th colSpan={9} className="th-group th-group-stop">Stop Minutes</th>
                      <th colSpan={2} className="th-group">Prod/Spl (g)</th>
                      <th rowSpan={2}>Avg<br/>Speed</th>
                      <th rowSpan={2}>40s<br/>Tgt g</th>
                      <th colSpan={2} className="th-group">GPS (avg)</th>
                    </tr>
                    <tr>
                      <th>Run</th><th>Inst</th>
                      <th>Alloted</th><th>Worked</th><th>Uti %</th>
                      <th>Target<br/>(Total)</th><th>Target<br/>(Run)</th><th>Actual</th><th>Eff %</th>
                      <th>WOH</th><th>MW</th><th>CLG<br/>LC</th><th>ER</th>
                      <th>LA<br/>PF</th><th>BSS</th><th>LAP</th><th>DD</th><th>Total</th>
                      <th>Target</th><th>Actual</th>
                      <th>Std</th><th>Actual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mills.map(millName => {
                      const millRows = data.filter(r => r.mill === millName)
                      const mt = computeTotals(millRows)
                      return (
                        <React.Fragment key={millName}>
                          {/* Data rows */}
                          {millRows.map((r, i) => (
                            <tr key={i} className={`dr ${i % 2 === 1 ? 'dr-alt' : ''}`}>
                              <td className="th-l">
                                {i === 0 && <span className="mill-tag">{millName}</span>}
                              </td>
                              <td className="th-l"><span className="cnt-tag">{r.count}</span></td>
                              <td className="mono">{n1(r.avg_count)}</td>
                              <td className="mono">{n0(r.frames_run)}</td>
                              <td className="mono">{n0(r.frames_installed)}</td>
                              <td className="mono">{n0(r.spls_alloted)}</td>
                              <td className="mono">{n1(r.spls_worked)}</td>
                              <td className="mono">{pct(r.uti_pct)}</td>
                              <td className="mono fw6">{n1(r.target_kgs_total)}</td>
                              <td className="mono">{n1(r.target_kgs_run)}</td>
                              <td className="mono fw6">{n1(r.actual_kgs)}</td>
                              <td className={`mono fw6 ${effCls(r.eff_pct_run)}`}>{pct(r.eff_pct_run)}</td>
                              <td className="mono">{n0(r.woh)}</td>
                              <td className="mono">{n0(r.mw)}</td>
                              <td className="mono">{n0(r.clg_lc)}</td>
                              <td className="mono">{n0(r.er)}</td>
                              <td className="mono">{n0(r.la_pf)}</td>
                              <td className="mono">{n0(r.bss)}</td>
                              <td className="mono">{n0(r.lap)}</td>
                              <td className="mono">{n0(r.dd)}</td>
                              <td className={`mono ${(+r.stop_total||0)>0?'c-amber':''}`}>{n0(r.stop_total)}</td>
                              <td className="mono">{n2(r.target_prod_spl)}</td>
                              <td className="mono">{n2(r.actual_prod_spl)}</td>
                              <td className="mono">{n0(r.avg_speed)}</td>
                              <td className="mono">{n2(r.target_40s)}</td>
                              <td className="mono">{n2(r.std_gps_avg)}</td>
                              <td className="mono">{n2(r.actual_gps_avg)}</td>
                            </tr>
                          ))}

                          {/* Mill total row */}
                          <tr className="mill-total">
                            <td className="th-l fw6" colSpan={2}>
                              <span className="total-label">TOTAL {millName}</span>
                            </td>
                            <td></td>
                            <td className="mono fw6">{n0(mt.frames_run)}</td>
                            <td className="mono fw6">{n0(mt.frames_installed)}</td>
                            <td className="mono fw6">{n0(mt.spls_alloted)}</td>
                            <td className="mono fw6">{n1(mt.spls_worked)}</td>
                            <td className={`mono fw6 ${effCls(mt.uti_pct)}`}>{pct(mt.uti_pct)}</td>
                            <td className="mono fw6">{n1(mt.target_kgs_total)}</td>
                            <td className="mono fw6">{n1(mt.target_kgs_run)}</td>
                            <td className="mono fw6">{n1(mt.actual_kgs)}</td>
                            <td className={`mono fw6 ${effCls(mt.eff_pct_run)}`}>{pct(mt.eff_pct_run)}</td>
                            <td className="mono">{n0(mt.woh)}</td>
                            <td className="mono">{n0(mt.mw)}</td>
                            <td className="mono">{n0(mt.clg_lc)}</td>
                            <td className="mono">{n0(mt.er)}</td>
                            <td className="mono">{n0(mt.la_pf)}</td>
                            <td className="mono">{n0(mt.bss)}</td>
                            <td className="mono">{n0(mt.lap)}</td>
                            <td className="mono">{n0(mt.dd)}</td>
                            <td className={`mono fw6 ${mt.stop_total>0?'c-amber':''}`}>{n0(mt.stop_total)}</td>
                            <td className="mono fw6">{n2(mt.target_prod_spl)}</td>
                            <td className="mono fw6">{n2(mt.actual_prod_spl)}</td>
                            <td className="mono">{n0(mt.avg_speed)}</td>
                            <td></td>
                            <td className="mono">{n2(mt.std_gps_avg)}</td>
                            <td className="mono">{n2(mt.actual_gps_avg)}</td>
                          </tr>
                        </React.Fragment>
                      )
                    })}

                    {/* Grand total row */}
                    {mills.length > 0 && (
                      <tr className="grand-total">
                        <td className="th-l fw6" colSpan={2}>
                          <span className="grand-label">GRAND TOTAL</span>
                        </td>
                        <td></td>
                        <td className="mono fw6">{n0(grandTotals.frames_run)}</td>
                        <td className="mono fw6">{n0(grandTotals.frames_installed)}</td>
                        <td className="mono fw6">{n0(grandTotals.spls_alloted)}</td>
                        <td className="mono fw6">{n1(grandTotals.spls_worked)}</td>
                        <td className={`mono fw6 ${effCls(grandTotals.uti_pct)}`}>{pct(grandTotals.uti_pct)}</td>
                        <td className="mono fw6">{n1(grandTotals.target_kgs_total)}</td>
                        <td className="mono fw6">{n1(grandTotals.target_kgs_run)}</td>
                        <td className="mono fw6">{n1(grandTotals.actual_kgs)}</td>
                        <td className={`mono fw6 ${effCls(grandTotals.eff_pct_run)}`}>{pct(grandTotals.eff_pct_run)}</td>
                        <td className="mono">{n0(grandTotals.woh)}</td>
                        <td className="mono">{n0(grandTotals.mw)}</td>
                        <td className="mono">{n0(grandTotals.clg_lc)}</td>
                        <td className="mono">{n0(grandTotals.er)}</td>
                        <td className="mono">{n0(grandTotals.la_pf)}</td>
                        <td className="mono">{n0(grandTotals.bss)}</td>
                        <td className="mono">{n0(grandTotals.lap)}</td>
                        <td className="mono">{n0(grandTotals.dd)}</td>
                        <td className={`mono fw6 ${grandTotals.stop_total>0?'c-amber':''}`}>{n0(grandTotals.stop_total)}</td>
                        <td className="mono fw6">{n2(grandTotals.target_prod_spl)}</td>
                        <td className="mono fw6">{n2(grandTotals.actual_prod_spl)}</td>
                        <td className="mono">{n0(grandTotals.avg_speed)}</td>
                        <td></td>
                        <td className="mono">{n2(grandTotals.std_gps_avg)}</td>
                        <td className="mono">{n2(grandTotals.actual_gps_avg)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="report-footer no-print">
                <span>Generated {new Date().toLocaleString()}</span>
                <span>SpinTrack Production Management</span>
              </div>
            </div>
          ) : (
            <div className="card empty-card">
              <div className="empty-inner">
                <div className="empty-icon">
                  <svg width="56" height="56" viewBox="0 0 56 56">
                    <rect x="8" y="6" width="40" height="44" rx="4" stroke="var(--border2)" strokeWidth="1" fill="none"/>
                    <line x1="16" y1="18" x2="40" y2="18" stroke="var(--indigo)" strokeWidth="1.2"/>
                    <line x1="16" y1="25" x2="40" y2="25" stroke="var(--border3)" strokeWidth="1"/>
                    <line x1="16" y1="32" x2="32" y2="32" stroke="var(--border3)" strokeWidth="1"/>
                    <line x1="16" y1="39" x2="28" y2="39" stroke="var(--border3)" strokeWidth="1"/>
                  </svg>
                </div>
                <p>Select report type &amp; filters, then click <strong>Run Report</strong></p>
                <p className="hint">
                  5 report types · All 27 columns matching your standard report format<br/>
                  Mill subtotals · Grand total · Print or download as PDF
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
      <ToastContainer />
    </div>
  )
}

function StripStat({ label, value, mono, color }) {
  return (
    <div className="strip-stat">
      <div className="strip-label">{label}</div>
      <div className={`strip-value${mono ? ' mono' : ''}${color ? ` ${color}` : ''}`}>{value}</div>
    </div>
  )
}
