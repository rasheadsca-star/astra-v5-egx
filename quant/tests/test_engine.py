"""اختبارات وحدة للإصلاحات. التشغيل: python tests/test_engine.py"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "engine"))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fetch"))
import numpy as np, pandas as pd
import egx_engine as E

def mk(rows):
    d = pd.DataFrame(rows, columns=["open", "high", "low", "close"]); d["date"] = pd.bdate_range("2026-01-04", periods=len(d)); d["volume"] = 1e6
    return d

def label(rows, atr=0.02):
    df = mk(rows); return E.label_signals(df, np.full(len(df), atr))

def base(n=14): return [[100, 101, 99, 100]] * n

def test_gap_up_over_target_is_win_even_if_low_is_below_stop():
    # atr 2% -> sd=3% ، td=5%: الوقف 97 والهدف 105. اليوم الثاني يفتح 108 (فوق الهدف) ثم ينزل إلى 90 داخل اليوم
    r = base(); r[2] = [108, 109, 90, 100]
    y, R, filled, end, ex = label(r)
    assert filled[0] and y[0] == 1, "الفجوة الصاعدة فوق الهدف يجب أن تُحتسب ربحاً"
    assert abs(R[0] - (108/100 - 1 - E.COST)) < 1e-9, R[0]

def test_gap_down_under_stop_exits_at_open():
    r = base(); r[2] = [92, 93, 91, 92]          # فجوة تحت الوقف (97) ويغلق -8% فقط => غير مقفل
    y, R, filled, end, ex = label(r)
    assert y[0] == 0 and not ex["locked"][0] and abs(R[0] - (92/100 - 1 - E.COST)) < 1e-9

def test_intraday_both_barriers_stop_first():
    r = base(); r[2] = [100, 106, 96, 100]
    y, R, filled, end, ex = label(r)
    assert y[0] == 0 and abs(R[0] - (0.97 - 1 - E.COST)) < 1e-9

def test_limit_down_lock_exits_next_open():
    # اليوم الثاني: فجوة هابطة تحت الوقف ويغلق عند حد الهبوط (-10%) => لا تنفيذ، الخروج عند افتتاح اليوم التالي (85)
    r = base(); r[2] = [90, 90, 90, 90]; r[3] = [85, 86, 84, 85]
    y, R, filled, end, ex = label(r)
    assert ex["locked"][0] and abs(R[0] - (85/100 - 1 - E.COST)) < 1e-9, R[0]

def test_no_fill_when_open_outside_zone():
    r = base(); r[1] = [103, 104, 102, 103]
    y, R, filled, end, ex = label(r)
    assert not filled[0] and np.isnan(R[0])

def test_calibration_uses_only_finished_trades():
    n = 4000; rng = np.random.RandomState(0); d = pd.bdate_range("2026-01-04", periods=200)
    fold = np.repeat(np.arange(8), n//8); dt_ = np.array([d[f*20 + rng.randint(0, 20)] for f in fold])
    oos = pd.DataFrame(dict(fold=fold, date=dt_, p=rng.rand(n), y=(rng.rand(n) < .4).astype(float)))
    oos["end"] = oos.date + pd.Timedelta(days=25)                      # كل صفقة تنتهي بعد 25 يوماً
    seen = []
    orig = E.IsotonicRegression
    class Spy(orig):
        def fit(self, X, y, *a, **k): seen.append(len(X)); return super().fit(X, y, *a, **k)
    E.IsotonicRegression = Spy
    try: out = E.honest_calibration(oos.copy())
    finally: E.IsotonicRegression = orig
    fs = oos.groupby("fold").date.min()
    for f, cnt in zip(sorted(oos.fold.unique())[2:], seen):
        ok = ((oos.fold < f) & (oos.end < fs[f])).sum()
        assert cnt == ok, (f, cnt, ok)
    assert out.pc_h.notna().any()

def test_eligibility_same_function_for_history_and_live():
    P = pd.DataFrame(dict(turn=[np.log1p(1e5), np.log1p(5e5), np.log1p(5e5), np.log1p(5e5)], atr=[.02, np.nan, .02, .02], r20=[.1, .1, np.nan, .1]))
    assert E.eligible_mask(P).tolist() == [False, False, False, True]

def test_eligibility_excludes_delisted():
    m = dict(ticker="ESRS", eligibleForDecision=False, instrumentStatus="delisted", warnings=["delisting_notice"], historyStatus="x")
    assert E.eligibility(m, 300, set())

# ---- اختبارات تأكيد الافتتاح (بيانات Yahoo صناعية) ----
def _res(day_bars):
    import datetime as dt
    from zoneinfo import ZoneInfo
    ts, o, c, v = [], [], [], []
    for day, bars in day_bars.items():
        for k, (op, cl, vol) in enumerate(bars):
            t = dt.datetime(day.year, day.month, day.day, 10, 0, tzinfo=ZoneInfo("Africa/Cairo")) + dt.timedelta(minutes=15*k); ts.append(int(t.timestamp())); o.append(op); c.append(cl); v.append(vol)
    return dict(timestamp=ts, indicators=dict(quote=[dict(open=o, close=c, volume=v)]))

def test_intraday_statuses():
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fetch"))
    import datetime as dt, fetch_intraday as F
    rec = dict(entry_zone=[99.0, 101.0]); e = dt.date(2026, 9, 29); p = dt.date(2026, 9, 28)
    prev = {p: [(100, 100, 5000), (100, 100, 5000)]}
    assert F.analyse(rec, _res({**prev, e: [(100.5, 101.5, 500), (101, 102, 300)]}), e)["status"] == "ok"
    r = F.analyse(rec, _res({**prev, e: [(103, 104, 500), (104, 105, 300)]}), e); assert r["status"] == "ok" and r["open_in_zone"] is False
    assert F.analyse(rec, _res({**prev, e: [(100, 101, 500)]}), e)["status"] == "incomplete"
    assert F.analyse(rec, _res(prev), e)["status"] == "not_entry_day"


# ---- سجل المتابعة الحي ----
def test_ledger_record_settle_late_and_idempotent():
    import tempfile, datetime as dt, ledger
    df = mk(base(14)); sess = str(df.date.iloc[0].date()); path = os.path.join(tempfile.mkdtemp(), "led.json"); rows = [["AAA", 1, 100, .03, .05, "C"], ["AAA", 7, 100, .03, .05, "C"]]
    eday = ledger.entry_day(sess)
    ok = dt.datetime.combine(eday, dt.time(9, 0)); late = dt.datetime.combine(eday, dt.time(11, 0))
    assert ledger.record(path, sess, rows, dict(stale=False, regime="x"), now=ok) == "recorded"
    assert ledger.record(path, sess, rows, dict(stale=False), now=ok) == "exists"                      # لا كتابة فوق السجل
    s = ledger.settle(path, {"AAA": df}, E.run_plan, E.COST)
    assert s["closed"] == 2 and s["sessions_valid"] == 1 and s["top"]["n"] == 1                       # Top5 = الرتبة 1 فقط
    assert abs(s["all"]["avg"] - (-E.COST*100)) < 0.01, s["all"]                                      # خروج زمني عند سعر ثابت => خسارة التكلفة فقط
    p2 = os.path.join(tempfile.mkdtemp(), "l2.json")
    assert ledger.record(p2, sess, rows, dict(stale=False), now=late) == "recorded_late"
    s2 = ledger.settle(p2, {"AAA": df}, E.run_plan, E.COST)
    assert s2["sessions_late"] == 1 and s2["all"]["n"] == 0                                           # المتأخر لا يدخل الإحصاء
    assert ledger.record(os.path.join(tempfile.mkdtemp(), "l3.json"), sess, rows, dict(stale=True), now=ok) == "skipped_stale"
    s3 = ledger.settle(path, {"AAA": mk(base(4))}, E.run_plan, E.COST); assert s3["open"] == 2 and s3["closed"] == 0   # الأفق لم يكتمل

def test_portfolio_respects_max_positions_and_costs():
    import portfolio as PF
    d = pd.bdate_range("2026-01-05", periods=30); closes = pd.DataFrame({f"S{k}": 100.0 for k in range(12)}, index=d)
    rows = [dict(date=d[0], ticker=f"S{k}", rk=k+1, filled=True, edate=d[1], epx=100.0, xpx=100.0, end=d[6], sd=.03, turn=np.log1p(1e9), regime="صاعد") for k in range(12)]
    oos = pd.DataFrame(rows); s, tr, ex = PF.simulate(oos, closes, K=12, max_pos=8)
    assert len(tr) == 8, len(tr)                                                                     # حد المراكز
    assert s.iloc[-1] < s.iloc[0] and s.iloc[-1] > s.iloc[0]*0.99                                    # تكلفة فقط، لا ربح وهمي

def test_liquidity_study_tiers_and_slippage():
    n = 300; rng = np.random.RandomState(1); adv = np.where(np.arange(n) % 3 == 0, 2e6, np.where(np.arange(n) % 3 == 1, 8e6, 40e6))
    oos = pd.DataFrame(dict(turn=np.log1p(adv), rk=np.where(np.arange(n) < 60, 1, 99), ret=np.full(n, 0.01)))
    r = E.liquidity_study(oos); assert r["tiers"]["منخفضة"]["top_n"] + r["tiers"]["متوسطة"]["top_n"] + r["tiers"]["عالية"]["top_n"] == 60
    s = {x["scenario"][:6]: x for x in r["sensitivity"]}; none = r["sensitivity"][0]; harsh = r["sensitivity"][2]
    assert none["top_avg"] == 1.0 and harsh["top_avg"] < none["top_avg"], r["sensitivity"]                  # الانزلاق يخفض العائد
    assert E.liq_tier(1e6) == "منخفضة" and E.liq_tier(6e6) == "متوسطة" and E.liq_tier(2e7) == "عالية"

def test_ledger_accepts_old_and_new_row_formats_and_groups_by_liquidity():
    import tempfile, datetime as dt, ledger
    df = mk(base(14)); sess = str(df.date.iloc[0].date()); path = os.path.join(tempfile.mkdtemp(), "led.json"); ok = dt.datetime.combine(ledger.entry_day(sess), dt.time(9, 0))
    rows = [["AAA", 1, 100, .03, .05, "C"], ["AAA", 2, 100, .03, .05, "C", 2_000_000], ["AAA", 3, 100, .03, .05, "C", 40_000_000]]
    ledger.record(path, sess, rows, dict(stale=False), now=ok); s = ledger.settle(path, {"AAA": df}, E.run_plan, E.COST)
    assert s["closed"] == 3 and s["by_liquidity"]["منخفضة"]["n"] == 1 and s["by_liquidity"]["عالية"]["n"] == 1 and s["by_liquidity"]["متوسطة"]["n"] == 0

# ---- خطة الهدفين ----
def plan(rows, atr=0.02):
    df = mk(rows); i = 0; o, h, l, c, d = (df[k].values for k in ("open", "high", "low", "close", "date")); sd = min(max(E.STOP_ATR*atr, .025), .08)
    return E.run_plan(o, h, l, c, d, i, c[i], sd), sd

def test_plan_t1_then_retrace_to_breakeven():
    # sd=3%: T1=102 ، T2=105 ، التعادل=100. اليوم 2 يبلغ 102.5 (T1) ثم اليوم 3 يهبط إلى 99 => الباقي يخرج عند التعادل 100
    r = base(); r[2] = [100, 102.5, 100.5, 102]; r[3] = [101, 101.5, 99, 99.5]
    x, sd = plan(r); assert x["hit1"] == 1 and x["hit2"] == 0
    g = 0.5*(102/100 - 1) + 0.5*(100/100 - 1); assert abs(x["ret"] - (g - E.COST)) < 1e-9, x

def test_plan_t1_then_t2():
    r = base(); r[2] = [100, 102.5, 100.5, 102]; r[3] = [102, 106, 101.5, 105]
    x, sd = plan(r); assert x["hit1"] == 1 and x["hit2"] == 1
    assert abs(x["ret"] - (0.5*0.02 + 0.5*0.05 - E.COST)) < 1e-9, x

def test_plan_stop_before_t1_is_full_loss_like_single_trade():
    r = base(); r[2] = [100, 101, 96, 97]
    x, sd = plan(r); assert x["hit1"] == 0 and abs(x["ret"] - (0.97 - 1 - E.COST)) < 1e-9

def test_plan_gap_down_after_t1_exits_at_open_below_breakeven():
    r = base(); r[2] = [100, 102.5, 100.5, 102]; r[3] = [98, 99, 97, 98]
    x, sd = plan(r); g = 0.5*0.02 + 0.5*(98/100 - 1); assert abs(x["ret"] - (g - E.COST)) < 1e-9, x

def test_plan_open_when_horizon_incomplete_after_t1():
    x, sd = plan([[100, 101, 99, 100], [100, 101, 99, 100], [100, 102.5, 100.5, 102], [102, 103, 101, 102]]); assert x["status"] == "open"

def test_low_price_rounding_keeps_levels_valid_and_degenerate_detected():
    assert E.price_round(0.71, 0.7171) == 0.717 and E.price_round(182.07, 183.8907) == 183.89          # 3 خانات للأسعار المنخفضة
    c0 = 0.71; sd = 0.025; t1 = sd*E.PLAN["t1"]/E.STOP_ATR
    lo, hi, st, t1p = (E.price_round(c0, v) for v in (c0*(1-E.ZONE), c0*(1+E.ZONE), c0*(1-sd), c0*(1+t1)))
    assert not E.levels_degenerate(lo, hi, st, t1p), (lo, hi, st, t1p)                                  # لا تنهار بعد الإصلاح
    assert E.levels_degenerate(0.70, 0.72, 0.69, 0.72) and E.levels_degenerate(0.70, 0.72, 0.70, 0.74)  # تُكتشف إن انهارت (وقف=دخول أو هدف=دخول)

if __name__ == "__main__":
    fs = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for f in fs: f(); print("PASS", f.__name__)
    print(len(fs), "tests passed")

