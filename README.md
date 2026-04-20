# SpinTrack — Spinning Production Management

Full-stack production management app:
**React + Vite** frontend · **FastAPI (Python)** backend · **Neon DB (PostgreSQL)**

---

## Pages

| Tab | Description |
|-----|-------------|
| **Admin Control** | Select date/shift/mill → preview all frames → bulk-insert into daily_working |
| **Daily Entry**   | Load frames (auto-detects DB records or fresh master) → enter Act Hank + Stop Min → real-time calc → save |
| **History**       | Filter saved records by mill + date range, view shift summaries, export CSV |
| **Machine Master**| Full CRUD — view, add, edit, delete frames with inline editing |
| **Count Master**  | Full CRUD — manage count types, efficiencies, conversion factors |

---

## Workflow

```
1. Machine Master / Count Master  — set up reference data (seeded from your XLSX)

2. Admin Control                  — for each day/shift/mill:
   Select Date + Shift + Mill → Preview Frames → Insert into Daily Working
   (creates rows with act_hank=0, stop_min=0 ready for operators)

3. Daily Entry                    — operators open app on mobile/desktop:
   Select Date + Shift + Mill → Load Frames
   → If admin pre-inserted: loads existing DB rows (cyan "from DB" badge)
   → If not yet inserted:   loads fresh from machine master
   Enter Act Hank + Stop Min per frame → all 12 fields calculate instantly
   → Save / Update DB

4. History                        — review shift summaries, export CSV
```

---

## Setup

### 1. Neon DB
Create a free project at **https://console.neon.tech**
Copy the **psycopg2 connection string** (format: `postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require`)

### 2. Backend
```bash
cd spintrack/backend
cp .env.example .env          # paste DATABASE_URL
pip install -r requirements.txt
python database.py            # creates tables + seeds 76 machines + 33 counts
uvicorn main:app --reload --port 8000
# API docs → http://localhost:8000/docs
```

### 3. Frontend
```bash
cd spintrack/frontend
npm install
npm run dev                   # → http://localhost:5173
```

---

## API Reference

### Masters
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/mills` | Distinct mill names |
| GET | `/api/frames?mill=` | Frames for mill (joined with conv_40s) |
| GET/POST | `/api/machine-master` | List all / create machine |
| PUT/DELETE | `/api/machine-master/{id}` | Update / delete machine |
| GET/POST | `/api/count-master` | List all / create count |
| PUT/DELETE | `/api/count-master/{id}` | Update / delete count |

### Daily Working
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/daily-working` | Filter by date, shift, mill |
| POST | `/api/daily-working/save` | Save full shift (new records) |
| PATCH | `/api/daily-working/{id}` | Update single row (recalculates) |
| GET | `/api/summary?date=&mill=` | Per-shift efficiency summary |
| GET | `/api/history?mill=&from_date=&to_date=` | Date-range history |

### Admin
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/admin/check-exists?date=&shift=&mill=` | Check if shift already in DB |
| POST | `/api/admin/insert-daily-working` | Bulk insert frames from machine master |

---

## Formula Reference

| Field | Formula |
|-------|---------|
| Worked Spindles | `spindles × (480 − stop_min) / 480` |
| Std GPS | `spdl_speed × std_hank / (tpi × 36 × 840) × 1000` |
| Target KGS | `spindles × std_gps / 1000` |
| Act GPS | `std_gps / std_hank × act_hank` |
| Actual Prdn | `worked_spindles × act_gps / 1000` |
| Prodn KGS | `worked_spindles × std_gps / 1000` |
| 40s CON GPS | `act_gps × conv_40s` |
| Diff ± | `std_gps − act_gps` |
| Eff % | `act_gps / std_gps × 100` |
| Total Stop | `W.O.H + MW + CLG/LC + ER + LA,PF + BSS + LAP + DD` |

Both `formulas.js` (JS, real-time preview) and `formulas.py` (Python, DB writes) use identical constants.

---

## Production Deployment

**Backend** (Railway / Render / any Python host):
```bash
uvicorn main:app --host 0.0.0.0 --port $PORT
```

**Frontend** (Vercel / Netlify):
```bash
npm run build   # outputs to dist/
```
Update `vite.config.js` proxy target to your deployed API URL.
