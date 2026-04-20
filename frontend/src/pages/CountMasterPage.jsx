import React, { useState, useEffect } from 'react'
import { api } from '../api.js'
import { calcConvFactor } from '../utils/formulas.js'
import { useToast } from '../hooks/useToast.jsx'
import '../components/MasterTable.css'

const BLANK = {
  count: '', actual_count: '', spinning_count_efficiency: '',
  spinning_std_hank_efficiency: '', conv_40s: '',
}

// Live derived conv_factor from inputs
function liveConvFactor(actual_count, spin_eff) {
  const ac  = parseFloat(actual_count)  || 0
  const eff = parseFloat(spin_eff)      || 0
  if (ac <= 0 || eff <= 0) return null
  return calcConvFactor(ac, eff)
}

export default function CountMasterPage() {
  const [rows,       setRows]       = useState([])
  const [loading,    setLoading]    = useState(false)
  const [search,     setSearch]     = useState('')
  const [editId,     setEditId]     = useState(null)
  const [editBuf,    setEditBuf]    = useState({})
  const [delConfirm, setDelConfirm] = useState(null)
  const [addRow,     setAddRow]     = useState(BLANK)
  const [adding,     setAdding]     = useState(false)
  const { show, ToastContainer } = useToast()

  const load = async () => {
    setLoading(true)
    try { setRows(await api.getCounts()) }
    catch(e) { show('Load failed: ' + e.message, 'error') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const startEdit  = (row) => { setEditId(row.id); setEditBuf({ ...row }); setDelConfirm(null) }
  const cancelEdit = ()    => { setEditId(null); setEditBuf({}) }

  const saveEdit = async () => {
    try {
      // compute conv_factor from formula before saving
      const cf = liveConvFactor(editBuf.actual_count, editBuf.spinning_count_efficiency)
      const updated = await api.updateCount(editId, {
        actual_count:                 +editBuf.actual_count,
        spinning_count_efficiency:    +editBuf.spinning_count_efficiency,
        spinning_std_hank_efficiency: +editBuf.spinning_std_hank_efficiency,
        conversion_factor:            cf !== null ? cf : +editBuf.conversion_factor,
        conv_40s:                     +editBuf.conv_40s,
      })
      setRows(r => r.map(x => x.id === editId ? updated : x))
      cancelEdit()
      show('Count updated')
    } catch(e) { show('Update failed: ' + e.message, 'error') }
  }

  const confirmDelete = async (id) => {
    try {
      await api.deleteCount(id)
      setRows(r => r.filter(x => x.id !== id))
      setDelConfirm(null)
      show('Count deleted')
    } catch(e) { show('Delete failed: ' + e.message, 'error') }
  }

  const addCount = async () => {
    if (!addRow.count || !addRow.actual_count) {
      show('Count name and actual count are required', 'error'); return
    }
    setAdding(true)
    try {
      const cf = liveConvFactor(addRow.actual_count, addRow.spinning_count_efficiency)
      const created = await api.createCount({
        count:                        addRow.count.trim(),
        actual_count:                 +addRow.actual_count,
        spinning_count_efficiency:    +addRow.spinning_count_efficiency || 93,
        spinning_std_hank_efficiency: +addRow.spinning_std_hank_efficiency || 96,
        conversion_factor:            cf !== null ? cf : 0,
        conv_40s:                     +addRow.conv_40s || 1,
      })
      setRows(r => [...r, created])
      setAddRow(BLANK)
      show(`Added count ${created.count}`)
    } catch(e) { show('Add failed: ' + e.message, 'error') }
    finally { setAdding(false) }
  }

  // update editBuf field and recompute conv_factor live
  const setEdit = (field, val) => {
    setEditBuf(b => ({ ...b, [field]: val }))
  }

  const filtered = rows.filter(r =>
    !search || r.count?.toLowerCase().includes(search.toLowerCase())
  )

  // Live conv_factor for edit row
  const editLiveCF = editId
    ? liveConvFactor(editBuf.actual_count, editBuf.spinning_count_efficiency)
    : null

  // Live conv_factor for add row
  const addLiveCF = liveConvFactor(addRow.actual_count, addRow.spinning_count_efficiency)

  const numInput = (field, step, placeholder) => (
    <input
      type="number" step={step} placeholder={placeholder}
      className="cell-input"
      value={editBuf[field] ?? ''}
      onChange={e => setEdit(field, e.target.value)}
    />
  )

  return (
    <div className="mp">
      <div className="card">
        <div className="page-hdr">
          <div>
            <div className="page-title">Count Master</div>
            <div className="page-meta">{rows.length} count types · Conv Factor = (1/Actual Count) × (Spin Eff/100) × 0.4536</div>
          </div>
          <button className="btn-ghost" onClick={load} disabled={loading}>
            {loading ? <><span className="spinner"/>Refreshing</> : '↺ Refresh'}
          </button>
        </div>

        <div className="toolbar">
          <input
            className="toolbar-search"
            placeholder="Search count name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="tscroll">
          <table className="ctable">
            <thead>
              <tr>
                <th>Count</th>
                <th className="th-r">Actual Count</th>
                <th className="th-r">Spin Eff %</th>
                <th className="th-r">Hank Eff %</th>
                <th className="th-r" style={{color:'var(--indigo-light)'}}>Conv Factor ⟳</th>
                <th className="th-r">40s Conv</th>
                <th className="th-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr className="empty-row">
                  <td colSpan={7}>{loading ? 'Loading…' : 'No records found'}</td>
                </tr>
              )}
              {filtered.map(row => {
                const isEdit = editId === row.id
                // Show live computed value when editing, stored value otherwise
                const displayCF = isEdit && editLiveCF !== null
                  ? editLiveCF
                  : parseFloat(row.conversion_factor)

                return (
                  <tr key={row.id} className={`crow${isEdit ? ' editing' : ''}`}>
                    <td><span className="count-badge">{row.count}</span></td>

                    <td className="td-r mono">
                      {isEdit ? numInput('actual_count', '0.1', '41') : row.actual_count}
                    </td>

                    <td className="td-r mono">
                      {isEdit
                        ? numInput('spinning_count_efficiency', '0.1', '93')
                        : row.spinning_count_efficiency + '%'
                      }
                    </td>

                    <td className="td-r mono">
                      {isEdit
                        ? numInput('spinning_std_hank_efficiency', '0.1', '96')
                        : row.spinning_std_hank_efficiency + '%'
                      }
                    </td>

                    {/* Conv Factor — computed live, read-only display */}
                    <td className="td-r mono" style={{color:'var(--indigo-light)', fontWeight:600}}>
                      {isEdit ? (
                        <div style={{display:'flex', flexDirection:'column', alignItems:'flex-end', gap:2}}>
                          <span style={{fontSize:13}}>{editLiveCF !== null ? editLiveCF.toFixed(8) : '—'}</span>
                          <span style={{fontSize:9, color:'var(--text3)'}}>auto-computed</span>
                        </div>
                      ) : (
                        displayCF ? displayCF.toFixed(8) : '—'
                      )}
                    </td>

                    <td className="td-r mono">
                      {isEdit
                        ? numInput('conv_40s', '0.001', '0.704')
                        : Number(row.conv_40s).toFixed(3)
                      }
                    </td>

                    <td className="td-actions">
                      {isEdit ? (
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

        {/* Add form */}
        <div className="add-form">
          <div className="add-field" style={{maxWidth:110}}>
            <label className="add-label">Count *</label>
            <input className="add-input" placeholder="40SPSF"
              value={addRow.count}
              onChange={e => setAddRow(r => ({...r, count: e.target.value}))} />
          </div>
          <div className="add-field" style={{maxWidth:110}}>
            <label className="add-label">Actual Count *</label>
            <input className="add-input" type="number" step="0.1" placeholder="41"
              value={addRow.actual_count}
              onChange={e => setAddRow(r => ({...r, actual_count: e.target.value}))} />
          </div>
          <div className="add-field" style={{maxWidth:100}}>
            <label className="add-label">Spin Eff %</label>
            <input className="add-input" type="number" step="0.1" placeholder="93"
              value={addRow.spinning_count_efficiency}
              onChange={e => setAddRow(r => ({...r, spinning_count_efficiency: e.target.value}))} />
          </div>
          <div className="add-field" style={{maxWidth:100}}>
            <label className="add-label">Hank Eff %</label>
            <input className="add-input" type="number" step="0.1" placeholder="96"
              value={addRow.spinning_std_hank_efficiency}
              onChange={e => setAddRow(r => ({...r, spinning_std_hank_efficiency: e.target.value}))} />
          </div>
          {/* Live computed conv_factor preview */}
          <div className="add-field" style={{maxWidth:140}}>
            <label className="add-label">Conv Factor ⟳ (auto)</label>
            <div style={{
              height:32, display:'flex', alignItems:'center', justifyContent:'flex-end',
              background:'var(--surface3)', border:'1px solid var(--border2)',
              borderRadius:'var(--r-sm)', padding:'0 10px',
              fontFamily:'JetBrains Mono,monospace', fontSize:12,
              color: addLiveCF !== null ? 'var(--indigo-light)' : 'var(--text3)'
            }}>
              {addLiveCF !== null ? addLiveCF.toFixed(8) : '—'}
            </div>
          </div>
          <div className="add-field" style={{maxWidth:100}}>
            <label className="add-label">40s Conv</label>
            <input className="add-input" type="number" step="0.001" placeholder="0.704"
              value={addRow.conv_40s}
              onChange={e => setAddRow(r => ({...r, conv_40s: e.target.value}))} />
          </div>
          <button className="btn-success" onClick={addCount} disabled={adding} style={{alignSelf:'flex-end'}}>
            {adding ? <><span className="spinner"/>Adding…</> : '+ Add Count'}
          </button>
        </div>
      </div>
      <ToastContainer />
    </div>
  )
}
