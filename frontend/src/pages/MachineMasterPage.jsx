import React, { useState, useEffect, useCallback } from 'react'
import { api } from '../api.js'
import { calcStdHank } from '../utils/formulas.js'
import { useToast } from '../hooks/useToast.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import '../components/MasterTable.css'

const MILLS = ['A-MILL', 'B-MILL', 'C-MILL', 'D-MILL']

const BLANK = {
  mill: 'B-MILL', department: 'SPINNING', rf_no: '', count: '',
  no_of_spindles: '', spdl_speed: '', tpi: '',
}

// Live std_hank from machine fields + count master hank_eff
function liveStdHank(hank_eff, spdl_speed, tpi) {
  const eff = parseFloat(hank_eff)   || 0
  const spd = parseFloat(spdl_speed) || 0
  const t   = parseFloat(tpi)        || 0
  if (eff <= 0 || spd <= 0 || t <= 0) return null
  return calcStdHank(eff, spd, t)
}

export default function MachineMasterPage() {
  const { canManage } = useAuth()
  const [rows,       setRows]       = useState([])
  const [counts,     setCounts]     = useState([])  // count master for hank_eff lookup
  const [loading,    setLoading]    = useState(false)
  const [millFilt,   setMillFilt]   = useState('')
  const [search,     setSearch]     = useState('')
  const [editId,     setEditId]     = useState(null)
  const [editBuf,    setEditBuf]    = useState({})
  const [delConfirm, setDelConfirm] = useState(null)
  const [addRow,     setAddRow]     = useState(BLANK)
  const [adding,     setAdding]     = useState(false)
  const { show, ToastContainer } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [machines, countMaster] = await Promise.all([
        api.getMachines(millFilt || undefined),
        api.getCounts(),
      ])
      setRows(machines)
      setCounts(countMaster)
    } catch(e) { show('Load failed: ' + e.message, 'error') }
    finally { setLoading(false) }
  }, [millFilt])

  useEffect(() => { load() }, [load])

  // Get hank_eff for a given count name
  const getHankEff = (countName) => {
    const cm = counts.find(c => c.count === countName)
    return cm ? parseFloat(cm.spinning_std_hank_efficiency) || 0 : 0
  }

  const startEdit = (row) => {
    setEditId(row.id)
    setEditBuf({ ...row, _hank_eff: getHankEff(row.count) })
    setDelConfirm(null)
  }
  const cancelEdit = () => { setEditId(null); setEditBuf({}) }

  const saveEdit = async () => {
    try {
      const sh = liveStdHank(editBuf._hank_eff, editBuf.spdl_speed, editBuf.tpi)
      const updated = await api.updateMachine(editId, {
        mill:           editBuf.mill,
        department:     editBuf.department,
        count:          editBuf.count,
        no_of_spindles: +editBuf.no_of_spindles,
        spdl_speed:     +editBuf.spdl_speed,
        tpi:            +editBuf.tpi,
        std_hank:       sh !== null ? sh : +editBuf.std_hank,
      })
      setRows(r => r.map(x => x.id === editId ? updated : x))
      cancelEdit()
      show('Machine updated')
    } catch(e) { show('Update failed: ' + e.message, 'error') }
  }

  const confirmDelete = async (id) => {
    try {
      await api.deleteMachine(id)
      setRows(r => r.filter(x => x.id !== id))
      setDelConfirm(null)
      show('Machine deleted')
    } catch(e) { show('Delete failed: ' + e.message, 'error') }
  }

  const addMachine = async () => {
    if (!addRow.rf_no || !addRow.count || !addRow.no_of_spindles) {
      show('RF No, Count and Spindles are required', 'error'); return
    }
    setAdding(true)
    try {
      const hank_eff = getHankEff(addRow.count)
      const sh = liveStdHank(hank_eff, addRow.spdl_speed, addRow.tpi)
      const created = await api.createMachine({
        mill:           addRow.mill,
        department:     addRow.department || 'SPINNING',
        rf_no:          addRow.rf_no,
        count:          addRow.count,
        no_of_spindles: +addRow.no_of_spindles,
        spdl_speed:     +addRow.spdl_speed,
        tpi:            +addRow.tpi,
        std_hank:       sh !== null ? sh : 0,
      })
      setRows(r => [...r, created])
      setAddRow(BLANK)
      show(`Added machine ${created.rf_no}`)
    } catch(e) { show('Add failed: ' + e.message, 'error') }
    finally { setAdding(false) }
  }

  // When count changes in editBuf, update hank_eff
  const setEditField = (field, val) => {
    setEditBuf(b => {
      const updated = { ...b, [field]: val }
      if (field === 'count') {
        updated._hank_eff = getHankEff(val)
      }
      return updated
    })
  }

  const filtered = rows.filter(r => {
    const q = search.toLowerCase()
    return !q || r.rf_no?.toLowerCase().includes(q) || r.count?.toLowerCase().includes(q)
  })

  // Live std_hank for edit row
  const editLiveSH = editId
    ? liveStdHank(editBuf._hank_eff, editBuf.spdl_speed, editBuf.tpi)
    : null

  // Live std_hank for add row
  const addHankEff  = getHankEff(addRow.count)
  const addLiveSH   = liveStdHank(addHankEff, addRow.spdl_speed, addRow.tpi)

  return (
    <div className="mp">
      <div className="card">
        <div className="page-hdr">
          <div>
            <div className="page-title">Machine Master</div>
            <div className="page-meta">
              {rows.length} frames · Std Hank = (Hank Eff%/100) × (Spd/TPI × 0.01587394)
            </div>
          </div>
          <div style={{display:'flex', gap:8}}>
            <button className="btn-ghost" onClick={load} disabled={loading}>
              {loading ? <><span className="spinner"/>Refreshing</> : '↺ Refresh'}
            </button>
          </div>
        </div>

        <div className="toolbar">
          <input
            className="toolbar-search"
            placeholder="Search RF No or Count…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select
            className="toolbar-filter"
            value={millFilt}
            onChange={e => setMillFilt(e.target.value)}
            style={{height:34, minWidth:140}}
          >
            <option value="">All Mills</option>
            {MILLS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <div className="tscroll">
          <table className="ctable">
            <thead>
              <tr>
                <th>Mill</th>
                <th>RF No</th>
                <th>Count</th>
                <th>Dept</th>
                <th className="th-r">Spindles</th>
                <th className="th-r">Speed RPM</th>
                <th className="th-r">TPI</th>
                <th className="th-r" style={{color:'var(--indigo-light)'}}>Std Hank ⟳</th>
                <th className="th-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr className="empty-row">
                  <td colSpan={9}>{loading ? 'Loading…' : 'No records found'}</td>
                </tr>
              )}
              {filtered.map(row => {
                const isEdit = editId === row.id
                const displaySH = isEdit && editLiveSH !== null
                  ? editLiveSH
                  : parseFloat(row.std_hank)

                return (
                  <tr key={row.id} className={`crow${isEdit ? ' editing' : ''}`}>
                    <td>
                      {isEdit ? (
                        <select className="cell-input" value={editBuf.mill}
                          onChange={e => setEditField('mill', e.target.value)}>
                          {MILLS.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                      ) : (
                        <span className="mill-badge">{row.mill}</span>
                      )}
                    </td>
                    <td><span className="rf-badge">{row.rf_no}</span></td>
                    <td>
                      {isEdit ? (
                        <select className="cell-input" value={editBuf.count}
                          onChange={e => setEditField('count', e.target.value)}>
                          <option value="">— Select —</option>
                          {counts.map(c => <option key={c.count} value={c.count}>{c.count}</option>)}
                        </select>
                      ) : (
                        <span className="count-badge">{row.count}</span>
                      )}
                    </td>
                    <td className="td-muted">
                      {isEdit
                        ? <input className="cell-input" value={editBuf.department}
                            onChange={e => setEditField('department', e.target.value)} />
                        : row.department
                      }
                    </td>
                    <td className="td-r mono">
                      {isEdit
                        ? <input className="cell-input" type="number" value={editBuf.no_of_spindles}
                            onChange={e => setEditField('no_of_spindles', e.target.value)} />
                        : row.no_of_spindles
                      }
                    </td>
                    <td className="td-r mono">
                      {isEdit
                        ? <input className="cell-input" type="number" value={editBuf.spdl_speed}
                            onChange={e => setEditField('spdl_speed', e.target.value)} />
                        : Number(row.spdl_speed).toLocaleString()
                      }
                    </td>
                    <td className="td-r mono">
                      {isEdit
                        ? <input className="cell-input" type="number" step="0.01" value={editBuf.tpi}
                            onChange={e => setEditField('tpi', e.target.value)} />
                        : Number(row.tpi).toFixed(2)
                      }
                    </td>

                    {/* Std Hank — computed live, read-only */}
                    <td className="td-r mono" style={{color:'var(--indigo-light)', fontWeight:600}}>
                      {isEdit ? (
                        <div style={{display:'flex', flexDirection:'column', alignItems:'flex-end', gap:2}}>
                          <span style={{fontSize:13}}>
                            {editLiveSH !== null ? editLiveSH.toFixed(6) : '—'}
                          </span>
                          <span style={{fontSize:9, color:'var(--text3)'}}>
                            {editBuf._hank_eff > 0 ? `eff ${editBuf._hank_eff}%` : 'select count first'}
                          </span>
                        </div>
                      ) : (
                        displaySH ? displaySH.toFixed(6) : '—'
                      )}
                    </td>

                    <td className="td-actions">
                      {!canManage ? <span style={{color:'#555',fontSize:12}}>View only</span>
                      : isEdit ? (
                        <div className="act-btns">
                          <button className="act-btn save"   onClick={saveEdit}>✓</button>
                          <button className="act-btn cancel" onClick={cancelEdit}>✕</button>
                        </div>
                      ) : delConfirm === row.id ? (
                        <div className="del-confirm">
                          <button className="act-btn del-yes" onClick={() => confirmDelete(row.id)}>Delete?</button>
                          <button className="act-btn del-no"  onClick={() => setDelConfirm(null)}>No</button>
                        </div>
                      ) : (
                        <div className="act-btns">
                          <button className="act-btn edit" onClick={() => startEdit(row)}>✎</button>
                          <button className="act-btn del"  onClick={() => setDelConfirm(row.id)}>⌫</button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Add form — managers/admins only */}
        {!canManage ? null : <div className="add-form">
          <div className="add-field" style={{maxWidth:120}}>
            <label className="add-label">Mill</label>
            <select className="add-input" value={addRow.mill}
              onChange={e => setAddRow(r => ({...r, mill: e.target.value}))}>
              {MILLS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="add-field" style={{maxWidth:90}}>
            <label className="add-label">RF No *</label>
            <input className="add-input" placeholder="B13"
              value={addRow.rf_no}
              onChange={e => setAddRow(r => ({...r, rf_no: e.target.value}))} />
          </div>
          <div className="add-field" style={{maxWidth:130}}>
            <label className="add-label">Count *</label>
            <select className="add-input" value={addRow.count}
              onChange={e => setAddRow(r => ({...r, count: e.target.value}))}>
              <option value="">— Select —</option>
              {counts.map(c => <option key={c.count} value={c.count}>{c.count}</option>)}
            </select>
          </div>
          <div className="add-field" style={{maxWidth:100}}>
            <label className="add-label">Spindles *</label>
            <input className="add-input" type="number" placeholder="816"
              value={addRow.no_of_spindles}
              onChange={e => setAddRow(r => ({...r, no_of_spindles: e.target.value}))} />
          </div>
          <div className="add-field" style={{maxWidth:110}}>
            <label className="add-label">Speed RPM</label>
            <input className="add-input" type="number" placeholder="15000"
              value={addRow.spdl_speed}
              onChange={e => setAddRow(r => ({...r, spdl_speed: e.target.value}))} />
          </div>
          <div className="add-field" style={{maxWidth:90}}>
            <label className="add-label">TPI</label>
            <input className="add-input" type="number" step="0.01" placeholder="18.21"
              value={addRow.tpi}
              onChange={e => setAddRow(r => ({...r, tpi: e.target.value}))} />
          </div>
          {/* Live std_hank preview */}
          <div className="add-field" style={{maxWidth:130}}>
            <label className="add-label">Std Hank ⟳ (auto)</label>
            <div style={{
              height:32, display:'flex', alignItems:'center', justifyContent:'flex-end',
              background:'var(--surface3)', border:'1px solid var(--border2)',
              borderRadius:'var(--r-sm)', padding:'0 10px',
              fontFamily:'JetBrains Mono,monospace', fontSize:12,
              color: addLiveSH !== null ? 'var(--indigo-light)' : 'var(--text3)'
            }}>
              {addLiveSH !== null
                ? addLiveSH.toFixed(6)
                : addRow.count ? `need spd & tpi` : '— select count'
              }
            </div>
          </div>
          <button className="btn-success" onClick={addMachine} disabled={adding} style={{alignSelf:'flex-end'}}>
            {adding ? <><span className="spinner"/>Adding…</> : '+ Add Machine'}
          </button>
        </div>}
      </div>
      <ToastContainer />
    </div>
  )
}
