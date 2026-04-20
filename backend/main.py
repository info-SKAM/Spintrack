import os
import uuid
from typing import Optional
from functools import lru_cache

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from database import get_conn
from formulas import calc_row, calc_conversion_factor, calc_std_hank
from schemas import (SaveShiftIn, PatchRowIn, MachineMasterIn, MachineMasterUpdate,
                     CountMasterIn, CountMasterUpdate, AdminInsertIn)

load_dotenv()

app = FastAPI(title="SpinTrack API", version="2.0.0")

_origins = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health ────────────────────────────────────────────────────────────────
@app.get("/api/health")
def health():
    return {"status": "ok"}


# ── Mills + Frames ────────────────────────────────────────────────────────
@app.get("/api/mills")
def get_mills():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT DISTINCT mill FROM machine_master ORDER BY mill")
            return [r["mill"] for r in cur.fetchall()]


@app.get("/api/frames")
def get_frames(mill: str = Query(...)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT m.*,
                       COALESCE(c.conversion_factor, 0)            AS conv_factor_stored,
                       COALESCE(c.conv_40s, 1)                     AS conv_40s,
                       COALESCE(c.actual_count, 0)                 AS actual_count,
                       COALESCE(c.spinning_count_efficiency, 0)    AS spinning_count_efficiency,
                       COALESCE(c.spinning_std_hank_efficiency, 0) AS spinning_std_hank_efficiency
                FROM machine_master m
                LEFT JOIN count_master c ON c.count = m.count
                WHERE m.mill = %s
                ORDER BY m.id
            """, (mill,))
            rows = []
            for r in cur.fetchall():
                row = dict(r)
                # Compute conv_factor from formula
                row["conv_factor"] = calc_conversion_factor(
                    row["actual_count"],
                    row["spinning_count_efficiency"]
                )
                # Compute std_hank from formula
                row["std_hank"] = calc_std_hank(
                    row["spinning_std_hank_efficiency"],
                    row["spdl_speed"],
                    row["tpi"]
                )
                rows.append(row)
            return rows


# ── Combined load endpoint — replaces 3 sequential calls with 1 ──────────
@app.get("/api/load-shift")
def load_shift(date: str = Query(...), shift: str = Query(...), mill: str = Query(...)):
    """
    Single endpoint that returns everything needed for Daily Entry in one DB call:
    - frames from machine master (with computed conv_factor + std_hank)
    - existing daily_working records for this date/shift/mill (if any)
    - count of existing records
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            # 1. Load frames + count master in one JOIN
            cur.execute("""
                SELECT m.*,
                       COALESCE(c.conv_40s, 1)                     AS conv_40s,
                       COALESCE(c.actual_count, 0)                 AS actual_count,
                       COALESCE(c.spinning_count_efficiency, 0)    AS spinning_count_efficiency,
                       COALESCE(c.spinning_std_hank_efficiency, 0) AS spinning_std_hank_efficiency
                FROM machine_master m
                LEFT JOIN count_master c ON c.count = m.count
                WHERE m.mill = %s ORDER BY m.id
            """, (mill,))
            raw_frames = cur.fetchall()
            frames = []
            for r in raw_frames:
                row = dict(r)
                row["conv_factor"] = calc_conversion_factor(row["actual_count"], row["spinning_count_efficiency"])
                row["std_hank"]    = calc_std_hank(row["spinning_std_hank_efficiency"], row["spdl_speed"], row["tpi"])
                frames.append(row)

            # 2. Load existing daily_working records
            cur.execute("""
                SELECT * FROM daily_working
                WHERE date=%s AND shift=%s AND mill=%s
                ORDER BY rf_no
            """, (date, shift, mill))
            existing = [dict(r) for r in cur.fetchall()]

    return {
        "frames":   frames,
        "existing": existing,
        "exists":   len(existing) > 0,
        "count":    len(existing),
    }


# ── Daily Working ─────────────────────────────────────────────────────────
@app.get("/api/daily-working")
def get_daily_working(
    date:  Optional[str] = None,
    shift: Optional[str] = None,
    mill:  Optional[str] = None,
):
    with get_conn() as conn:
        with conn.cursor() as cur:
            filters, params = [], []
            if date:  filters.append("date = %s");  params.append(date)
            if shift: filters.append("shift = %s"); params.append(shift)
            if mill:  filters.append("mill = %s");  params.append(mill)
            where = ("WHERE " + " AND ".join(filters)) if filters else ""
            cur.execute(
                f"SELECT * FROM daily_working {where} ORDER BY date DESC, shift, rf_no LIMIT 500",
                params
            )
            return [dict(r) for r in cur.fetchall()]


def _build_entry(row_id, run_id, body_date, body_shift, body_mill, entry, c):
    return (
        row_id, run_id, body_date, body_shift, body_mill,
        entry.no_of_spindles, entry.rf_no, entry.count,
        entry.spdl_speed, entry.tpi, entry.std_hank,
        entry.conv_factor, entry.conv_40s,
        entry.act_hank, entry.stop_min, entry.pne_bondas,
        c.worked_spindles, c.target_kgs, c.prodn_kgs,
        c.waste_pct, c.actual_prdn,
        c.std_gps, c.actual_gps, c.diff_plus_minus, c.con_40s_gps, c.eff_pct,
        entry.woh, entry.mw, entry.clg_lc, entry.er,
        entry.la_pf, entry.bss, entry.lap, entry.dd, c.total_stop,
    )


@app.post("/api/daily-working/save")
def save_shift(body: SaveShiftIn):
    conn = get_conn()
    try:
        cur = conn.cursor()

        # Block save entirely if ANY records already exist for this date/shift/mill
        cur.execute(
            "SELECT COUNT(*) AS cnt FROM daily_working WHERE date=%s AND shift=%s AND mill=%s",
            (body.date, body.shift, body.mill)
        )
        existing_count = cur.fetchone()["cnt"]
        if existing_count > 0:
            raise HTTPException(
                409,
                f"Records already exist for {body.mill} / {body.shift} / {body.date} "
                f"({existing_count} records). Load Frames from Daily Entry to update existing records."
            )

        # Safe to insert — no existing records
        run_id = str(uuid.uuid4())
        cur.execute(
            "INSERT INTO production_runs (run_id, entry_date, mill, department, shift) VALUES (%s,%s,%s,'SPINNING',%s)",
            (run_id, body.date, body.mill, body.shift)
        )
        # Build all rows in Python first (no DB round trips)
        all_rows = []
        for entry in body.entries:
            row_id = str(uuid.uuid4()).replace("-","")[:8]
            c = calc_row(
                no_of_spindles=entry.no_of_spindles,
                std_hank=entry.std_hank,
                act_hank=entry.act_hank, stop_min=entry.stop_min,
                conv_factor=entry.conv_factor, conv_40s=entry.conv_40s,
                pne_bondas=entry.pne_bondas,
                woh=entry.woh, mw=entry.mw, clg_lc=entry.clg_lc,
                er=entry.er, la_pf=entry.la_pf, bss=entry.bss,
                lap=entry.lap, dd=entry.dd,
            )
            all_rows.append(_build_entry(row_id, run_id, body.date, body.shift, body.mill, entry, c))

        # Single bulk INSERT — one DB round trip for all 40 rows
        cur.executemany("""
            INSERT INTO daily_working (
                id, run_id, date, shift, mill, department,
                spindles_installed, rf_no, count, spdl_speed, tpi, std_hank,
                conv_factor, conv_40s,
                act_hank, stop_min, pne_bondas,
                worked_spindles, target_kgs, prodn_kgs,
                waste_pct, actual_prdn,
                std_gps, actual_gps, diff_plus_minus, con_40s_gps, eff_pct,
                woh, mw, clg_lc, er, la_pf, bss, lap, dd, total_stop
            ) VALUES (
                %s,%s,%s,%s,%s,'SPINNING',
                %s,%s,%s,%s,%s,%s,
                %s,%s,
                %s,%s,%s,
                %s,%s,%s,
                %s,%s,
                %s,%s,%s,%s,%s,
                %s,%s,%s,%s,%s,%s,%s,%s,%s
            )
        """, all_rows)
        saved = len(all_rows)

        conn.commit()
        cur.close()
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(500, f"Save failed: {str(e)}")
    finally:
        conn.close()

    return {"success": True, "run_id": run_id, "saved": saved}


@app.patch("/api/daily-working/{row_id}")
def patch_row(row_id: str, body: PatchRowIn):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM daily_working WHERE id = %s", (row_id,))
            existing = cur.fetchone()
            if not existing:
                raise HTTPException(404, "Row not found")
            r = dict(existing)
            def pick(f): v = getattr(body, f); return v if v is not None else (r.get(f) or 0)
            c = calc_row(
                no_of_spindles=r["spindles_installed"],
                std_hank=r["std_hank"],
                act_hank=pick("act_hank"), stop_min=pick("stop_min"),
                conv_factor=pick("conv_factor") or r.get("conv_factor", 0),
                conv_40s=body.conv_40s or r.get("conv_40s", 1),
                pne_bondas=pick("pne_bondas"),
                woh=pick("woh"), mw=pick("mw"), clg_lc=pick("clg_lc"),
                er=pick("er"), la_pf=pick("la_pf"), bss=pick("bss"),
                lap=pick("lap"), dd=pick("dd"),
            )
            cur.execute("""
                UPDATE daily_working SET
                    act_hank=%s, stop_min=%s, pne_bondas=%s,
                    worked_spindles=%s, target_kgs=%s, prodn_kgs=%s,
                    waste_pct=%s, actual_prdn=%s,
                    std_gps=%s, actual_gps=%s, diff_plus_minus=%s,
                    con_40s_gps=%s, eff_pct=%s,
                    woh=%s, mw=%s, clg_lc=%s, er=%s, la_pf=%s,
                    bss=%s, lap=%s, dd=%s, total_stop=%s, updated_at=NOW()
                WHERE id=%s RETURNING *
            """, (
                pick("act_hank"), pick("stop_min"), pick("pne_bondas"),
                c.worked_spindles, c.target_kgs, c.prodn_kgs,
                c.waste_pct, c.actual_prdn,
                c.std_gps, c.actual_gps, c.diff_plus_minus,
                c.con_40s_gps, c.eff_pct,
                pick("woh"), pick("mw"), pick("clg_lc"), pick("er"), pick("la_pf"),
                pick("bss"), pick("lap"), pick("dd"), c.total_stop,
                row_id,
            ))
            updated = dict(cur.fetchone())
        conn.commit()
    return updated


@app.post("/api/daily-working/update-all")
def update_all_rows(body: dict):
    """
    Bulk update all rows for a shift in one transaction.
    Receives list of {id, act_hank, stop_min, pne_bondas, conv_factor, conv_40s,
                       woh, mw, clg_lc, er, la_pf, bss, lap, dd}
    Returns count of updated rows.
    """
    rows = body.get("rows", [])
    if not rows:
        raise HTTPException(400, "No rows provided")

    conn = get_conn()
    try:
        cur = conn.cursor()

        # Fetch all existing rows in ONE query
        ids = [r["id"] for r in rows]
        cur.execute("SELECT * FROM daily_working WHERE id = ANY(%s)", (ids,))
        existing_map = {r["id"]: dict(r) for r in cur.fetchall()}

        # Compute all updates in Python
        update_params = []
        for row in rows:
            rid = row["id"]
            if rid not in existing_map:
                continue
            ex = existing_map[rid]
            def flt(k): return float(row.get(k) or ex.get(k) or 0)
            c = calc_row(
                no_of_spindles=ex["spindles_installed"],
                std_hank=float(ex["std_hank"] or 0),
                act_hank=flt("act_hank"), stop_min=flt("stop_min"),
                conv_factor=flt("conv_factor"), conv_40s=flt("conv_40s") or 1,
                pne_bondas=flt("pne_bondas"),
                woh=flt("woh"), mw=flt("mw"), clg_lc=flt("clg_lc"),
                er=flt("er"), la_pf=flt("la_pf"), bss=flt("bss"),
                lap=flt("lap"), dd=flt("dd"),
            )
            update_params.append((
                flt("act_hank"), flt("stop_min"), flt("pne_bondas"),
                c.worked_spindles, c.target_kgs, c.prodn_kgs,
                c.waste_pct, c.actual_prdn,
                c.std_gps, c.actual_gps, c.diff_plus_minus,
                c.con_40s_gps, c.eff_pct,
                flt("woh"), flt("mw"), flt("clg_lc"), flt("er"), flt("la_pf"),
                flt("bss"), flt("lap"), flt("dd"), c.total_stop,
                rid,
            ))

        # Single bulk UPDATE — one executemany for all rows
        cur.executemany("""
            UPDATE daily_working SET
                act_hank=%s, stop_min=%s, pne_bondas=%s,
                worked_spindles=%s, target_kgs=%s, prodn_kgs=%s,
                waste_pct=%s, actual_prdn=%s,
                std_gps=%s, actual_gps=%s, diff_plus_minus=%s,
                con_40s_gps=%s, eff_pct=%s,
                woh=%s, mw=%s, clg_lc=%s, er=%s, la_pf=%s,
                bss=%s, lap=%s, dd=%s, total_stop=%s, updated_at=NOW()
            WHERE id=%s
        """, update_params)

        updated = len(update_params)
        conn.commit()
        cur.close()
    except Exception as e:
        conn.rollback()
        raise HTTPException(500, f"Bulk update failed: {str(e)}")
    finally:
        conn.close()

    return {"updated": updated}


@app.delete("/api/daily-working/{row_id}", status_code=204)
def delete_daily_working_row(row_id: str):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM daily_working WHERE id = %s", (row_id,))
            if cur.rowcount == 0:
                raise HTTPException(404, "Row not found")
        conn.commit()


# ── Summary & History ─────────────────────────────────────────────────────
@app.get("/api/summary")
def get_summary(date: str = Query(...), mill: str = Query(...)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT shift,
                    COUNT(*) AS frames,
                    ROUND(SUM(target_kgs)::numeric,  2) AS total_target,
                    ROUND(SUM(actual_prdn)::numeric, 2) AS total_actual,
                    CASE WHEN SUM(target_kgs) > 0
                        THEN ROUND((SUM(actual_prdn)/SUM(target_kgs)*100)::numeric, 1)
                        ELSE 0 END AS efficiency_pct,
                    SUM(total_stop)::int AS total_stop_mins
                FROM daily_working
                WHERE date = %s AND mill = %s
                GROUP BY shift ORDER BY shift
            """, (date, mill))
            return [dict(r) for r in cur.fetchall()]


@app.get("/api/history")
def get_history(
    mill:      str = Query(...),
    from_date: str = Query("2020-01-01"),
    to_date:   str = Query("2099-12-31"),
):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT date, shift, rf_no, count,
                       act_hank, stop_min, pne_bondas,
                       target_kgs, prodn_kgs, actual_prdn,
                       std_gps, actual_gps, diff_plus_minus, eff_pct,
                       total_stop, updated_at
                FROM daily_working
                WHERE mill = %s AND date BETWEEN %s AND %s
                ORDER BY date DESC, shift, rf_no
                LIMIT 1000
            """, (mill, from_date, to_date))
            return [dict(r) for r in cur.fetchall()]


# ── Machine Master CRUD ───────────────────────────────────────────────────
@app.get("/api/machine-master")
def get_machine_master(mill: Optional[str] = None):
    with get_conn() as conn:
        with conn.cursor() as cur:
            if mill:
                cur.execute("SELECT * FROM machine_master WHERE mill=%s ORDER BY id", (mill,))
            else:
                cur.execute("SELECT * FROM machine_master ORDER BY mill, id")
            return [dict(r) for r in cur.fetchall()]


@app.post("/api/machine-master", status_code=201)
def create_machine(body: MachineMasterIn):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO machine_master (mill,department,rf_no,count,no_of_spindles,spdl_speed,tpi,std_hank)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *
            """, (body.mill,body.department,body.rf_no,body.count,
                  body.no_of_spindles,body.spdl_speed,body.tpi,body.std_hank))
            row = dict(cur.fetchone())
        conn.commit()
    return row


@app.put("/api/machine-master/{machine_id}")
def update_machine(machine_id: int, body: MachineMasterUpdate):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM machine_master WHERE id=%s", (machine_id,))
            existing = cur.fetchone()
            if not existing: raise HTTPException(404, "Machine not found")
            r = dict(existing)
            def pick(f): v=getattr(body,f); return v if v is not None else r[f]
            cur.execute("""
                UPDATE machine_master SET mill=%s,department=%s,count=%s,
                no_of_spindles=%s,spdl_speed=%s,tpi=%s,std_hank=%s
                WHERE id=%s RETURNING *
            """, (pick("mill"),pick("department"),pick("count"),
                  pick("no_of_spindles"),pick("spdl_speed"),pick("tpi"),pick("std_hank"),machine_id))
            row = dict(cur.fetchone())
        conn.commit()
    return row


@app.delete("/api/machine-master/{machine_id}", status_code=204)
def delete_machine(machine_id: int):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM machine_master WHERE id=%s", (machine_id,))
            if cur.rowcount == 0: raise HTTPException(404, "Machine not found")
        conn.commit()


# ── Count Master CRUD ─────────────────────────────────────────────────────
@app.get("/api/count-master")
def get_count_master_list():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM count_master ORDER BY count")
            return [dict(r) for r in cur.fetchall()]


@app.post("/api/count-master", status_code=201)
def create_count(body: CountMasterIn):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO count_master
                    (count,actual_count,spinning_count_efficiency,
                     spinning_std_hank_efficiency,conversion_factor,conv_40s)
                VALUES (%s,%s,%s,%s,%s,%s)
                ON CONFLICT (count) DO UPDATE SET
                    actual_count=EXCLUDED.actual_count,
                    spinning_count_efficiency=EXCLUDED.spinning_count_efficiency,
                    spinning_std_hank_efficiency=EXCLUDED.spinning_std_hank_efficiency,
                    conversion_factor=EXCLUDED.conversion_factor,
                    conv_40s=EXCLUDED.conv_40s
                RETURNING *
            """, (body.count,body.actual_count,body.spinning_count_efficiency,
                  body.spinning_std_hank_efficiency,body.conversion_factor,body.conv_40s))
            row = dict(cur.fetchone())
        conn.commit()
    return row


@app.put("/api/count-master/{count_id}")
def update_count(count_id: int, body: CountMasterUpdate):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM count_master WHERE id=%s", (count_id,))
            existing = cur.fetchone()
            if not existing: raise HTTPException(404, "Count not found")
            r = dict(existing)
            def pick(f): v=getattr(body,f); return v if v is not None else r[f]
            cur.execute("""
                UPDATE count_master SET actual_count=%s,spinning_count_efficiency=%s,
                spinning_std_hank_efficiency=%s,conversion_factor=%s,conv_40s=%s
                WHERE id=%s RETURNING *
            """, (pick("actual_count"),pick("spinning_count_efficiency"),
                  pick("spinning_std_hank_efficiency"),pick("conversion_factor"),
                  pick("conv_40s"),count_id))
            row = dict(cur.fetchone())
        conn.commit()
    return row


@app.delete("/api/count-master/{count_id}", status_code=204)
def delete_count(count_id: int):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM count_master WHERE id=%s", (count_id,))
            if cur.rowcount == 0: raise HTTPException(404, "Count not found")
        conn.commit()


# ── Admin Control ─────────────────────────────────────────────────────────
@app.post("/api/admin/insert-daily-working")
def admin_insert_daily_working(body: AdminInsertIn):
    conn = get_conn()
    try:
        cur = conn.cursor()

        # Step 1: load frames from machine master
        cur.execute("""
            SELECT m.*,
                   COALESCE(c.conv_40s, 1)                     AS conv_40s,
                   COALESCE(c.actual_count, 0)                 AS actual_count,
                   COALESCE(c.spinning_count_efficiency, 0)    AS spinning_count_efficiency,
                   COALESCE(c.spinning_std_hank_efficiency, 0) AS spinning_std_hank_efficiency
            FROM machine_master m
            LEFT JOIN count_master c ON c.count = m.count
            WHERE m.mill = %s ORDER BY m.id
        """, (body.mill,))
        raw_frames = [dict(r) for r in cur.fetchall()]
        if not raw_frames:
            raise HTTPException(404, f"No frames found for mill {body.mill}")

        # Compute derived values
        frames = []
        for r in raw_frames:
            r["conv_factor"] = calc_conversion_factor(r["actual_count"], r["spinning_count_efficiency"])
            r["std_hank"]    = calc_std_hank(r["spinning_std_hank_efficiency"], r["spdl_speed"], r["tpi"])
            frames.append(r)

        # Step 2: find which rf_nos already exist for this exact date/shift/mill
        cur.execute(
            "SELECT rf_no FROM daily_working WHERE date=%s AND shift=%s AND mill=%s",
            (body.date, body.shift, body.mill)
        )
        existing_rf_nos = {r["rf_no"] for r in cur.fetchall()}

        # Step 3: only insert frames that don't already exist
        frames_to_insert = [f for f in frames if f["rf_no"] not in existing_rf_nos]
        skipped = len(frames) - len(frames_to_insert)

        if not frames_to_insert:
            # Nothing to insert — all already exist
            conn.rollback()
            return {
                "success": True,
                "inserted": 0,
                "skipped": skipped,
                "total_frames": len(frames),
                "message": f"All {skipped} frames already exist for {body.mill} · {body.shift} · {body.date}. Nothing inserted.",
            }

        # Step 4: create a production run and insert only the new frames
        run_id = str(uuid.uuid4())
        cur.execute(
            "INSERT INTO production_runs (run_id,entry_date,mill,department,shift) VALUES (%s,%s,%s,'SPINNING',%s)",
            (run_id, body.date, body.mill, body.shift)
        )

        inserted = 0
        for frame in frames_to_insert:
            row_id = str(uuid.uuid4()).replace("-","")[:8]
            c = calc_row(
                no_of_spindles=frame["no_of_spindles"],
                std_hank=frame["std_hank"],
                act_hank=0, stop_min=0, pne_bondas=0,
                conv_factor=frame["conv_factor"],
                conv_40s=frame["conv_40s"],
            )
            cur.execute("""
                INSERT INTO daily_working (
                    id, run_id, date, shift, mill, department,
                    spindles_installed, rf_no, count, spdl_speed, tpi, std_hank,
                    conv_factor, conv_40s,
                    act_hank, stop_min, pne_bondas,
                    worked_spindles, target_kgs, prodn_kgs,
                    waste_pct, actual_prdn,
                    std_gps, actual_gps, diff_plus_minus, con_40s_gps, eff_pct,
                    woh, mw, clg_lc, er, la_pf, bss, lap, dd, total_stop
                ) VALUES (
                    %s,%s,%s,%s,%s,'SPINNING',
                    %s,%s,%s,%s,%s,%s,
                    %s,%s,
                    0,0,0,
                    %s,%s,%s,
                    %s,%s,
                    %s,%s,%s,%s,%s,
                    0,0,0,0,0,0,0,0,0
                )
            """, (
                row_id, run_id, body.date, body.shift, body.mill,
                frame["no_of_spindles"], frame["rf_no"], frame["count"],
                frame["spdl_speed"], frame["tpi"], frame["std_hank"],
                frame["conv_factor"], frame["conv_40s"],
                c.worked_spindles, c.target_kgs, c.prodn_kgs,
                c.waste_pct, c.actual_prdn,
                c.std_gps, c.actual_gps, c.diff_plus_minus, c.con_40s_gps, c.eff_pct,
            ))
            inserted += 1

        conn.commit()
        cur.close()
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(500, f"Insert failed: {str(e)}")
    finally:
        conn.close()

    return {
        "success": True,
        "run_id": run_id,
        "inserted": inserted,
        "skipped": skipped,
        "total_frames": len(frames),
        "message": f"Inserted {inserted} new frames. {skipped} already existed — skipped.",
    }


@app.get("/api/admin/check-exists")
def check_shift_exists(date: str = Query(...), shift: str = Query(...), mill: str = Query(...)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) AS cnt FROM daily_working WHERE date=%s AND shift=%s AND mill=%s",
                (date, shift, mill)
            )
            cnt = cur.fetchone()["cnt"]
    return {"exists": cnt > 0, "count": cnt}


# ═══════════════════════════════════════════════════════════════════════════
# REPORTS
# ═══════════════════════════════════════════════════════════════════════════
from fastapi.responses import Response
from report_engine import fetch_report_data, generate_pdf


@app.get("/api/report/options")
def report_options():
    """Return distinct mills, counts, shifts for the report filter UI."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT DISTINCT mill  FROM daily_working ORDER BY mill")
            mills = [r["mill"] for r in cur.fetchall()]
            cur.execute("SELECT DISTINCT count FROM daily_working ORDER BY count")
            counts = [r["count"] for r in cur.fetchall()]
            cur.execute("SELECT DISTINCT shift FROM daily_working ORDER BY shift")
            shifts = [r["shift"] for r in cur.fetchall()]
            cur.execute("SELECT DISTINCT date  FROM daily_working ORDER BY date DESC LIMIT 60")
            dates = [str(r["date"]) for r in cur.fetchall()]
    return {"mills": mills, "counts": counts, "shifts": shifts, "dates": dates}


@app.get("/api/report/data")
def report_data(
    date:       Optional[str] = None,
    from_date:  Optional[str] = None,
    to_date:    Optional[str] = None,
    shift:      Optional[str] = None,
    mill:       Optional[str] = None,
    count:      Optional[str] = None,
):
    filters = {
        "date": date, "from_date": from_date, "to_date": to_date,
        "shift": shift, "mill": mill, "count": count,
    }
    with get_conn() as conn:
        data = fetch_report_data(conn, filters)
    return data


@app.get("/api/report/pdf")
def report_pdf(
    date:        Optional[str] = None,
    from_date:   Optional[str] = None,
    to_date:     Optional[str] = None,
    shift:       Optional[str] = None,
    mill:        Optional[str] = None,
    count:       Optional[str] = None,
    report_type: str = "Standard",
):
    filters = {
        "date": date, "from_date": from_date, "to_date": to_date,
        "shift": shift, "mill": mill, "count": count,
    }
    with get_conn() as conn:
        data = fetch_report_data(conn, filters)
    if not data:
        raise HTTPException(404, "No data found for the selected filters")

    pdf_bytes = generate_pdf(data, filters, report_type)

    # Build filename
    d = date or (f"{from_date}_to_{to_date}" if from_date else "all")
    s = shift or "ALL"
    m = mill  or "ALL"
    filename = f"SpinTrack_Report_{d}_{m}_{s}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@app.delete("/api/daily-working/duplicates")
def delete_duplicates(date: str = Query(...), shift: str = Query(...), mill: str = Query(...)):
    """
    For a given date/shift/mill, keep only the LATEST record per rf_no
    and delete all older duplicates. Returns count of deleted rows.
    """
    conn = get_conn()
    try:
        cur = conn.cursor()

        # Step 1: find all rf_nos that have duplicates
        cur.execute("""
            SELECT rf_no, COUNT(*) as cnt
            FROM daily_working
            WHERE date = %s AND shift = %s AND mill = %s
            GROUP BY rf_no
            HAVING COUNT(*) > 1
        """, (date, shift, mill))
        dup_rf_nos = [r["rf_no"] for r in cur.fetchall()]

        total_deleted = 0

        # Step 2: for each duplicate rf_no, keep only the latest id
        for rf_no in dup_rf_nos:
            cur.execute("""
                SELECT id FROM daily_working
                WHERE date = %s AND shift = %s AND mill = %s AND rf_no = %s
                ORDER BY created_at DESC
            """, (date, shift, mill, rf_no))
            ids = [r["id"] for r in cur.fetchall()]
            keep_id = ids[0]           # latest
            delete_ids = ids[1:]       # all older ones

            if delete_ids:
                cur.execute(
                    "DELETE FROM daily_working WHERE id = ANY(%s)",
                    (delete_ids,)
                )
                total_deleted += cur.rowcount

        conn.commit()
        cur.close()
    except Exception as e:
        conn.rollback()
        raise HTTPException(500, f"Dedup failed: {str(e)}")
    finally:
        conn.close()

    return {
        "deleted": total_deleted,
        "rf_nos_fixed": len(dup_rf_nos),
        "message": f"Removed {total_deleted} duplicate rows across {len(dup_rf_nos)} RF Nos"
    }


@app.post("/api/admin/fix-constraint")
def add_unique_constraint():
    """
    One-time migration: add unique constraint on (date, shift, mill, rf_no)
    and clean up any existing duplicates first.
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            # Step 1 — delete duplicates keeping latest
            cur.execute("""
                DELETE FROM daily_working
                WHERE id IN (
                    SELECT id FROM (
                        SELECT id,
                               ROW_NUMBER() OVER (
                                   PARTITION BY date, shift, mill, rf_no
                                   ORDER BY created_at DESC
                               ) AS rn
                        FROM daily_working
                    ) ranked
                    WHERE rn > 1
                )
            """)
            deleted = cur.rowcount

            # Step 2 — add unique constraint (safe — won't error if exists)
            cur.execute("""
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint
                        WHERE conname = 'uq_daily_working_date_shift_mill_rf'
                    ) THEN
                        ALTER TABLE daily_working
                        ADD CONSTRAINT uq_daily_working_date_shift_mill_rf
                        UNIQUE (date, shift, mill, rf_no);
                    END IF;
                END $$;
            """)
        conn.commit()
    return {"deleted_duplicates": deleted, "constraint": "uq_daily_working_date_shift_mill_rf added"}


@app.delete("/api/daily-working/duplicates/all")
def delete_all_duplicates():
    """
    Clean ALL duplicates across entire daily_working table.
    Keeps the latest record per (date, shift, mill, rf_no).
    """
    conn = get_conn()
    try:
        cur = conn.cursor()

        # Find all duplicate groups
        cur.execute("""
            SELECT date, shift, mill, rf_no, COUNT(*) as cnt
            FROM daily_working
            GROUP BY date, shift, mill, rf_no
            HAVING COUNT(*) > 1
        """)
        dup_groups = cur.fetchall()
        total_deleted = 0

        for g in dup_groups:
            cur.execute("""
                SELECT id FROM daily_working
                WHERE date = %s AND shift = %s AND mill = %s AND rf_no = %s
                ORDER BY created_at DESC
            """, (g["date"], g["shift"], g["mill"], g["rf_no"]))
            ids = [r["id"] for r in cur.fetchall()]
            keep_id  = ids[0]
            del_ids  = ids[1:]
            if del_ids:
                cur.execute("DELETE FROM daily_working WHERE id = ANY(%s)", (del_ids,))
                total_deleted += cur.rowcount

        conn.commit()
        cur.close()
    except Exception as e:
        conn.rollback()
        raise HTTPException(500, f"Bulk dedup failed: {str(e)}")
    finally:
        conn.close()

    return {
        "deleted": total_deleted,
        "groups_fixed": len(dup_groups),
        "message": f"Removed {total_deleted} duplicates across {len(dup_groups)} groups"
    }
