"""
Report Engine — generates production reports matching Standard_Report_2026-03-20.pdf format.
Uses reportlab for PDF generation.
"""
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import (SimpleDocTemplate, Table, TableStyle,
                                 Paragraph, Spacer, HRFlowable)
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from io import BytesIO
import datetime


# ── Colour palette (dark industrial) ─────────────────────────────────────
C_HEADER    = colors.HexColor('#1a2235')   # dark navy
C_HEADER_TXT= colors.white
C_MILL_ROW  = colors.HexColor('#1e2a3a')   # slightly lighter navy
C_MILL_TXT  = colors.HexColor('#a5b4fc')   # indigo light
C_TOTAL_ROW = colors.HexColor('#111827')
C_TOTAL_TXT = colors.HexColor('#10b981')   # emerald
C_GRAND_ROW = colors.HexColor('#0d1424')
C_GRAND_TXT = colors.HexColor('#f59e0b')   # amber
C_ALT       = colors.HexColor('#161f30')
C_WHITE     = colors.HexColor('#edf2f7')
C_BORDER    = colors.HexColor('#1c2a3f')
C_GREEN     = colors.HexColor('#10b981')
C_RED       = colors.HexColor('#f43f5e')
C_AMBER     = colors.HexColor('#f59e0b')
C_MUTED     = colors.HexColor('#64748b')


def n2(v, dec=2):
    if v is None: return '—'
    try: return f'{float(v):.{dec}f}'
    except: return '—'

def n1(v):  return n2(v, 1)
def n0(v):  return n2(v, 0)
def pct(v): 
    if v is None: return '—'
    try: return f'{float(v)*100:.1f}%' if float(v) <= 1 else f'{float(v):.1f}%'
    except: return '—'


def build_report_query(filters: dict) -> tuple[str, list]:
    """Build the aggregation SQL from filter params."""
    wheres, params = [], []

    if filters.get('date'):
        wheres.append("date = %s"); params.append(filters['date'])
    elif filters.get('from_date') and filters.get('to_date'):
        wheres.append("date BETWEEN %s AND %s")
        params += [filters['from_date'], filters['to_date']]

    if filters.get('shift') and filters['shift'] != 'ALL':
        wheres.append("shift = %s"); params.append(filters['shift'])

    if filters.get('mill') and filters['mill'] != 'ALL':
        wheres.append("mill = %s"); params.append(filters['mill'])

    if filters.get('count') and filters['count'] != 'ALL':
        wheres.append("count = %s"); params.append(filters['count'])

    where_sql = ("WHERE " + " AND ".join(wheres)) if wheres else ""

    sql = f"""
        SELECT
            mill,
            count,
            ROUND(AVG(CASE WHEN act_hank > 0 THEN act_hank END)::numeric, 2) AS avg_count,
            -- frames_run: same logic as daily entry — exclude act_hank=0 AND woh>=480
            COUNT(CASE WHEN NOT (act_hank = 0 AND COALESCE(woh,0) >= 480) THEN 1 END) AS frames_run,
            COUNT(*)                                                            AS frames_installed,
            SUM(spindles_installed)::numeric                                    AS spls_alloted,
            ROUND(SUM(worked_spindles)::numeric, 1)                            AS spls_worked,
            ROUND((SUM(worked_spindles) / NULLIF(SUM(spindles_installed),0) * 100)::numeric, 1) AS uti_pct,
            ROUND(SUM(target_kgs)::numeric, 1)                                 AS target_kgs_total,
            -- Target KGS (Run):
            --   Not run:       act_hank=0 AND woh>=480 → 0
            --   Fully run:     act_hank>0 AND total_stop=0 → target_kgs
            --   Partially run: act_hank>0 → target_kgs * (480 - (total_stop - dd)) / 480
            ROUND(SUM(
                CASE
                    -- Not run: act_hank=0 AND woh=480 → 0
                    WHEN act_hank = 0 AND COALESCE(woh,0) >= 480
                        THEN 0
                    -- Fully run: total_stop=0 → full target
                    WHEN act_hank > 0 AND COALESCE(total_stop,0) = 0
                        THEN target_kgs
                    -- Partially run: effective_stop = total_stop - DD
                    ELSE target_kgs * (480 - GREATEST(0, COALESCE(total_stop,0) - COALESCE(dd,0))) / 480
                END
            )::numeric, 1) AS target_kgs_run,
            ROUND(SUM(actual_prdn)::numeric, 1)                                AS actual_kgs,
            ROUND((SUM(actual_prdn) / NULLIF(SUM(CASE WHEN stop_min < 480 THEN target_kgs END),0) * 100)::numeric, 1) AS eff_pct_run,
            SUM(woh)::int    AS woh,
            SUM(mw)::int     AS mw,
            SUM(clg_lc)::int AS clg_lc,
            SUM(er)::int     AS er,
            SUM(la_pf)::int  AS la_pf,
            SUM(bss)::int    AS bss,
            SUM(lap)::int    AS lap,
            SUM(dd)::int     AS dd,
            SUM(total_stop)::int                                                AS stop_total,
            ROUND((SUM(target_kgs) * 1000 / NULLIF(SUM(spindles_installed),0))::numeric, 2)    AS target_prod_spl,
            ROUND((SUM(actual_prdn) * 1000 / NULLIF(SUM(worked_spindles),0))::numeric, 2)      AS actual_prod_spl,
            ROUND(AVG(spdl_speed)::numeric, 0)                                 AS avg_speed,
            ROUND((SUM(target_kgs) * 1000 / NULLIF(SUM(spindles_installed),0) * 0.704)::numeric, 2) AS target_40s,
            ROUND(AVG(std_gps)::numeric, 2)                                    AS std_gps_avg,
            ROUND(AVG(actual_gps)::numeric, 2)                                 AS actual_gps_avg
        FROM daily_working
        {where_sql}
        GROUP BY mill, count
        ORDER BY mill, count
    """
    return sql, params


def fetch_report_data(conn, filters: dict) -> list[dict]:
    sql, params = build_report_query(filters)
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return [dict(r) for r in cur.fetchall()]


def generate_pdf(data: list[dict], filters: dict, report_type: str) -> bytes:
    """Generate a PDF report matching the Standard_Report format."""
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=landscape(A4),
        leftMargin=8*mm, rightMargin=8*mm,
        topMargin=10*mm, bottomMargin=8*mm,
    )

    styles = {
        'title': ParagraphStyle('title', fontSize=13, textColor=C_WHITE,
                                 fontName='Helvetica-Bold', alignment=TA_CENTER),
        'subtitle': ParagraphStyle('sub', fontSize=8, textColor=C_MUTED,
                                    fontName='Helvetica', alignment=TA_CENTER),
        'meta': ParagraphStyle('meta', fontSize=7, textColor=C_MUTED,
                                fontName='Helvetica', alignment=TA_LEFT),
    }

    story = []

    # ── Title block ────────────────────────────────────────────────────────
    date_label = _build_date_label(filters)
    mill_label = filters.get('mill', 'ALL') or 'ALL MILLS'
    shift_label = filters.get('shift', 'ALL') or 'ALL SHIFTS'
    count_label = filters.get('count', 'ALL') or 'ALL COUNTS'

    story.append(Paragraph(f"PRODUCTION REPORT: {date_label}", styles['title']))
    story.append(Paragraph(
        f"Mill: {mill_label}  ·  Shift: {shift_label}  ·  Count: {count_label}  ·  Type: {report_type}",
        styles['subtitle']
    ))
    story.append(Spacer(1, 4*mm))

    # ── Build table ────────────────────────────────────────────────────────
    headers = [
        'Mill', 'Count', 'Avg\nCount',
        'Frames\nRun', 'Frames\nInstalled',
        'Spls\nAlloted', 'Spls\nWorked', 'Uti\n%',
        'Target KGS\n(Total)', 'Target KGS\n(Run)', 'Actual\nKGS', 'Eff%\n(Run)',
        'WOH', 'MW', 'CLG\nLC', 'ER', 'LA\nPF', 'BSS', 'LAP', 'DD',
        'Stop\n(min)',
        'Tgt Prod\n/Spl(g)', 'Act Prod\n/Spl(g)',
        'Avg\nSpeed', '40s\nTgt g',
        'Std\nGPS', 'Act\nGPS',
    ]

    # Group by mill
    mills_order = []
    mill_groups = {}
    for row in data:
        m = row['mill']
        if m not in mill_groups:
            mill_groups[m] = []
            mills_order.append(m)
        mill_groups[m].append(row)

    table_data = [headers]
    style_cmds = [
        # Header
        ('BACKGROUND',  (0,0), (-1,0), C_HEADER),
        ('TEXTCOLOR',   (0,0), (-1,0), C_HEADER_TXT),
        ('FONTNAME',    (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE',    (0,0), (-1,0), 6),
        ('ALIGN',       (0,0), (-1,0), 'CENTER'),
        ('VALIGN',      (0,0), (-1,-1), 'MIDDLE'),
        ('GRID',        (0,0), (-1,-1), 0.3, C_BORDER),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.HexColor('#0f1622'), C_ALT]),
        ('FONTSIZE',    (0,1), (-1,-1), 6.5),
        ('FONTNAME',    (0,1), (-1,-1), 'Helvetica'),
        ('TEXTCOLOR',   (0,1), (-1,-1), C_WHITE),
        ('ALIGN',       (2,1), (-1,-1), 'RIGHT'),
        ('ALIGN',       (0,1), (1,-1), 'LEFT'),
        ('TOPPADDING',  (0,0), (-1,-1), 2),
        ('BOTTOMPADDING',(0,0),(-1,-1), 2),
        ('LEFTPADDING', (0,0), (-1,-1), 3),
        ('RIGHTPADDING',(0,0), (-1,-1), 3),
    ]

    row_idx = 1
    grand_totals = _zero_totals()

    for mill in mills_order:
        mill_rows = mill_groups[mill]
        mill_totals = _zero_totals()

        for r in mill_rows:
            row = _format_row(r)
            table_data.append(row)
            _add_to_totals(mill_totals, r)
            _add_to_totals(grand_totals, r)
            row_idx += 1

        # Mill total row
        mill_total_row = _format_total_row(mill, 'TOTAL', mill_totals)
        table_data.append(mill_total_row)
        style_cmds += [
            ('BACKGROUND',  (0,row_idx), (-1,row_idx), C_MILL_ROW),
            ('TEXTCOLOR',   (0,row_idx), (-1,row_idx), C_MILL_TXT),
            ('FONTNAME',    (0,row_idx), (-1,row_idx), 'Helvetica-Bold'),
            ('FONTSIZE',    (0,row_idx), (-1,row_idx), 6.5),
        ]
        row_idx += 1

    # Grand total row
    grand_row = _format_total_row('ALL MILLS', 'GRAND TOTAL', grand_totals)
    table_data.append(grand_row)
    style_cmds += [
        ('BACKGROUND',  (0,row_idx), (-1,row_idx), C_GRAND_ROW),
        ('TEXTCOLOR',   (0,row_idx), (-1,row_idx), C_GRAND_TXT),
        ('FONTNAME',    (0,row_idx), (-1,row_idx), 'Helvetica-Bold'),
        ('FONTSIZE',    (0,row_idx), (-1,row_idx), 7),
        ('LINEABOVE',   (0,row_idx), (-1,row_idx), 0.8, C_AMBER),
    ]

    # Column widths (landscape A4 = ~277mm usable)
    col_widths = [
        16, 16, 8,   # Mill, Count, Avg Count
        8,  8,        # Frames run, installed
        14, 14, 9,   # Spls alloted, worked, uti%
        14, 14, 13, 9,  # Target KGS total, run, actual, eff%
        6, 6, 6, 6, 6, 6, 6, 6,  # Stop categories
        10,           # Stop total
        12, 12,       # Prod/spl
        10, 10,       # Avg speed, 40s
        10, 10,       # GPS
    ]
    col_widths = [w * mm for w in col_widths]

    table = Table(table_data, colWidths=col_widths, repeatRows=1)
    table.setStyle(TableStyle(style_cmds))
    story.append(table)

    # Footer
    story.append(Spacer(1, 3*mm))
    gen_time = datetime.datetime.now().strftime('%d-%b-%Y %H:%M')
    story.append(Paragraph(
        f"Generated: {gen_time}  ·  SpinTrack Production Management",
        styles['meta']
    ))

    doc.build(story)
    return buf.getvalue()


def _build_date_label(filters):
    if filters.get('date'):
        try:
            d = datetime.date.fromisoformat(str(filters['date']))
            return d.strftime('%d-%b-%Y')
        except: return str(filters['date'])
    elif filters.get('from_date') and filters.get('to_date'):
        return f"{filters['from_date']} to {filters['to_date']}"
    return 'All Dates'


def _format_row(r):
    return [
        r.get('mill',''), r.get('count',''),
        n1(r.get('avg_count')),
        n0(r.get('frames_run')), n0(r.get('frames_installed')),
        n0(r.get('spls_alloted')), n1(r.get('spls_worked')),
        f"{n1(r.get('uti_pct'))}%",
        n1(r.get('target_kgs_total')), n1(r.get('target_kgs_run')),
        n1(r.get('actual_kgs')), f"{n1(r.get('eff_pct_run'))}%",
        n0(r.get('woh')), n0(r.get('mw')), n0(r.get('clg_lc')),
        n0(r.get('er')), n0(r.get('la_pf')), n0(r.get('bss')),
        n0(r.get('lap')), n0(r.get('dd')), n0(r.get('stop_total')),
        n2(r.get('target_prod_spl')), n2(r.get('actual_prod_spl')),
        n0(r.get('avg_speed')), n2(r.get('target_40s')),
        n2(r.get('std_gps_avg')), n2(r.get('actual_gps_avg')),
    ]


def _zero_totals():
    return {k: 0.0 for k in [
        'frames_run','frames_installed','spls_alloted','spls_worked',
        'target_kgs_total','target_kgs_run','actual_kgs',
        'woh','mw','clg_lc','er','la_pf','bss','lap','dd','stop_total',
        'std_gps_sum','actual_gps_sum','count_rows',
        'target_prod_spl_sum','actual_prod_spl_sum','avg_speed_sum',
    ]}


def _add_to_totals(totals, r):
    totals['frames_run']         += float(r.get('frames_run') or 0)
    totals['frames_installed']   += float(r.get('frames_installed') or 0)
    totals['spls_alloted']       += float(r.get('spls_alloted') or 0)
    totals['spls_worked']        += float(r.get('spls_worked') or 0)
    totals['target_kgs_total']   += float(r.get('target_kgs_total') or 0)
    totals['target_kgs_run']     += float(r.get('target_kgs_run') or 0)
    totals['actual_kgs']         += float(r.get('actual_kgs') or 0)
    for k in ['woh','mw','clg_lc','er','la_pf','bss','lap','dd','stop_total']:
        totals[k] += float(r.get(k) or 0)
    totals['std_gps_sum']        += float(r.get('std_gps_avg') or 0)
    totals['actual_gps_sum']     += float(r.get('actual_gps_avg') or 0)
    totals['avg_speed_sum']      += float(r.get('avg_speed') or 0)
    totals['count_rows']         += 1


def _format_total_row(mill_label, count_label, t):
    n = t['count_rows'] or 1
    uti   = (t['spls_worked'] / t['spls_alloted'] * 100) if t['spls_alloted'] else 0
    eff   = (t['actual_kgs'] / t['target_kgs_run'] * 100) if t['target_kgs_run'] else 0
    tprod = (t['target_kgs_total'] * 1000 / t['spls_alloted']) if t['spls_alloted'] else 0
    aprod = (t['actual_kgs'] * 1000 / t['spls_worked']) if t['spls_worked'] else 0
    return [
        mill_label, count_label, '',
        int(t['frames_run']), int(t['frames_installed']),
        int(t['spls_alloted']), f"{t['spls_worked']:.1f}",
        f"{uti:.1f}%",
        f"{t['target_kgs_total']:.1f}", f"{t['target_kgs_run']:.1f}",
        f"{t['actual_kgs']:.1f}", f"{eff:.1f}%",
        int(t['woh']), int(t['mw']), int(t['clg_lc']),
        int(t['er']), int(t['la_pf']), int(t['bss']),
        int(t['lap']), int(t['dd']), int(t['stop_total']),
        f"{tprod:.2f}", f"{aprod:.2f}",
        f"{t['avg_speed_sum']/n:.0f}", '',
        f"{t['std_gps_sum']/n:.2f}", f"{t['actual_gps_sum']/n:.2f}",
    ]
