"""اختبارات المُحدِّث اليومي (A–H من البرومبت + حالات إضافية). التشغيل: python tests/test_daily_update.py"""
import sys, os, json, glob, hashlib, tempfile, datetime as dt
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fetch"))
import daily_update as U

SESS = ["2026-09-23", "2026-09-24", "2026-09-27", "2026-09-28", "2026-09-29"]          # آخر مخزّن = 29 (ثلاثاء)
NOW = dt.datetime(2026, 9, 30, 16, 0)                                                  # الأربعاء 16:00 القاهرة => المتوقعة 30/9
def hist_row(t, d, close=100.0, status="precise_public_source_session_confirmed", overall=86):
    return dict(ticker=t, date=d, open=close, high=close+1, low=close-1, close=close, volume=1000, validationStatus=status, confidence=dict(overall=overall), warnings=[], officialVerified=False)
def make_root(n=20, signals=True):
    root = tempfile.mkdtemp(); os.makedirs(os.path.join(root, "data", "history")); os.makedirs(os.path.join(root, "data", "inbox"))
    for i in range(n):
        t = f"T{i:02d}"; s = [hist_row(t, d) for d in SESS]
        U.atomic_write(os.path.join(root, "data", "history", t + ".json"), dict(ticker=t, historyStatus="historical_complete_100", warnings=[], sessions=s, lastSession=SESS[-1], availableSessions=len(s)))
    if signals: U.atomic_write(os.path.join(root, "data", "signals.json"), dict(recommendations=[dict(ticker="T00", tier="C")]*10, stale=False))
    return root
def prow(t, d="2026-09-30", close=101.0, **kw):
    r = dict(symbol=t, date=d, open=100.0, high=close+1, low=99.0, close=close, volume=5000, sourceSessionDate=d, sourceMarketTime="01:29 PM market time", sourceUrl="u", fetchedAt="x",
             primarySource="mubasher_symbol_pages_precise_enriched", validationStatus="precise_public_source_session_confirmed", confidence=dict(overall=86), warnings=[]); r.update(kw); return r
def put_pack(root, rows, name="pack.json"): json.dump(dict(rows=rows), open(os.path.join(root, "data", "inbox", name), "w"))
def digest(root): return hashlib.sha256(b"".join(open(f, "rb").read() for f in sorted(glob.glob(os.path.join(root, "data", "history", "*.json"))))).hexdigest()
def sessions(root, t): return [r["date"] for r in json.load(open(os.path.join(root, "data", "history", t + ".json")))["sessions"]]
def run(root, **kw): return U.run(root=root, now=NOW, holidays=set(), no_yahoo=True, **kw)
def stage_ok(): return dict(recommendations=[dict(ticker="X", tier="C")]*7, stale=False)

def test_A_source_shows_yesterday_waiting_no_overwrite():
    root = make_root(); put_pack(root, [prow(f"T{i:02d}", d="2026-09-29", close=77.0) for i in range(20)]); before = digest(root); sig = open(os.path.join(root, "data", "signals.json")).read()
    s = run(root, stage1=lambda: 1/0)
    assert s["finalStatus"] == "WAITING_DATA" and digest(root) == before and open(os.path.join(root, "data", "signals.json")).read() == sig
    assert s["originalRecommendationCount"] == 10 and s["preparedCandidateCount"] == 10 and not s["stage1Prepared"]

def test_B_late_timestamp_waiting():
    root = make_root(); put_pack(root, [prow(f"T{i:02d}", sourceMarketTime="10:05 AM market time") for i in range(20)]); before = digest(root)
    s = run(root); assert s["finalStatus"] == "WAITING_DATA" and digest(root) == before and s["quarantinedCount"] == 20
    put_pack(root, [prow(f"T{i:02d}", sourceMarketTime="29 September 01:28 PM market time") for i in range(20)])      # تاريخ صريح لجلسة سابقة
    assert run(root)["finalStatus"] == "WAITING_DATA" and digest(root) == before

def test_C_low_coverage_not_applied():
    root = make_root(); put_pack(root, [prow(f"T{i:02d}") for i in range(5)]); before = digest(root)
    s = run(root, stage1=lambda: 1/0); assert s["finalStatus"] == "WAITING_DATA" and digest(root) == before and s["coveragePct"] == 25.0 and s["sessionsSkipped"]

def test_D_idempotent_no_duplicates():
    root = make_root(); put_pack(root, [prow(f"T{i:02d}") for i in range(20)])
    s1 = run(root, stage1=stage_ok); d1 = digest(root); s2 = run(root, stage1=stage_ok, force=True)
    assert s1["finalStatus"] == "SUCCESS" and digest(root) == d1, "إعادة نفس الجلسة غيّرت الملفات"
    for t in ("T00", "T19"): ds = sessions(root, t); assert ds.count("2026-09-30") == 1 and ds == sorted(set(ds))

def test_E_verified_row_not_replaced_by_weaker_but_upgrade_allowed():
    root = make_root(); f = os.path.join(root, "data", "history", "T00.json"); x = json.load(open(f)); x["sessions"].append(hist_row("T00", "2026-09-30", close=222.0)); U.atomic_write(f, x)
    rows = [prow("T00", close=101.0, validationStatus=None, confidence=None, primarySource=None)] + [prow(f"T{i:02d}") for i in range(1, 20)]; put_pack(root, rows); run(root, stage1=stage_ok)
    assert [r for r in json.load(open(f))["sessions"] if r["date"] == "2026-09-30"][0]["close"] == 222.0
    root2 = make_root(); f2 = os.path.join(root2, "data", "history", "T00.json"); x = json.load(open(f2)); x["sessions"].append(hist_row("T00", "2026-09-30", close=50.0, status="supplemental_unverified", overall=0)); U.atomic_write(f2, x)
    put_pack(root2, [prow(f"T{i:02d}") for i in range(20)]); run(root2, stage1=stage_ok)
    assert [r for r in json.load(open(f2))["sessions"] if r["date"] == "2026-09-30"][0]["close"] == 101.0

def test_F_publication_gate_failure_keeps_prepared_count():
    root = make_root(); put_pack(root, [prow(f"T{i:02d}") for i in range(20)])
    s = run(root, stage1=lambda: dict(recommendations=[dict(ticker="X", tier="C")]*7, stale=True))
    assert s["stage1Prepared"] and s["preparedCandidateCount"] == 7 and s["originalRecommendationCount"] == 7 and s["publicationEligible"] is False

def test_G_full_session_updates_history_then_stage1():
    root = make_root(); put_pack(root, [prow(f"T{i:02d}") for i in range(20)]); order = []
    def stage():
        order.append(all(sessions(root, f"T{i:02d}")[-1] == "2026-09-30" for i in range(20))); return stage_ok()
    s = run(root, stage1=stage); assert order == [True], "Stage 1 شُغّل قبل تحديث التاريخ"
    assert s["finalStatus"] == "SUCCESS" and s["historyUpdated"] and s["stage1Prepared"] and s["actualAcceptedSession"] == "2026-09-30" and s["coveragePct"] == 100.0
    assert json.load(open(os.path.join(root, "data", "daily-data-update-status.json")))["finalStatus"] == "SUCCESS"

def test_H_second_run_same_day_already_current():
    root = make_root(); put_pack(root, [prow(f"T{i:02d}") for i in range(20)]); calls = []
    run(root, stage1=lambda: calls.append(1) or stage_ok()); s = run(root, stage1=lambda: calls.append(1) or stage_ok())
    assert s["finalStatus"] == "ALREADY_CURRENT" and s["guard"] == "NOOP_ALREADY_CURRENT" and len(calls) == 1

def test_validation_quarantine_and_identity_guard():
    root = make_root(); rows = [prow(f"T{i:02d}") for i in range(2, 20)]
    rows += [prow("T00", close=300.0), prow("T01", high=90.0), prow("ZZZZ"), prow("bad sym"), prow("T02", close=102.0)]       # قفزة 197% / OHLC خاطئ / رمز مجهول / رمز غير صالح / تكرار
    put_pack(root, rows); s = run(root, stage1=stage_ok); q = json.load(open(os.path.join(root, "data", "quarantine", "2026-09-30.json")))["rows"]; reasons = {x["reason"].split("_")[0] + x["symbol"] for x in q}
    assert any("jump" in x["reason"] and x["symbol"] == "T00" for x in q) and any(x["reason"] == "ohlc_inconsistent" for x in q) and any("unknown_symbol" in x["reason"] for x in q) and any(x["reason"] == "invalid_symbol" for x in q) and any(x["reason"] == "duplicate_in_batch" for x in q)
    assert "2026-09-30" not in sessions(root, "T00") and "2026-09-30" not in sessions(root, "T01")

def test_ineligible_delisted_goes_to_quarantine():
    root = make_root(); f = os.path.join(root, "data", "history", "T00.json"); x = json.load(open(f)); x["eligibleForDecision"] = False; x["instrumentStatus"] = "delisted"; U.atomic_write(f, x)
    put_pack(root, [prow(f"T{i:02d}") for i in range(20)]); s = run(root, stage1=stage_ok)
    assert "2026-09-30" not in sessions(root, "T00") and s["universeCount"] == 19 and s["finalStatus"] == "SUCCESS"

def test_skip_early_when_previous_session_current():
    root = make_root(); put_pack(root, [prow(f"T{i:02d}") for i in range(20)]); run(root, stage1=stage_ok)
    s = U.run(root=root, now=dt.datetime(2026, 10, 1, 11, 0), holidays=set(), no_yahoo=True)          # الخميس 11:00 قبل الإغلاق
    assert s["expectedSession"] == "2026-09-30" and s["finalStatus"] in ("ALREADY_CURRENT", "WAITING_DATA") and s["guard"] in ("NOOP_ALREADY_CURRENT", "SKIP_EARLY")

def test_calendar_friday_saturday_and_holidays():
    cfg = U.DEFAULTS
    assert U.expected_session(dt.datetime(2026, 10, 2, 18, 0), set(), cfg)[0].isoformat() == "2026-10-01"          # الجمعة => الخميس
    assert U.expected_session(dt.datetime(2026, 10, 4, 10, 0), set(), cfg) == (dt.date(2026, 10, 1), True)           # الأحد قبل الإغلاق => الخميس
    assert U.expected_session(dt.datetime(2026, 10, 4, 16, 0), {"2026-10-04"}, cfg)[0].isoformat() == "2026-10-01"  # الأحد عطلة

def test_yahoo_fallback_fills_only_missing_and_rejects_price_conflicts():
    root = make_root(); put_pack(root, [prow(f"T{i:02d}") for i in range(14)])                                 # 70% فقط من الحزمة
    def ts(d): return int(dt.datetime(2026, 9, 30, 8, 0, tzinfo=dt.timezone.utc).timestamp())
    def fetch(t):
        c = 400.0 if t == "T19" else 101.0                                                                         # T19 بسعر متضارب
        return dict(chart=dict(result=[dict(timestamp=[ts(0)], indicators=dict(quote=[dict(open=[100.0], high=[c+1], low=[99.0], close=[c], volume=[900])]))]))
    s = U.run(root=root, now=NOW, holidays=set(), yahoo_fetcher=fetch, stage1=stage_ok)
    assert s["fallbackUsed"] and "2026-09-30" in sessions(root, "T15") and "2026-09-30" not in sessions(root, "T19") and any("T19" in x for x in s["failedSymbols"])
    r = [r for r in json.load(open(os.path.join(root, "data", "history", "T15.json")))["sessions"] if r["date"] == "2026-09-30"][0]; assert r["validationStatus"] == "yahoo_daily_unverified"

def test_atomic_write_no_tmp_left_and_backup_created():
    root = make_root(); put_pack(root, [prow(f"T{i:02d}") for i in range(20)]); run(root, stage1=stage_ok)
    assert not glob.glob(os.path.join(root, "data", "**", "*.tmp"), recursive=True) and glob.glob(os.path.join(root, "data", "backups", "*", "T00.json"))

def test_provenance_fields_and_no_fabricated_value_traded():
    root = make_root(); put_pack(root, [prow(f"T{i:02d}", valueTraded=None) for i in range(20)]); run(root, stage1=stage_ok)
    r = json.load(open(os.path.join(root, "data", "history", "T00.json")))["sessions"][-1]
    for k in ("sourceSessionDate", "sourceMarketTime", "fetchedAt", "validationStatus", "confidence", "sourceUrls", "previousTrustedClose"): assert k in r, k
    assert "valueTraded" not in r


def test_status_not_rewritten_when_only_timestamp_changes_and_pack_archived():
    root = make_root(); put_pack(root, [prow(f"T{i:02d}") for i in range(20)]); run(root, stage1=stage_ok)
    sp = os.path.join(root, "data", "daily-data-update-status.json"); a = open(sp).read()
    assert not glob.glob(os.path.join(root, "data", "inbox", "*.json")) and glob.glob(os.path.join(root, "data", "inbox", "processed", "*.json"))
    run(root, stage1=stage_ok); run(root, stage1=stage_ok); assert open(sp).read() != "" and json.load(open(sp))["finalStatus"] == "ALREADY_CURRENT"
    b = open(sp).read(); run(root, stage1=stage_ok); assert open(sp).read() == b, "التقرير أعيدت كتابته بلا تغيير حقيقي"

def test_engine_prefers_verified_history_over_yahoo_csv_on_overlap():
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "engine")); import egx_engine as E
    root = make_root(1); os.makedirs(os.path.join(root, "data", "prices")); os.makedirs(os.path.join(root, "data", "manual"))
    hist = json.load(open(os.path.join(root, "data", "history", "T00.json"))); rows = hist["sessions"]*14
    ds = [str(x.date().isoformat()) for x in __import__("pandas").bdate_range("2026-01-05", periods=70)]
    hist["sessions"] = [hist_row("T00", d, close=100.0) for d in ds]; U.atomic_write(os.path.join(root, "data", "history", "T00.json"), hist)
    open(os.path.join(root, "data", "prices", "T00.csv"), "w").write("date,open,high,low,close,volume\n" + f"{ds[-1]},1,2,1,555,1\n")        # Yahoo يخالف آخر يوم
    px, _ = E.load_prices([os.path.join(root, "data", "history"), os.path.join(root, "data", "prices"), os.path.join(root, "data", "manual")])
    assert px["T00"].close.iloc[-1] == 100.0, "Yahoo كتب فوق صف مباشر مصر الموثّق"
    open(os.path.join(root, "data", "manual", "T00.csv"), "w").write("date,open,high,low,close,volume\n" + f"{ds[-1]},100,102,99,101.5,5\n")
    px, _ = E.load_prices([os.path.join(root, "data", "history"), os.path.join(root, "data", "prices"), os.path.join(root, "data", "manual")])
    assert px["T00"].close.iloc[-1] == 101.5, "الاستيراد اليدوي يجب أن يغلب"

def test_partial_session_rerun_without_new_rows_stays_partial_and_stable():
    root = make_root(); put_pack(root, [prow(f"T{i:02d}") for i in range(18)]); calls = []             # 90% => PARTIAL
    s1 = run(root, stage1=lambda: calls.append(1) or stage_ok()); assert s1["finalStatus"] == "PARTIAL" and len(calls) == 1
    sp = os.path.join(root, "data", "daily-data-update-status.json")
    s2 = run(root, stage1=lambda: calls.append(1) or stage_ok()); assert s2["finalStatus"] == "PARTIAL" and s2["guard"] == "NOOP_NO_NEW_ROWS" and len(calls) == 1
    assert s2["stage1Prepared"] and s2["preparedCandidateCount"] == 7 and s2["publicationEligible"] is False
    a = open(sp).read(); run(root, stage1=lambda: calls.append(1) or stage_ok()); assert open(sp).read() == a and len(calls) == 1, "التقرير يتذبذب/يعيد Stage 1 بلا بيانات جديدة"
    put_pack(root, [prow("T18"), prow("T19")], name="p2.json"); s3 = run(root, stage1=lambda: calls.append(1) or stage_ok())          # وصلت الأسهم الناقصة لاحقاً
    assert s3["finalStatus"] == "SUCCESS" and s3["coveragePct"] == 100.0 and len(calls) == 2


def test_yahoo_automated_fallback_blocked_by_central_registry():
    assert U.yahoo_automated_access_allowed() is False

if __name__ == "__main__":
    fs = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for f in fs: f(); print("PASS", f.__name__)
    print(len(fs), "tests passed")
