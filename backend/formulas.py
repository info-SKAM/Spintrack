"""
Formula engine — exact formulas from Automation.xlsx

DERIVED MASTER FORMULAS:
  conversion_factor = (1/actual_count) * (spinning_count_efficiency/100) * 0.4536
  std_hank          = (spinning_std_hank_efficiency/100) * (spdl_speed/tpi * 0.01587394)

DAILY WORKING FORMULAS:
  WORKED_SPINDLES = NO_OF_SPINDLES * (480 - stop_min) / 480
  TARGET_KGS      = conv_factor * NO_OF_SPINDLES * STD_Hank
  Prodn_KGS       = conv_factor * NO_OF_SPINDLES * ACT_Hank
  Pne_Bondas      = user entry (wastage KG)
  WASTE_%         = (Pne_Bondas / Prodn_KGS) * 100
  Actual_Prdn     = Prodn_KGS - Pne_Bondas
  Std_GPS         = (TARGET_KGS * NO_OF_SPINDLES) / 1000
  Actual_GPS      = (Actual_Prdn * WORKED_SPINDLES) / 1000
  DIFF_(+/-)      = Std_GPS - Actual_GPS
  40sCON_GPS      = conv_40s * Actual_GPS
  Total_Stop      = W.O.H + MW + CLG/LC + ER + LA,PF + BSS + LAP + DD
"""
from dataclasses import dataclass


def calc_conversion_factor(actual_count, spinning_count_efficiency) -> float:
    """(1/actual_count) * (spinning_count_efficiency/100) * 0.4536"""
    ac  = float(actual_count  or 0)
    eff = float(spinning_count_efficiency or 0)
    if ac <= 0:
        return 0
    return (1 / ac) * (eff / 100) * 0.4536


def calc_std_hank(spinning_std_hank_efficiency, spdl_speed, tpi) -> float:
    """(spinning_std_hank_efficiency/100) * (spdl_speed/tpi * 0.01587394)"""
    eff = float(spinning_std_hank_efficiency or 0)
    spd = float(spdl_speed or 0)
    t   = float(tpi or 0)
    if t <= 0:
        return 0
    return (eff / 100.0) * (spd / t * 0.01587394)


@dataclass
class CalcResult:
    worked_spindles: float
    target_kgs:      float
    target_kgs_run:  float
    prodn_kgs:       float
    waste_pct:       float
    actual_prdn:     float
    std_gps:         float
    actual_gps:      float
    diff_plus_minus: float
    con_40s_gps:     float
    eff_pct:         float
    total_stop:      float


def calc_row(
    no_of_spindles: int,
    std_hank:       float,
    act_hank:       float = 0,
    stop_min:       float = 0,
    conv_factor:    float = 0,
    conv_40s:       float = 1,
    pne_bondas:     float = 0,
    woh:   float = 0, mw:    float = 0, clg_lc: float = 0,
    er:    float = 0, la_pf: float = 0, bss:    float = 0,
    lap:   float = 0, dd:    float = 0,
    # unused but kept for backward compat
    spdl_speed: float = 0,
    tpi:        float = 0,
) -> CalcResult:

    s   = float(no_of_spindles)
    sh  = float(std_hank)
    ah  = float(act_hank)
    sm  = float(stop_min)
    cf  = float(conv_factor)
    c40 = float(conv_40s)
    pne = float(pne_bondas)

    worked_spindles = s * (480 - sm) / 480
    target_kgs      = cf * s * sh
    # Target KGS (Run):
    #   Not run:       act_hank=0 AND woh>=480 → 0
    #   Fully run:     act_hank>0 AND total_stop=0 → target_kgs (100%)
    #   Partially run: act_hank>0 AND woh>0 → target_kgs * (480 - (total_stop - dd)) / 480
    total_stop_val  = woh + mw + clg_lc + er + la_pf + bss + lap + dd
    not_run         = (ah == 0) and (woh >= 480)
    partial_run     = (ah > 0) and (woh != 480) and (total_stop_val > 0)
    effective_stop  = max(0.0, total_stop_val - dd)   # total_stop - DD
    target_kgs_run  = (0.0 if not_run
                  else target_kgs * (480 - effective_stop) / 480 if partial_run
                  else target_kgs)  # fully run (total_stop = 0)
    prodn_kgs       = cf * s * ah
    waste_pct       = (pne / prodn_kgs * 100) if prodn_kgs > 0 else 0
    actual_prdn     = prodn_kgs - pne
    std_gps         = (target_kgs * s) / 1000
    actual_gps      = (actual_prdn * worked_spindles) / 1000
    diff            = std_gps - actual_gps
    eff_pct         = (actual_gps / std_gps * 100) if std_gps > 0 else 0
    con_40s_gps     = c40 * actual_gps
    total_stop      = woh + mw + clg_lc + er + la_pf + bss + lap + dd

    return CalcResult(
        worked_spindles = round(worked_spindles, 1),
        target_kgs      = round(target_kgs,      4),
        target_kgs_run  = round(target_kgs_run,  4),
        prodn_kgs       = round(prodn_kgs,        4),
        waste_pct       = round(waste_pct,        4),
        actual_prdn     = round(actual_prdn,      4),
        std_gps         = round(std_gps,          4),
        actual_gps      = round(actual_gps,       4),
        diff_plus_minus = round(diff,             4),
        con_40s_gps     = round(con_40s_gps,      4),
        eff_pct         = round(eff_pct,          2),
        total_stop      = round(total_stop,       0),
    )
