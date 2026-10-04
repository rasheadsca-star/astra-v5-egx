#!/usr/bin/env python3
"""جسر ASTRA ← Quant: يحوّل مخزن ASTRA الذري (data/history-index.json + data/canonical-market.json) إلى حزمة جلسة
في quant/data/inbox/ ليمر بنفس حراس fetch/daily_update.py (هوية الرمز، تاريخ الجلسة، OHLC، القفزات، التغطية، الجودة).

لا يحمل أي منطق قرار، ولا يكتب في مخزن ASTRA أبداً (قراءة فقط).
  python quant/tools/astra_bridge.py [--astra-root ..] [--since YYYY-MM-DD] [--max-sessions 5]
الإخراج: quant/data/inbox/ASTRA_SESSION_<من>_<إلى>.json (أو لا شيء إذا لا جديد)."""
import os, sys, json, glob, argparse, datetime as dt
Q = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FLAGS_KEEP = ("corporate_action", "delist", "quarantined", "not_officially_verified")        # تحذيرات الرمز التي نحملها إلى الصف

def read_json(p):
    with open(p, encoding="utf-8") as f: return json.load(f)

def quant_last_dates(hist_dir):
    out = {}
    for f in glob.glob(os.path.join(hist_dir, "*.json")):
        try:
            x = read_json(f); s = x.get("sessions") or []
            if s: out[x.get("ticker") or os.path.basename(f)[:-5]] = s[-1]["date"]
        except Exception: pass
    return out

def row_validation(src):
    s = (src or "").lower()
    if "precise" in s or "mubasher" in s or "egx" in s: return "precise_public_source_session_confirmed", 85
    if "yahoo" in s: return "yahoo_daily_unverified", 55
    return "supplemental_unverified", 40

def build_pack(astra_root, hist_dir, since=None, max_sessions=5):
    idx = read_json(os.path.join(astra_root, "data", "history-index.json")); syms = idx.get("symbols") or {}
    canon = {}
    try:
        cm = read_json(os.path.join(astra_root, "data", "canonical-market.json")); canon = {r.get("symbol"): r for r in cm.get("rows") or []}
    except Exception: cm = {}
    last = quant_last_dates(hist_dir); ld = sorted(last.values()); med = ld[len(ld)//2] if ld else "0000-00-00"; since = since or med
    all_dates = sorted({r["date"] for v in syms.values() for r in (v.get("sessions") or []) if r.get("date")})
    want = [d for d in all_dates if d > since][-max_sessions:]
    rows = []
    for t, v in sorted(syms.items()):
        sess = v.get("sessions") or []; prev = {}
        for a, b in zip(sess, sess[1:]): prev[b["date"]] = a["close"]
        keep = [w for w in (v.get("warnings") or []) if any(k in str(w).lower() for k in FLAGS_KEEP)]
        for r in sess:
            if r["date"] not in want: continue
            status, conf = row_validation(r.get("source") or v.get("primarySource"))
            c = canon.get(t) or {}; flags = list(keep)
            if r["open"] == r["high"] == r["low"] == r["close"]: flags.append("flat_ohlc_possible_reconstruction")
            rows.append(dict(symbol=t, date=r["date"], open=r["open"], high=r["high"], low=r["low"], close=r["close"], volume=r["volume"], previousClose=prev.get(r["date"]),
                             sourceSessionDate=r["date"], sourceMarketTime=c.get("sourceMarketTime") if c.get("sourceSessionDate") == r["date"] else None,
                             sourceUrl="astra://data/history-index.json", fetchedAt=idx.get("generatedAt"), source="astra_atomic_history_index", primarySource=r.get("source") or v.get("primarySource"),
                             validationStatus=status, confidence=dict(overall=conf, derivedFrom="astra_atomic_history_index"), warnings=flags, priceTruthMode="astra_atomic_mirror"))
    meta = dict(astraHistoryGeneratedAt=idx.get("generatedAt"), sessions=want, expectedSession=(cm.get("source") or {}).get("expectedSession"), coveragePct=(cm.get("source") or {}).get("coveragePct"),
                sourceSessionDataHash=(cm.get("source") or {}).get("sourceSessionDataHash"))
    return dict(schemaVersion="astra-bridge/v1", sourceProject="RAS-EGX-ASTRA-V5", generatedAt=dt.datetime.now(dt.timezone.utc).isoformat(), meta=meta, rows=rows)

def main(argv=None):
    ap = argparse.ArgumentParser(); ap.add_argument("--astra-root", default=os.path.dirname(Q)); ap.add_argument("--since"); ap.add_argument("--max-sessions", type=int, default=5)
    ap.add_argument("--out", default=os.path.join(Q, "data", "inbox")); a = ap.parse_args(argv)
    pack = build_pack(a.astra_root, os.path.join(Q, "data", "history"), a.since, a.max_sessions)
    if not pack["rows"]: print("لا جلسات جديدة في مخزن ASTRA"); return 0
    ds = pack["meta"]["sessions"]; os.makedirs(a.out, exist_ok=True); p = os.path.join(a.out, f"ASTRA_SESSION_{ds[0]}_{ds[-1]}.json")
    tmp = p + ".tmp"; json.dump(pack, open(tmp, "w", encoding="utf-8"), ensure_ascii=False); os.replace(tmp, p)
    print(f"حزمة {os.path.basename(p)}: {len(pack['rows'])} صفاً لجلسات {', '.join(ds)}"); return 0

if __name__ == "__main__": sys.exit(main())
