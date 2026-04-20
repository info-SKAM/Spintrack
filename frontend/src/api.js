const BASE = '/api'

// ── Simple in-memory cache ────────────────────────────────────────────────
const _cache = new Map()
function cached(key, fn, ttlMs = 60000) {
  const hit = _cache.get(key)
  if (hit && Date.now() - hit.ts < ttlMs) return Promise.resolve(hit.val)
  return fn().then(val => { _cache.set(key, { val, ts: Date.now() }); return val })
}
export function clearCache(prefix) {
  for (const k of _cache.keys()) {
    if (!prefix || k.startsWith(prefix)) _cache.delete(k)
  }
}

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, { headers: { 'Content-Type': 'application/json' }, ...opts })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || res.statusText)
  }
  if (res.status === 204) return null
  return res.json()
}

export const api = {
  // Mills — cached 5 minutes (rarely changes)
  getMills: () => cached('mills', () => req('/mills'), 5 * 60000),

  // Frames — cached 5 minutes per mill
  getFrames: (mill) => cached(`frames:${mill}`, () => req(`/frames?mill=${encodeURIComponent(mill)}`), 5 * 60000),

  // Combined load — 1 call instead of 3 (checkShiftExists + getDailyWorking + getFrames)
  loadShift: (date, shift, mill) =>
    req(`/load-shift?date=${date}&shift=${shift}&mill=${encodeURIComponent(mill)}`),

  // Daily working
  saveShift:   (body)     => req('/daily-working/save',       { method: 'POST', body: JSON.stringify(body) }),
  updateAll:   (body)     => req('/daily-working/update-all', { method: 'POST', body: JSON.stringify(body) }),
  patchRow:    (id, body) => req(`/daily-working/${id}`,      { method: 'PATCH', body: JSON.stringify(body) }),
  deleteRow:   (id)       => req(`/daily-working/${id}`,      { method: 'DELETE' }),
  getDailyWorking: (p)    => req(`/daily-working?${new URLSearchParams(p)}`),
  getSummary:  (date, mill) => req(`/summary?date=${date}&mill=${encodeURIComponent(mill)}`),
  getHistory:  (p)          => req(`/history?${new URLSearchParams(p)}`),

  // Dedup
  fixDuplicates:    (date, shift, mill) =>
    req(`/daily-working/duplicates?date=${date}&shift=${shift}&mill=${encodeURIComponent(mill)}`, { method: 'DELETE' }),
  fixAllDuplicates: () => req('/daily-working/duplicates/all', { method: 'DELETE' }),

  // Machine master
  getMachines:   (mill)     => req(`/machine-master${mill ? '?mill=' + encodeURIComponent(mill) : ''}`),
  createMachine: (body)     => req('/machine-master',     { method: 'POST', body: JSON.stringify(body) }),
  updateMachine: (id, body) => req(`/machine-master/${id}`, { method: 'PUT',  body: JSON.stringify(body) }),
  deleteMachine: (id)       => req(`/machine-master/${id}`, { method: 'DELETE' }),

  // Count master
  getCounts:    ()          => req('/count-master'),
  createCount:  (body)      => req('/count-master',     { method: 'POST', body: JSON.stringify(body) }),
  updateCount:  (id, body)  => req(`/count-master/${id}`, { method: 'PUT',  body: JSON.stringify(body) }),
  deleteCount:  (id)        => req(`/count-master/${id}`, { method: 'DELETE' }),

  // Admin control
  checkShiftExists: (date, shift, mill) =>
    req(`/admin/check-exists?date=${date}&shift=${shift}&mill=${encodeURIComponent(mill)}`),
  adminInsert: (body) => req('/admin/insert-daily-working', { method: 'POST', body: JSON.stringify(body) }),

  // Reports
  getReportOptions: () => req('/report/options'),
  getReportData:    (p) => req(`/report/data?${new URLSearchParams(p)}`),
  getReportPdfUrl:  (p) => `${BASE}/report/pdf?${new URLSearchParams(p)}`,
}
