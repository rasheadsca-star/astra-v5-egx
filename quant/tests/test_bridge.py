"""اختبارات الجسر ASTRA ← Quant. التشغيل: python tests/test_bridge.py"""
import sys, os, json, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
for sub in ("..", "../tools", "../fetch"): sys.path.insert(0, os.path.join(HERE, sub))
sys.path.insert(0, HERE)
import astra_bridge as B, daily_update as U, test_daily_update as T

def astra_root(syms, canon_rows=None):
    root = tempfile.mkdtemp(); os.makedirs(os.path.join(root, "data"))
    json.dump(dict(generatedAt="2026-10-02T09:00:00Z", symbols=syms), open(os.path.join(root, "data", "history-index.json"), "w"))
    json.dump(dict(source=dict(expectedSession="2026-09-30", coveragePct=93.4, sourceSessionDataHash="h"), rows=canon_rows or []), open(os.path.join(root, "data", "canonical-market.json"), "w"))
    return root
def srow(d, c, src="mubasher_symbol_pages_precise_enriched", flat=False):
    return dict(ticker="X", date=d, open=c if flat else c-1, high=c if flat else c+1, low=c if flat else c-2, close=c, volume=1000, source=src)
def sym(rows, warnings=None, primary="yahoo"): return dict(lastSession=rows[-1]["date"], primarySource=primary, warnings=warnings or [], sessions=rows)

def test_only_sessions_newer_than_quant_store_and_previous_close():
    q = T.make_root(3)                                                      # آخر جلسة محلية 2026-09-29
    rows = [srow("2026-09-28", 100), srow("2026-09-29", 101), srow("2026-09-30", 103)]
    ar = astra_root({"T00": sym(rows), "T01": sym(rows), "T02": sym(rows)})
    pack = B.build_pack(ar, os.path.join(q, "data", "history"))
    assert pack["meta"]["sessions"] == ["2026-09-30"] and len(pack["rows"]) == 3
    r = pack["rows"][0]; assert r["previousClose"] == 101 and r["date"] == "2026-09-30" and r["sourceSessionDate"] == "2026-09-30"
    assert r["validationStatus"] == "precise_public_source_session_confirmed" and r["source"] == "astra_atomic_history_index" and r["confidence"]["overall"] == 85

def test_flags_yahoo_status_flat_ohlc_and_canonical_timestamp():
    q = T.make_root(2); rows = [srow("2026-09-29", 101), srow("2026-09-30", 103, src="yahoo", flat=True)]
    ar = astra_root({"T00": sym(rows, warnings=["corporate_action_review_required:x", "latest_close_conflict:48%"]), "T01": sym([srow("2026-09-29", 101), srow("2026-09-30", 104)])},
                    canon_rows=[dict(symbol="T01", sourceSessionDate="2026-09-30", sourceMarketTime="01:29 PM market time"), dict(symbol="T00", sourceSessionDate="2026-09-29", sourceMarketTime="old")])
    pack = B.build_pack(ar, os.path.join(q, "data", "history")); by = {r["symbol"]: r for r in pack["rows"]}
    assert by["T00"]["validationStatus"] == "yahoo_daily_unverified" and "flat_ohlc_possible_reconstruction" in by["T00"]["warnings"]
    assert "corporate_action_review_required:x" in by["T00"]["warnings"] and not any("latest_close_conflict" in w for w in by["T00"]["warnings"])    # يحمل التحذيرات المهمة فقط
    assert by["T01"]["sourceMarketTime"] == "01:29 PM market time" and by["T00"]["sourceMarketTime"] is None                                          # الوقت فقط إذا طابقت الجلسة

def test_nothing_to_do_when_quant_is_current():
    q = T.make_root(2); rows = [srow("2026-09-28", 100), srow("2026-09-29", 101)]
    assert B.build_pack(astra_root({"T00": sym(rows), "T01": sym(rows)}), os.path.join(q, "data", "history"))["rows"] == []

def test_bridge_pack_passes_all_daily_update_guards_end_to_end():
    q = T.make_root(20)
    syms = {f"T{i:02d}": sym([srow("2026-09-29", 100.0 + 0), srow("2026-09-30", 101.5)]) for i in range(20)}
    syms["T00"] = sym([srow("2026-09-29", 100.0), srow("2026-09-30", 300.0)])                               # قفزة 200%: يجب أن يحجزها المُحدِّث
    syms["T01"] = sym([srow("2026-09-29", 100.0), dict(srow("2026-09-30", 101.0), high=90.0)])               # OHLC خاطئ
    pack = B.build_pack(astra_root(syms), os.path.join(q, "data", "history")); T.put_pack(q, pack["rows"] and [dict(r) for r in pack["rows"]])
    s = T.run(q, stage1=T.stage_ok)
    assert s["finalStatus"] == "SUCCESS" or s["finalStatus"] == "PARTIAL", s["finalStatus"]
    assert s["actualAcceptedSession"] == "2026-09-30" and s["acceptedRows"] == 18 and s["quarantinedCount"] == 2
    assert "2026-09-30" not in T.sessions(q, "T00") and "2026-09-30" not in T.sessions(q, "T01") and "2026-09-30" in T.sessions(q, "T05")

if __name__ == "__main__":
    fs = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for f in fs: f(); print("PASS", f.__name__)
    print(len(fs), "tests passed")
