import React, { useState, useEffect, useCallback } from 'react'
import { api } from '../api.js'
import { calcRow, shiftSummary, fmt1, fmt2, fmt4 } from '../utils/formulas.js'
import { sortByRfNo } from '../utils/naturalSort.js'
import { useToast } from '../hooks/useToast.jsx'
import './EntryPage.css'

const SHIFTS     = ['SHIFT1','SHIFT2','SHIFT3']
const STOP_KEYS  = ['woh','mw','clg_lc','er','la_pf','bss','lap','dd']
const STOP_LABEL = { woh:'W.O.H', mw:'MW', clg_lc:'CLG/LC', er:'ER', la_pf:'LA,PF', bss:'BSS', lap:'LAP', dd:'DD' }

const todayStr = () => new Date().toISOString().split('T')[0]
let _tid = 0
const uid = () => `r${++_tid}`

function fromDB(r, conv_factor = 0, conv_40s = 1) {
  return recompute({
    _id: r.id || uid(), _db_id: r.id, _from_db: true,
    rf_no: r.rf_no, count: r.count,
    no_of_spindles: r.spindles_installed,
    spdl_speed: r.spdl_speed, tpi: r.tpi, std_hank: r.std_hank,
    conv_factor: r.conv_factor ?? conv_factor,
    conv_40s:    r.conv_40s    ?? conv_40s,
    act_hank:   r.act_hank   ?? '',
    pne_bondas: r.pne_bondas ?? '',
    woh: r.woh??'', mw: r.mw??'', clg_lc: r.clg_lc??'',
    er: r.er??'', la_pf: r.la_pf??'', bss: r.bss??'',
    lap: r.lap??'', dd: r.dd??'',
  })
}

function fromFrame(f) {
  return recompute({
    _id: uid(), _db_id: null, _from_db: false, ...f,
    conv_factor: f.conv_factor ?? 0,
    conv_40s:    f.conv_40s    ?? 1,
    act_hank: '', pne_bondas: '',
    woh:'', mw:'', clg_lc:'', er:'', la_pf:'', bss:'', lap:'', dd:'',
  })
}

function recompute(row) {
  return {
    ...row,
    _c: calcRow({
      no_of_spindles: row.no_of_spindles,
      std_hank:       row.std_hank,
      act_hank:       parseFloat(row.act_hank)    || 0,
      stop_min:       parseFloat(row.stop_min)    || 0,
      pne_bondas:     parseFloat(row.pne_bondas)  || 0,
      conv_factor:    parseFloat(row.conv_factor) || 0,
      conv_40s:       parseFloat(row.conv_40s)    || 1,
      woh:    parseFloat(row.woh)    || 0,
      mw:     parseFloat(row.mw)     || 0,
      clg_lc: parseFloat(row.clg_lc) || 0,
      er:     parseFloat(row.er)     || 0,
      la_pf:  parseFloat(row.la_pf)  || 0,
      bss:    parseFloat(row.bss)    || 0,
      lap:    parseFloat(row.lap)    || 0,
      dd:     parseFloat(row.dd)     || 0,
    }),
  }
}

export default function EntryPage() {
  const [date,       setDate]       = useState(todayStr())
  const [shift,      setShift]      = useState('SHIFT1')
  const [mill,       setMill]       = useState('')
  const [mills,      setMills]      = useState([])
  const [rows,       setRows]       = useState([])
  const [loading,    setLoading]    = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [loaded,     setLoaded]     = useState(false)
  const [mode,       setMode]       = useState('new')
  const [stopOpen,   setStopOpen]   = useState(null)
  const [editIdx,    setEditIdx]    = useState(null)
  const [delConfirm, setDelConfirm] = useState(null)
  const [filterRF,   setFilterRF]   = useState('')
  const [filterCount,setFilterCount]= useState('')
  const [filterEff,  setFilterEff]  = useState('')
  const [dupWarning, setDupWarning] = useState(null)  // { count, date, shift, mill }
  const [dedupRunning, setDedupRunning] = useState(false)
  const [freezeRF,   setFreezeRF]   = useState(true)
  const { show, ToastContainer } = useToast()

  useEffect(() => {
    api.getMills().then(setMills).catch(e => show('Could not load mills: ' + e.message, 'error'))
  }, [])

  useEffect(() => {
    setRows([]); setLoaded(false); setStopOpen(null)
    setEditIdx(null); setDelConfirm(null)
    setFilterRF(''); setFilterCount(''); setFilterEff('')
    setDupWarning(null)
  }, [date, shift, mill])

  const loadFrames = async () => {
    if (!mill) { show('Select a mill first', 'error'); return }
    setLoading(true)
    try {
      // Single call — replaces checkShiftExists + getDailyWorking + getFrames
      const res = await api.loadShift(date, shift, mill)
      const { frames, existing, exists } = res

      if (exists) {
        const cfMap = Object.fromEntries(
          frames.map(f => [f.rf_no, { conv_factor: f.conv_factor||0, conv_40s: f.conv_40s||1 }])
        )
        const sorted = sortByRfNo(existing)
        setRows(sorted.map(r => fromDB(r, cfMap[r.rf_no]?.conv_factor||0, cfMap[r.rf_no]?.conv_40s||1)))
        setMode('db')
        const rfNos = existing.map(r => r.rf_no)
        const unique = new Set(rfNos)
        if (rfNos.length > unique.size) {
          setDupWarning({ count: rfNos.length - unique.size, date, shift, mill })
          show(`⚠ ${rfNos.length - unique.size} duplicates detected`, 'error')
        } else {
          setDupWarning(null)
          show(`Loaded ${existing.length} frames from DB`, 'info')
        }
      } else {
        setRows(sortByRfNo(frames).map(fromFrame))
        setMode('new')
        setDupWarning(null)
        show(`Loaded ${frames.length} frames from machine master`)
      }
      setLoaded(true); setStopOpen(null); setEditIdx(null); setDelConfirm(null)
    } catch(e) {
      show('Failed to load: ' + e.message, 'error')
    } finally { setLoading(false) }
  }

  const updateField = useCallback((idx, field, val) => {
    setRows(prev => {
      const next = [...prev]
      next[idx] = recompute({ ...next[idx], [field]: val })
      return next
    })
  }, [])

  const buildPayload = (r) => ({
    conv_factor: parseFloat(r.conv_factor)||0, conv_40s: parseFloat(r.conv_40s)||1,
    act_hank:   parseFloat(r.act_hank)  ||0,
    stop_min:   parseFloat(r.stop_min)  ||0,
    pne_bondas: parseFloat(r.pne_bondas)||0,
    woh: parseFloat(r.woh)||0, mw: parseFloat(r.mw)||0, clg_lc: parseFloat(r.clg_lc)||0,
    er: parseFloat(r.er)||0, la_pf: parseFloat(r.la_pf)||0, bss: parseFloat(r.bss)||0,
    lap: parseFloat(r.lap)||0, dd: parseFloat(r.dd)||0,
  })

  const saveShift = async () => {
    if (!rows.length) { show('No data to save', 'error'); return }
    setSaving(true)
    try {
      if (mode === 'db') {
        // DB mode — bulk update all rows in ONE request
        const rowsToUpdate = rows
          .filter(r => r._db_id)
          .map(r => ({ id: r._db_id, ...buildPayload(r) }))
        const result = await api.updateAll({ rows: rowsToUpdate })
        show(`✓ Updated ${result.updated} records in Neon DB`)
      } else {
        // New mode — check for duplicates first
        const chk = await api.checkShiftExists(date, shift, mill)
        if (chk.exists) {
          show(
            `⚠ ${chk.count} records already exist for ${mill} · ${shift.replace('SHIFT','Shift ')} · ${date}. ` +
            `Load Frames first to edit existing records instead of saving duplicates.`,
            'error'
          )
          setSaving(false)
          return
        }
        const entries = rows.map(r => ({
          temp_id: r._id, rf_no: r.rf_no, count: r.count,
          no_of_spindles: r.no_of_spindles, spdl_speed: r.spdl_speed,
          tpi: r.tpi, std_hank: r.std_hank, ...buildPayload(r),
        }))
        const result = await api.saveShift({ date, shift, mill, entries })
        show(`✓ Saved ${result.saved} records to Neon DB`)
      }
    } catch(e) { show('Save failed: ' + e.message, 'error') }
    finally { setSaving(false) }
  }

  const saveSingleRow = async (idx) => {
    const r = rows[idx]
    try {
      if (r._db_id) { await api.patchRow(r._db_id, buildPayload(r)); show(`✓ RF ${r.rf_no} updated`) }
      setEditIdx(null)
    } catch(e) { show('Update failed: ' + e.message, 'error') }
  }

  const deleteRow = async (idx) => {
    const r = rows[idx]
    try {
      if (r._db_id) { await api.deleteRow(r._db_id); show(`RF ${r.rf_no} deleted`) }
      setRows(prev => prev.filter((_,i) => i !== idx))
      setDelConfirm(null); if (editIdx === idx) setEditIdx(null)
    } catch(e) { show('Delete failed: ' + e.message, 'error') }
  }

  const filtered = rows.filter(r => {
    if (filterRF    && !r.rf_no?.toLowerCase().includes(filterRF.toLowerCase()))    return false
    if (filterCount && !r.count?.toLowerCase().includes(filterCount.toLowerCase())) return false
    if (filterEff) {
      const eff = r._c?.effPct || 0
      if (filterEff === 'good' && eff < 90)               return false
      if (filterEff === 'warn' && (eff < 75 || eff >= 90)) return false
      if (filterEff === 'bad'  && eff >= 75)              return false
    }
    return true
  })

  const summ     = shiftSummary(rows)
  const fixDuplicates = async () => {
    if (!dupWarning) return
    setDedupRunning(true)
    try {
      const result = await api.fixDuplicates(dupWarning.date, dupWarning.shift, dupWarning.mill)
      show(`✓ Removed ${result.deleted} duplicate records across ${result.rf_nos_fixed} RF Nos — reloading…`, 'success')
      setDupWarning(null)
      await loadFrames()
    } catch(e) {
      show('Dedup failed: ' + e.message, 'error')
    } finally {
      setDedupRunning(false)
    }
  }

  const effColor = e => e >= 90 ? 'green' : e >= 75 ? 'amber' : 'red'
  const hasFilters = filterRF || filterCount || filterEff

  return (
    <div className="ep">
      {/* Selector */}
      <div className="card selector-card">
        <div className="selector-row">
          <div className="field-group">
            <label className="flabel">Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="field-group">
            <label className="flabel">Shift</label>
            <select value={shift} onChange={e => setShift(e.target.value)}>
              {SHIFTS.map(s => <option key={s} value={s}>{s.replace('SHIFT','Shift ')}</option>)}
            </select>
          </div>
          <div className="field-group" style={{ flex:1.5 }}>
            <label className="flabel">Mill</label>
            <select value={mill} onChange={e => setMill(e.target.value)}>
              <option value="">— Select Mill —</option>
              {mills.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <button className="btn-primary" onClick={loadFrames} disabled={loading||!mill} style={{alignSelf:'flex-end'}}>
            {loading ? <><span className="spinner"/>Loading…</> : 'Load Frames →'}
          </button>
        </div>
      </div>

      {/* Summary */}
      {loaded && rows.length > 0 && (
        <div className="summary-bar">
          <div className="mode-badge-wrap">
            {mode==='db'
              ? <span className="mode-badge mode-db">⬤ Loaded from DB — updating existing records</span>
              : <span className="mode-badge mode-new">⬤ New shift — will save fresh records</span>}
          </div>
          <div className="sum-cards">
            <SumCard label="Frames (Running)"  value={`${summ.runningFrames} / ${rows.length}`} />
            <SumCard label="Target KGS (All)"  value={fmt2(summ.totalTarget)} mono />
            <SumCard label="Target KGS (Run)"  value={fmt2(summ.totalTargetRun)} mono color="cyan" />
            <SumCard label="Actual Prdn"        value={fmt2(summ.totalActual)} mono />
            <SumCard label="Efficiency (Run)"   value={summ.eff + '%'} color={effColor(summ.eff)} />
            <SumCard label="Total Stop"         value={summ.totalStop + ' min'} mono />
          </div>
          <button className="btn-success save-btn" onClick={saveShift} disabled={saving}>
            {saving ? <><span className="spinner"/>Saving…</> : mode==='db' ? '💾 Update All' : '💾 Save All'}
          </button>
        </div>
      )}

      {/* Duplicate warning banner */}
      {dupWarning && (
        <div className="dup-warning-banner">
          <span>⚠ {dupWarning.count} duplicate RF No records detected for {dupWarning.mill} · {dupWarning.shift.replace('SHIFT','Shift ')} · {dupWarning.date}</span>
          <button className="btn-danger-sm" onClick={fixDuplicates} disabled={dedupRunning}>
            {dedupRunning ? <><span className="spinner"/>Fixing…</> : '🔧 Fix Duplicates'}
          </button>
        </div>
      )}

      {/* Filters */}
      {loaded && rows.length > 0 && (
        <div className="card filter-bar">
          <div className="filter-bar-inner">
            <div className="filter-field">
              <label className="flabel">RF No</label>
              <input placeholder="e.g. B1…" value={filterRF}
                onChange={e => setFilterRF(e.target.value)} style={{height:34,fontSize:12}} />
            </div>
            <div className="filter-field">
              <label className="flabel">Count</label>
              <input placeholder="e.g. 40SPSF…" value={filterCount}
                onChange={e => setFilterCount(e.target.value)} style={{height:34,fontSize:12}} />
            </div>
            <div className="filter-field">
              <label className="flabel">Efficiency</label>
              <select value={filterEff} onChange={e => setFilterEff(e.target.value)} style={{height:34,fontSize:12}}>
                <option value="">All</option>
                <option value="good">≥ 90% Good</option>
                <option value="warn">75–89% Warning</option>
                <option value="bad">Below 75%</option>
              </select>
            </div>
            {hasFilters && (
              <button className="btn-ghost" style={{alignSelf:'flex-end',height:34}}
                onClick={() => { setFilterRF(''); setFilterCount(''); setFilterEff('') }}>
                ✕ Clear
              </button>
            )}
            {hasFilters && <span className="filter-count">Showing {filtered.length} of {rows.length}</span>}
          </div>
        </div>
      )}

      {/* Table */}
      {loaded && rows.length > 0 ? (
        <div className="card table-card">
          <div className="legend-row">
            <span className="leg leg-auto">Auto — machine master</span>
            <span className="leg leg-input">✏ Your entry</span>
            <span className="leg leg-calc">⟳ Calculated live</span>
            {mode==='db' && <span className="leg leg-db">From DB</span>}
            <button
              className={`freeze-btn${freezeRF?' freeze-active':''}`}
              onClick={() => setFreezeRF(f => !f)}
              title="Freeze/unfreeze RF No column while scrolling"
            >
              {freezeRF ? '📌 RF Frozen' : '📌 Freeze RF'}
            </button>
          </div>

          <div className="tscroll">
            <table className="etable">
              <thead>
                <tr>
                  <th className={`th-left${freezeRF?' th-sticky':''}`}>RF No</th>
                  <th className="th-left">Count</th>
                  <th>Spindles</th>
                  <th>Spd RPM</th>
                  <th>TPI</th>
                  <th>Std Hank</th>
                  <th className="th-input">Act Hank ✏</th>
                  <th className="th-input">Pne Bondas ✏</th>
                  <th className="th-stop">Stops ✏</th>
                  <th className="th-calc">Tot Stop</th>
                  <th className="th-calc">Worked Spls</th>
                  <th className="th-calc">Target KGS</th>
                  <th className="th-calc">Prodn KGS</th>
                  <th className="th-calc">Waste %</th>
                  <th className="th-calc">Actual Prdn</th>
                  <th className="th-calc">Std GPS</th>
                  <th className="th-calc">Act GPS</th>
                  <th className="th-calc">Diff ±</th>
                  <th className="th-calc">40s GPS</th>
                  <th className="th-calc">Eff %</th>
                  <th className="th-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={21} style={{textAlign:'center',padding:'32px',color:'var(--text3)'}}>
                    No frames match your filters
                  </td></tr>
                )}
                {filtered.map((row) => {
                  const realIdx = rows.indexOf(row)
                  const c       = row._c || {}
                  const isOpen  = stopOpen   === realIdx
                  const isEdit  = editIdx    === realIdx
                  const isDel   = delConfirm === realIdx
                  const diffPos = (c.diff || 0) >= 0

                  return (
                    <React.Fragment key={row._id}>
                      <tr className={`drow${isOpen?' drow-expanded':''}${row._from_db?' drow-db':''}${isEdit?' drow-editing':''}`}>
                        <td className={`td-left${freezeRF?' td-sticky':''}`}><span className="rf-badge">{row.rf_no}</span></td>
                        <td className="td-left td-muted">{row.count}</td>
                        <td className="td-muted mono">{row.no_of_spindles}</td>
                        <td className="td-muted mono">{Number(row.spdl_speed).toLocaleString()}</td>
                        <td className="td-muted mono">{Number(row.tpi).toFixed(2)}</td>
                        <td className="td-muted mono">{Number(row.std_hank).toFixed(4)}</td>

                        <td className="td-inp">
                          <input type="number" step="0.01" min="0" placeholder="0.00"
                            value={row.act_hank}
                            onChange={e => updateField(realIdx,'act_hank',e.target.value)}
                            className="inp-num inp-green" />
                        </td>

                        <td className="td-inp">
                          <input type="number" step="0.01" min="0" placeholder="0.00"
                            value={row.pne_bondas}
                            onChange={e => updateField(realIdx,'pne_bondas',e.target.value)}
                            className="inp-num inp-green" title="Wastage KG" />
                        </td>

                        {/* Stops toggle — right after Pne Bondas */}
                        <td className="td-inp">
                          <button className={`stop-toggle${isOpen?' stop-toggle-open':''}`}
                            onClick={() => setStopOpen(isOpen?null:realIdx)} title="Expand stop breakdown">
                            {STOP_KEYS.map(k=>(row[k]&&row[k]!=='')?'●':'○').join(' ')}
                          </button>
                        </td>
                        <td className={`td-calc mono${(c.totalStop||0)>0?' val-amber':''}`}>
                          {c.totalStop||0}
                        </td>

                        <td className="td-calc mono">{fmt1(c.workedSpindles)}</td>
                        <td className="td-calc mono fw6">{fmt4(c.targetKgs)}</td>
                        <td className="td-calc mono">{fmt4(c.prodnKgs)}</td>
                        <td className={`td-calc mono${(c.wastePct||0)>0?' val-amber':''}`}>{fmt2(c.wastePct)}%</td>
                        <td className="td-calc mono fw6">{fmt4(c.actualPrdn)}</td>
                        <td className="td-muted mono">{fmt4(c.stdGPS)}</td>
                        <td className="td-calc mono">{fmt4(c.actualGPS)}</td>
                        <td className={`td-calc mono ${diffPos?'val-green':'val-red'}`}>
                          {c.diff!=null?(diffPos?'+':'')+fmt4(c.diff):'—'}
                        </td>
                        <td className="td-calc mono">{fmt4(c.con40sGps)}</td>
                        <td>
                          <span className={`badge badge-${effColor(c.effPct||0)}`}>
                            {fmt2(c.effPct)}%
                          </span>
                        </td>

                        <td className="td-actions">
                          {isDel ? (
                            <div className="del-confirm-inline">
                              <button className="act-btn act-del-yes" onClick={()=>deleteRow(realIdx)}>Delete?</button>
                              <button className="act-btn act-cancel"  onClick={()=>setDelConfirm(null)}>No</button>
                            </div>
                          ) : isEdit ? (
                            <div className="act-btns-row">
                              <button className="act-btn act-save"   onClick={()=>saveSingleRow(realIdx)}>✓</button>
                              <button className="act-btn act-cancel" onClick={()=>setEditIdx(null)}>✕</button>
                            </div>
                          ) : (
                            <div className="act-btns-row">
                              <button className="act-btn act-edit" onClick={()=>{setEditIdx(realIdx);setDelConfirm(null)}}>✎</button>
                              <button className="act-btn act-del"  onClick={()=>{setDelConfirm(realIdx);setEditIdx(null)}}>⌫</button>
                            </div>
                          )}
                        </td>
                      </tr>

                      {isOpen && (
                        <tr className="stop-exp-row">
                          <td colSpan={21}>
                            <div className="stop-grid">
                              {STOP_KEYS.map(k => (
                                <div key={k} className="stop-cell">
                                  <label className="stop-lbl">{STOP_LABEL[k]}</label>
                                  <input type="number" step="1" min="0" placeholder="0"
                                    value={row[k]}
                                    onChange={e=>updateField(realIdx,k,e.target.value)}
                                    className="inp-num inp-amber" />
                                </div>
                              ))}
                              <div className="stop-cell stop-sum-cell">
                                <span className="stop-lbl">Total</span>
                                <div className="stop-sum-val mono">{c.totalStop||0}</div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="table-footer">
            <span className="td-muted" style={{fontSize:12}}>
              {rows.length} frames · {mill} · {shift.replace('SHIFT','Shift ')} · {date}
              {mode==='db' && <span className="mode-inline-badge"> · from DB</span>}
            </span>
            <button className="btn-success" onClick={saveShift} disabled={saving}>
              {saving ? <><span className="spinner"/>Saving…</> : mode==='db'?'💾 Update All':'💾 Save All'}
            </button>
          </div>
        </div>
      ) : loaded ? (
        <div className="empty">No frames found for the selected mill.</div>
      ) : (
        <div className="empty">
          <div className="empty-icon">
            <svg width="52" height="52" viewBox="0 0 52 52">
              <circle cx="26" cy="26" r="23" stroke="var(--border2)" strokeWidth="1" fill="none"/>
              <circle cx="26" cy="26" r="12" stroke="var(--indigo)" strokeWidth="1.2" strokeDasharray="5 4" fill="none"/>
              <circle cx="26" cy="26" r="4" fill="var(--indigo)" opacity=".5"/>
            </svg>
          </div>
          <p>Select <strong>Date · Shift · Mill</strong> then click <strong>Load Frames</strong></p>
          <p className="empty-hint">Frames auto-load from machine master. Enter Act Hank and expand stops per frame.</p>
        </div>
      )}
      <ToastContainer />
    </div>
  )
}

function SumCard({ label, value, mono, color }) {
  return (
    <div className="sum-card">
      <div className="sum-label">{label}</div>
      <div className={`sum-value${mono?' mono':''}${color?` sv-${color}`:''}`}>{value}</div>
    </div>
  )
}
