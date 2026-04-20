// Natural sort for RF No: B1 < B2 < B10 < B11 < B12
export function naturalSort(a, b) {
  const re = /(\d+)|(\D+)/g
  const pa = String(a).match(re) || []
  const pb = String(b).match(re) || []
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1
    if (pb[i] === undefined) return 1
    const na = parseFloat(pa[i]), nb = parseFloat(pb[i])
    if (!isNaN(na) && !isNaN(nb)) {
      if (na !== nb) return na - nb
    } else {
      const cmp = pa[i].localeCompare(pb[i])
      if (cmp !== 0) return cmp
    }
  }
  return 0
}

export function sortByRfNo(rows) {
  return [...rows].sort((a, b) => naturalSort(a.rf_no, b.rf_no))
}
