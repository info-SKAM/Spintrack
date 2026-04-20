/**
 * Formula engine — exact formulas from Automation.xlsx
 *
 * DERIVED MASTER FORMULAS:
 *   conv_factor = (1/actual_count) * (spinning_count_efficiency/100) * 0.4536
 *   std_hank    = (spinning_std_hank_efficiency/100) * (spdl_speed/tpi * 0.01587394)
 *
 * DAILY WORKING FORMULAS:
 *   WORKED_SPINDLES = NO_OF_SPINDLES * (480 - stop_min) / 480
 *   TARGET_KGS      = conv_factor * NO_OF_SPINDLES * STD_Hank
 *   Prodn_KGS       = conv_factor * NO_OF_SPINDLES * ACT_Hank
 *   WASTE_%         = (Pne_Bondas / Prodn_KGS) * 100
 *   Actual_Prdn     = Prodn_KGS - Pne_Bondas
 *   Std_GPS         = (TARGET_KGS * NO_OF_SPINDLES) / 1000
 *   Actual_GPS      = (Actual_Prdn * WORKED_SPINDLES) / 1000
 *   DIFF_(+/-)      = Std_GPS - Actual_GPS
 *   40sCON_GPS      = conv_40s * Actual_GPS
 *   Total_Stop      = W.O.H + MW + CLG/LC + ER + LA,PF + BSS + LAP + DD
 */

export function calcConvFactor(actual_count, spinning_count_efficiency) {
  if (!actual_count || actual_count <= 0) return 0
  return (1 / actual_count) * (spinning_count_efficiency / 100) * 0.4536
}

export function calcStdHank(spinning_std_hank_efficiency, spdl_speed, tpi) {
  if (!tpi || tpi <= 0) return 0
  return (spinning_std_hank_efficiency / 100.0) * (spdl_speed / tpi * 0.01587394)
}

export function calcRow({
  no_of_spindles,
  std_hank,
  act_hank    = 0,
  stop_min    = 0,
  conv_factor = 0,
  conv_40s    = 1,
  pne_bondas  = 0,
  woh = 0, mw = 0, clg_lc = 0, er = 0,
  la_pf = 0, bss = 0, lap = 0, dd = 0,
}) {
  const s   = +no_of_spindles
  const sh  = +std_hank
  const ah  = +act_hank
  const sm  = +stop_min
  const cf  = +conv_factor
  const c40 = +conv_40s
  const pne = +pne_bondas

  const workedSpindles = s * (480 - sm) / 480
  const targetKgs      = cf * s * sh
  // Target KGS (Run):
  //   Not run:       act_hank=0 AND woh=480  → 0
  //   Fully run:     act_hank>0 AND tot_stop=0 → target_kgs (100%)
  //   Partially run: act_hank>0 AND woh>0    → target_kgs * (480 - (total_stop - dd)) / 480
  const wohVal        = +woh
  const ddVal         = +dd
  const totalStopVal  = [+woh,+mw,+clg_lc,+er,+la_pf,+bss,+lap,+dd].reduce((a,b)=>a+(b||0),0)
  const notRun        = (ah === 0) && (wohVal >= 480)
  const partialRun    = (ah > 0) && (wohVal !== 480) && (totalStopVal > 0)
  const effectiveStop = Math.max(0, totalStopVal - ddVal)   // total_stop - DD
  const targetKgsRun  = notRun     ? 0
                      : partialRun ? targetKgs * (480 - effectiveStop) / 480
                      :              targetKgs  // fully run (total_stop = 0)
  const prodnKgs       = cf * s * ah
  const wastePct       = prodnKgs > 0 ? (pne / prodnKgs) * 100 : 0
  const actualPrdn     = prodnKgs - pne
  const stdGPS         = (targetKgs * s) / 1000
  const actualGPS      = (actualPrdn * workedSpindles) / 1000
  const diff           = stdGPS - actualGPS
  const effPct         = stdGPS > 0 ? (actualGPS / stdGPS) * 100 : 0
  const con40sGps      = c40 * actualGPS
  const totalStop      = [woh, mw, clg_lc, er, la_pf, bss, lap, dd]
                           .reduce((a, b) => a + (+b || 0), 0)

  return {
    workedSpindles: r1(workedSpindles),
    targetKgs:      r4(targetKgs),
    targetKgsRun:   r4(targetKgsRun),
    prodnKgs:       r4(prodnKgs),
    wastePct:       r2(wastePct),
    actualPrdn:     r4(actualPrdn),
    stdGPS:         r4(stdGPS),
    actualGPS:      r4(actualGPS),
    diff:           r4(diff),
    effPct:         r2(effPct),
    con40sGps:      r4(con40sGps),
    totalStop:      Math.round(totalStop),
  }
}

export function shiftSummary(rows) {
  const totalTarget    = rows.reduce((a, r) => a + (r._c?.targetKgs    || 0), 0)
  const totalTargetRun = rows.reduce((a, r) => a + (r._c?.targetKgsRun || 0), 0)
  const totalActual    = rows.reduce((a, r) => a + (r._c?.actualPrdn   || 0), 0)
  const totalStop      = rows.reduce((a, r) => a + (r._c?.totalStop    || 0), 0)
  const runningFrames  = rows.filter(r => {
    const ah  = parseFloat(r.act_hank) || 0
    const woh = parseFloat(r.woh)      || 0
    return !(ah === 0 && woh >= 480)   // exclude totally not-run
  }).length
  const eff = totalTargetRun > 0 ? totalActual / totalTargetRun * 100 : 0
  return {
    frames:          rows.length,
    runningFrames,
    totalTarget:     r2(totalTarget),
    totalTargetRun:  r2(totalTargetRun),
    totalActual:     r2(totalActual),
    eff:             r2(eff),
    totalStop,
  }
}

const r1 = v => Math.round(v * 10)    / 10
const r2 = v => Math.round(v * 100)   / 100
const r4 = v => Math.round(v * 10000) / 10000

export const fmt4 = v => (v == null || isNaN(v)) ? '—' : Number(v).toFixed(4)
export const fmt2 = v => (v == null || isNaN(v)) ? '—' : Number(v).toFixed(2)
export const fmt1 = v => (v == null || isNaN(v)) ? '—' : Number(v).toFixed(1)
export const fmtN = v => (v == null || isNaN(v)) ? '—' : Math.round(v).toString()
