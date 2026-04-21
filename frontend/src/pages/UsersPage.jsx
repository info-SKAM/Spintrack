import React, { useState, useEffect } from 'react'
import { api } from '../api.js'
import { useToast } from '../hooks/useToast.jsx'
import '../components/MasterTable.css'

const ROLES = ['viewer', 'manager', 'admin']
const BLANK = { username: '', password: '', role: 'viewer' }

export default function UsersPage() {
  const [rows,       setRows]       = useState([])
  const [loading,    setLoading]    = useState(false)
  const [addRow,     setAddRow]     = useState(BLANK)
  const [adding,     setAdding]     = useState(false)
  const [editId,     setEditId]     = useState(null)
  const [editBuf,    setEditBuf]    = useState({})
  const [delConfirm, setDelConfirm] = useState(null)
  const { show, ToastContainer }   = useToast()

  const load = async () => {
    setLoading(true)
    try { setRows(await api.getUsers()) }
    catch (e) { show(e.message, 'error') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const handleAdd = async () => {
    if (!addRow.username || !addRow.password) { show('Username and password required', 'error'); return }
    try {
      await api.createUser(addRow)
      show('User created'); setAdding(false); setAddRow(BLANK); load()
    } catch (e) { show(e.message, 'error') }
  }

  const handleUpdate = async (id) => {
    try {
      await api.updateUser(id, editBuf)
      show('User updated'); setEditId(null); load()
    } catch (e) { show(e.message, 'error') }
  }

  const handleDelete = async (id) => {
    try {
      await api.deleteUser(id)
      show('User deleted'); setDelConfirm(null); load()
    } catch (e) { show(e.message, 'error') }
  }

  const roleColor = (r) =>
    r === 'admin' ? '#4f46e5' : r === 'manager' ? '#0e7490' : '#374151'

  return (
    <div className="master-wrap">
      <ToastContainer />
      <div className="master-toolbar">
        <h2 className="master-title">User Management</h2>
        <button className="btn-add" onClick={() => setAdding(a => !a)}>
          {adding ? 'Cancel' : '+ Add User'}
        </button>
      </div>

      {adding && (
        <div className="add-form">
          <input placeholder="Username" value={addRow.username}
            onChange={e => setAddRow(r => ({ ...r, username: e.target.value }))} />
          <input placeholder="Password" type="password" value={addRow.password}
            onChange={e => setAddRow(r => ({ ...r, password: e.target.value }))} />
          <select value={addRow.role} onChange={e => setAddRow(r => ({ ...r, role: e.target.value }))}>
            {ROLES.map(ro => <option key={ro} value={ro}>{ro}</option>)}
          </select>
          <button className="btn-save" onClick={handleAdd}>Create</button>
        </div>
      )}

      {loading ? <p className="loading-txt">Loading…</p> : (
        <table className="master-tbl">
          <thead>
            <tr><th>ID</th><th>Username</th><th>Role</th><th>Created</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id}>
                <td>{row.id}</td>
                <td>{row.username}</td>
                <td>
                  {editId === row.id ? (
                    <select value={editBuf.role || row.role}
                      onChange={e => setEditBuf(b => ({ ...b, role: e.target.value }))}>
                      {ROLES.map(ro => <option key={ro} value={ro}>{ro}</option>)}
                    </select>
                  ) : (
                    <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 12,
                      background: roleColor(row.role), color: '#fff' }}>
                      {row.role}
                    </span>
                  )}
                </td>
                <td>{row.created_at?.slice(0, 10)}</td>
                <td>
                  {editId === row.id ? (
                    <>
                      <input placeholder="New password (optional)" type="password"
                        onChange={e => setEditBuf(b => ({ ...b, password: e.target.value || undefined }))}
                        style={{ marginRight: 6, width: 160 }} />
                      <button className="btn-save" onClick={() => handleUpdate(row.id)}>Save</button>
                      <button className="btn-cancel" onClick={() => setEditId(null)}>Cancel</button>
                    </>
                  ) : delConfirm === row.id ? (
                    <>
                      <span style={{ color: '#f87171', fontSize: 12, marginRight: 6 }}>Delete?</span>
                      <button className="btn-del" onClick={() => handleDelete(row.id)}>Yes</button>
                      <button className="btn-cancel" onClick={() => setDelConfirm(null)}>No</button>
                    </>
                  ) : (
                    <>
                      <button className="btn-edit" onClick={() => { setEditId(row.id); setEditBuf({}) }}>Edit</button>
                      <button className="btn-del"  onClick={() => setDelConfirm(row.id)}>Delete</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
