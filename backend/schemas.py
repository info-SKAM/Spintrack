from pydantic import BaseModel
from typing import Optional
from datetime import date


class EntryRowIn(BaseModel):
    temp_id:        str
    rf_no:          str
    count:          str
    no_of_spindles: int
    spdl_speed:     float
    tpi:            float
    std_hank:       float
    conv_factor:    float = 0.0   # from count_master
    conv_40s:       float = 1.0   # from count_master
    act_hank:       float = 0
    stop_min:       float = 0
    pne_bondas:     float = 0     # user entry — wastage KG
    woh:   float = 0; mw:    float = 0; clg_lc: float = 0
    er:    float = 0; la_pf: float = 0; bss:    float = 0
    lap:   float = 0; dd:    float = 0


class SaveShiftIn(BaseModel):
    date:    date
    shift:   str
    mill:    str
    entries: list[EntryRowIn]


class PatchRowIn(BaseModel):
    conv_factor:    Optional[float] = None
    conv_40s:       float = 1.0
    act_hank:       Optional[float] = None
    stop_min:       Optional[float] = None
    pne_bondas:     Optional[float] = None
    woh:    Optional[float] = None; mw:    Optional[float] = None
    clg_lc: Optional[float] = None; er:   Optional[float] = None
    la_pf:  Optional[float] = None; bss:  Optional[float] = None
    lap:    Optional[float] = None; dd:   Optional[float] = None


# ── Machine Master ────────────────────────────────────────────────────────
class MachineMasterIn(BaseModel):
    mill:           str
    department:     str = "SPINNING"
    rf_no:          str
    count:          str
    no_of_spindles: int
    spdl_speed:     float
    tpi:            float
    std_hank:       float

class MachineMasterUpdate(BaseModel):
    mill:           Optional[str]   = None
    department:     Optional[str]   = None
    count:          Optional[str]   = None
    no_of_spindles: Optional[int]   = None
    spdl_speed:     Optional[float] = None
    tpi:            Optional[float] = None
    std_hank:       Optional[float] = None


# ── Count Master ──────────────────────────────────────────────────────────
class CountMasterIn(BaseModel):
    count:                        str
    actual_count:                 float
    spinning_count_efficiency:    float
    spinning_std_hank_efficiency: float
    conversion_factor:            float
    conv_40s:                     float

class CountMasterUpdate(BaseModel):
    actual_count:                 Optional[float] = None
    spinning_count_efficiency:    Optional[float] = None
    spinning_std_hank_efficiency: Optional[float] = None
    conversion_factor:            Optional[float] = None
    conv_40s:                     Optional[float] = None


# ── Admin Control ─────────────────────────────────────────────────────────
class AdminInsertIn(BaseModel):
    date:  date
    shift: str
    mill:  str
