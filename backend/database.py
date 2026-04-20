import os
import psycopg
import psycopg_pool
from psycopg.rows import dict_row
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")


_pool = None

def get_pool():
    global _pool
    if _pool is None:
        _pool = psycopg_pool.ConnectionPool(
            DATABASE_URL,
            min_size=1,
            max_size=5,
            kwargs={"row_factory": dict_row},
            open=True,
        )
    return _pool

def get_conn():
    return get_pool().connection()


def migrate():
    conn = psycopg.connect(DATABASE_URL, row_factory=dict_row)
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS count_master (
            id SERIAL PRIMARY KEY,
            count TEXT UNIQUE NOT NULL,
            actual_count NUMERIC,
            spinning_count_efficiency NUMERIC,
            spinning_std_hank_efficiency NUMERIC,
            conversion_factor NUMERIC,
            conv_40s NUMERIC
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS machine_master (
            id SERIAL PRIMARY KEY,
            mill TEXT NOT NULL,
            department TEXT NOT NULL,
            rf_no TEXT NOT NULL,
            count TEXT NOT NULL,
            no_of_spindles INTEGER NOT NULL,
            spdl_speed NUMERIC NOT NULL,
            tpi NUMERIC NOT NULL,
            std_hank NUMERIC NOT NULL,
            UNIQUE(mill, rf_no)
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS production_runs (
            run_id TEXT PRIMARY KEY,
            entry_date DATE NOT NULL,
            mill TEXT NOT NULL,
            department TEXT NOT NULL,
            shift TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS daily_working (
            id TEXT PRIMARY KEY,
            run_id TEXT REFERENCES production_runs(run_id) ON DELETE CASCADE,
            date DATE NOT NULL,
            shift TEXT NOT NULL,
            mill TEXT NOT NULL,
            department TEXT NOT NULL DEFAULT 'SPINNING',
            spindles_installed INTEGER NOT NULL,
            rf_no TEXT NOT NULL,
            count TEXT NOT NULL,
            spdl_speed NUMERIC,
            tpi NUMERIC,
            std_hank NUMERIC,
            conv_factor NUMERIC DEFAULT 0,
            conv_40s NUMERIC DEFAULT 1,
            act_hank NUMERIC DEFAULT 0,
            stop_min NUMERIC DEFAULT 0,
            pne_bondas NUMERIC DEFAULT 0,
            worked_spindles NUMERIC,
            target_kgs NUMERIC,
            prodn_kgs NUMERIC,
            waste_pct NUMERIC DEFAULT 0,
            actual_prdn NUMERIC,
            std_gps NUMERIC,
            actual_gps NUMERIC,
            diff_plus_minus NUMERIC,
            con_40s_gps NUMERIC,
            eff_pct NUMERIC DEFAULT 0,
            woh NUMERIC DEFAULT 0,
            mw NUMERIC DEFAULT 0,
            clg_lc NUMERIC DEFAULT 0,
            er NUMERIC DEFAULT 0,
            la_pf NUMERIC DEFAULT 0,
            bss NUMERIC DEFAULT 0,
            lap NUMERIC DEFAULT 0,
            dd NUMERIC DEFAULT 0,
            total_stop NUMERIC DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)

    # Add new columns to existing tables (safe — ignored if already exist)
    for col_sql in [
        "ALTER TABLE daily_working ADD COLUMN IF NOT EXISTS conv_factor NUMERIC DEFAULT 0",
        "ALTER TABLE daily_working ADD COLUMN IF NOT EXISTS conv_40s NUMERIC DEFAULT 1",
        "ALTER TABLE daily_working ADD COLUMN IF NOT EXISTS eff_pct NUMERIC DEFAULT 0",
    ]:
        try:
            cur.execute(col_sql)
        except Exception:
            pass

    cur.execute("CREATE INDEX IF NOT EXISTS idx_dw_date ON daily_working(date)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_dw_mill ON daily_working(mill)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_dw_shift ON daily_working(shift)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_dw_date_shift_mill ON daily_working(date, shift, mill)")

    # Unique constraint — prevents duplicate mill/date/shift/rf_no from any source
    cur.execute("""
        DO $$
        BEGIN
            -- Clean duplicates first (keep latest)
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
            );
            -- Add constraint if not exists
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

    # ── Seed count master ──────────────────────────────────────────────────
    counts = [
        ("40SPSF",  41,   93, 96, 0.01039961, 0.704),
        ("63SPSF",  63.5, 93, 97, 0.006643,   1.328),
        ("28SPSF",  29,   93, 94, 0.014546,   0.481),
        ("30SPSF",  31,   92, 94, 0.013462,   0.481),
        ("40SPSFS", 41,   94, 96, 0.010400,   0.704),
        ("38SPSF",  38.5, 93, 96, 0.010957,   0.686),
        ("80SPSF",  81,   95, 97, 0.005320,   2.202),
        ("60SPSF",  60.5, 93, 97, 0.006973,   1.236),
        ("57SPC",   58,   93, 97, 0.007273,   1.364),
        ("57SPSFL", 58,   93, 97, 0.007273,   1.364),
        ("57SPSF",  58,   93, 97, 0.007273,   1.364),
        ("40SPSFL", 41,   93, 96, 0.010400,   0.704),
        ("20SPC",   20,   92, 95, 0.014706,   0.369),
        ("60SPC",   60.5, 93, 97, 0.006973,   1.236),
        ("61spc",   61,   93, 97, 0.006973,   1.236),
        ("20SPSF",  20,   92, 95, 0.014706,   0.369),
        ("41SPSF",  41,   93, 96, 0.010400,   0.704),
        ("41SPSFS", 41,   94, 96, 0.010400,   0.704),
        ("10SPSF",  10,   91, 93, 0.040370,   0.146),
        ("11SPSF",  11,   91, 93, 0.033333,   0.169),
        ("30SPSFL", 31,   92, 94, 0.013462,   0.481),
        ("45SPSFHT",46,   94, 96, 0.007812,   0.960),
        ("20SPSFL", 20,   92, 95, 0.014706,   0.369),
        ("21SPC",   21,   92, 95, 0.014085,   0.384),
        ("25SPSFL", 25,   92, 95, 0.011628,   0.614),
        ("4.6SPSF", 4.6,  90, 92, 0.250000,   0.046),
        ("15SPC",   15,   92, 95, 0.019608,   0.270),
        ("30SPC",   30,   92, 94, 0.013462,   0.481),
        ("50SPSF",  50.5, 93, 96, 0.008547,   0.940),
        ("50SPSFHT",50.5, 94, 96, 0.008547,   0.940),
        ("50SPSFL", 50.5, 93, 96, 0.008547,   0.940),
        ("45SPSF",  46,   93, 96, 0.007812,   0.960),
    ]
    for row in counts:
        cur.execute("""
            INSERT INTO count_master
                (count, actual_count, spinning_count_efficiency,
                 spinning_std_hank_efficiency, conversion_factor, conv_40s)
            VALUES (%s,%s,%s,%s,%s,%s)
            ON CONFLICT (count) DO UPDATE SET
                actual_count=EXCLUDED.actual_count,
                conversion_factor=EXCLUDED.conversion_factor,
                conv_40s=EXCLUDED.conv_40s
        """, row)

    # ── Seed machine master ────────────────────────────────────────────────
    machines = [
        ("B-MILL","SPINNING","B1","10SPSF",816,9928.0,9.32,14.7112591),
        ("B-MILL","SPINNING","B2","11SPSF",816,10283.0,9.54,14.885912),
        ("B-MILL","SPINNING","B3","11SPSF",816,10283.0,9.54,14.885912),
        ("B-MILL","SPINNING","B4","20SPSF",816,13213.0,13.4,14.7132707),
        ("B-MILL","SPINNING","B5","10SPSF",816,10059.0,9.32,14.9053742),
        ("B-MILL","SPINNING","B6","41SPSF",816,15097.0,18.21,12.6338779),
        ("B-MILL","SPINNING","B7","41SPSF",816,14628.0,18.21,12.2413967),
        ("B-MILL","SPINNING","B8","41SPSF",816,15188.0,18.21,12.710031),
        ("B-MILL","SPINNING","B9","41SPSF",816,15378.0,18.21,12.8690319),
        ("B-MILL","SPINNING","B10","41SPSF",816,15253.0,18.21,12.7644261),
        ("B-MILL","SPINNING","B11","41SPSF",816,13729.0,18.21,11.4890714),
        ("B-MILL","SPINNING","B12","41SPSF",816,13729.0,18.66,11.2120037),
        ("C-MILL","SPINNING","C1","41SPSFS",1104,12223.0,21.58,8.6314218),
        ("C-MILL","SPINNING","C2","41SPSF",1104,15733.0,18.66,12.8486018),
        ("C-MILL","SPINNING","C3","41SPSF",1104,13823.0,18.66,11.2887703),
        ("C-MILL","SPINNING","C4","41SPSF",1104,14478.0,18.66,11.8236863),
        ("C-MILL","SPINNING","C5","41SPSF",1104,13898.0,18.66,11.3500202),
        ("C-MILL","SPINNING","C6","41SPSF",1104,13213.0,18.66,10.7906042),
        ("C-MILL","SPINNING","C7","41SPSF",1104,13838.0,18.66,11.3010203),
        ("C-MILL","SPINNING","C8","41SPSF",1104,15048.0,18.66,12.2891858),
        ("C-MILL","SPINNING","C9","41SPSF",1104,15778.0,18.21,13.2037707),
        ("C-MILL","SPINNING","C10","41SPSF",1104,15279.0,18.66,12.4778356),
        ("C-MILL","SPINNING","C11","38SPSF",1104,14362.0,18.21,12.0187955),
        ("C-MILL","SPINNING","C12","38SPSF",1104,14689.0,18.21,12.2924444),
        ("A-MILL","SPINNING","1","20SPC",480,12500.0,14.55,12.8191612),
        ("A-MILL","SPINNING","2","20SPC",480,12500.0,14.55,12.8191612),
        ("A-MILL","SPINNING","3","45SPSFHT",480,16000.0,35.51,6.8663396),
        ("A-MILL","SPINNING","4","45SPSFHT",480,16003.0,35.51,6.867627),
        ("A-MILL","SPINNING","5","45SPSFHT",480,16003.0,35.51,6.867627),
        ("A-MILL","SPINNING","6","45SPSFHT",480,16003.0,35.51,6.867627),
        ("A-MILL","SPINNING","7","60SPC",480,16473.0,25.29,10.0295244),
        ("A-MILL","SPINNING","8","60SPC",480,16003.0,25.29,9.7433666),
        ("A-MILL","SPINNING","9","60SPC",480,16003.0,25.29,9.7433666),
        ("A-MILL","SPINNING","10","60SPC",480,16898.0,25.43,10.2316438),
        ("A-MILL","SPINNING","11","60SPC",480,15723.0,25.43,9.520188),
        ("A-MILL","SPINNING","12","60SPC",480,15723.0,25.43,9.520188),
        ("A-MILL","SPINNING","13","60SPC",480,15723.0,25.3,9.5691059),
        ("A-MILL","SPINNING","14","40SPSF",480,16083.0,18.77,13.0574616),
        ("A-MILL","SPINNING","15","60SPC",480,16083.0,25.42,9.7419968),
        ("A-MILL","SPINNING","16","60SPC",480,16083.0,25.42,9.7419968),
        ("A-MILL","SPINNING","17","60SPC",480,16083.0,25.42,9.7419968),
        ("A-MILL","SPINNING","18","60SPC",480,16083.0,25.43,9.7381659),
        ("A-MILL","SPINNING","19","60SPC",480,16083.0,25.43,9.7381659),
        ("A-MILL","SPINNING","20","60SPC",480,16083.0,25.43,9.7381659),
        ("A-MILL","SPINNING","21","60SPC",480,16083.0,25.43,9.7381659),
        ("A-MILL","SPINNING","22","60SPC",480,16083.0,25.43,9.7381659),
        ("A-MILL","SPINNING","23","60SPC",480,14000.0,25.38,8.4936212),
        ("A-MILL","SPINNING","24","60SPC",480,14000.0,25.38,8.4936212),
        ("A-MILL","SPINNING","25","60SPC",480,14000.0,25.38,8.4936212),
        ("A-MILL","SPINNING","26","20SPC",480,13500.0,14.67,13.731445),
        ("A-MILL","SPINNING","39","60SPC",480,16192.0,25.38,9.8234796),
        ("A-MILL","SPINNING","40","40SPSFL",480,13200.0,19.33,10.4063408),
        ("A-MILL","SPINNING","41","57SPSFL",480,16061.0,24.33,10.1645216),
        ("A-MILL","SPINNING","42","57SPSFL",480,16061.0,23.89,10.3517292),
        ("A-MILL","SPINNING","43","57SPSFL",480,16061.0,24.06,10.2785873),
        ("A-MILL","SPINNING","44","57SPSFL",480,16507.0,24.06,10.5640147),
        ("A-MILL","SPINNING","45","57SPSFL",480,16507.0,24.06,10.5640147),
        ("A-MILL","SPINNING","46","57SPSFL",480,16423.0,24.06,10.5102571),
        ("A-MILL","SPINNING","47","60SPC",480,16423.0,25.36,9.9714821),
        ("A-MILL","SPINNING","48","60SPC",480,16423.0,25.36,9.9714821),
        ("A-MILL","SPINNING","49","60SPSF",480,16003.0,23.57,10.4543802),
        ("A-MILL","SPINNING","50","60SPC",480,16423.0,25.26,10.0109574),
        ("A-MILL","SPINNING","51","20SPC",480,12500.0,14.6,12.7752599),
        ("A-MILL","SPINNING","52","20SPC",480,12300.0,14.6,12.5708558),
        ("D-MILL","SPINNING","D1","10SPSF",816,9836.0,9.3,14.6062779),
        ("D-MILL","SPINNING","D2","61spc",816,15553.0,25.07,9.5524837),
        ("D-MILL","SPINNING","D3","21SPC",816,12778.0,13.37,14.2608058),
        ("D-MILL","SPINNING","D4","41SPSF",816,14068.0,18.18,11.7921895),
        ("D-MILL","SPINNING","D5","61spc",816,15346.0,25.07,9.4253466),
        ("D-MILL","SPINNING","D6","41SPSF",816,13998.0,18.18,11.7335135),
        ("D-MILL","SPINNING","D7","40SPSF",816,15303.0,19.08,12.2223348),
        ("D-MILL","SPINNING","D8","21SPC",816,11788.0,13.39,13.1362722),
        ("D-MILL","SPINNING","D9","25SPSFL",816,12610.0,14.73,12.7739416),
        ("D-MILL","SPINNING","D10","20SPSFL",816,11733.0,13.39,13.0749815),
        ("D-MILL","SPINNING","D11","20SPSFL",816,11468.0,13.39,12.7796716),
        ("D-MILL","SPINNING","D12","20SPSFL",816,12369.0,13.39,13.783725),
    ]
    for m in machines:
        cur.execute("""
            INSERT INTO machine_master
                (mill, department, rf_no, count, no_of_spindles, spdl_speed, tpi, std_hank)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (mill, rf_no) DO UPDATE SET
                count=EXCLUDED.count,
                no_of_spindles=EXCLUDED.no_of_spindles,
                spdl_speed=EXCLUDED.spdl_speed,
                tpi=EXCLUDED.tpi,
                std_hank=EXCLUDED.std_hank
        """, m)

    conn.commit()
    cur.close()
    conn.close()
    print("✅ Migration complete — tables created and masters seeded.")


if __name__ == "__main__":
    migrate()
