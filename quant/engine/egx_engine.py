#!/usr/bin/env python3
"""EGX NEXT V2.1 — محرك احتمالي بعد إصلاحات المراجعة.
1) تنقية زمنية حقيقية: التدريب فقط على إشارات انتهت نتيجتها (end_date) قبل بداية فترة الاختبار — لكل سهم على حدة.
2) أهلية الأسهم: استبعاد المشطوب / تحت مراجعة إجراء مؤسسي / تاريخ غير كافٍ / غير موثّق / قائمة حظر يدوية.
3) توحيد التنفيذ: الاختبار = نفس خطة الشاشة (دخول عند افتتاح اليوم التالي فقط إن وقع داخل نطاق آخر إغلاق ±1%،
   مستويات الوقف/الهدف من آخر إغلاق، فجوات الافتتاح تُنفَّذ بسعر الافتتاح).
4) احتمال لكل سهم معايَر بأسلوب Expanding (معايرة على الطيات السابقة فقط) + دليل المجموعة كمعلومة ثانوية.
5) حداثة البيانات مقابل الجلسة المتوقعة، بصمة بيانات وإصدارات مكتبات، واختبار Placebo لكشف أي تسريب."""
import json, glob, os, sys, platform, hashlib, warnings, datetime as dt
import numpy as np, pandas as pd, sklearn
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline
from sklearn.isotonic import IsotonicRegression
warnings.filterwarnings("ignore")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ledger, portfolio
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
H, COST, STOP_ATR, TGT_ATR, ZONE = 10, 0.006, 1.5, 2.5, 0.01
LIMIT_DOWN = 0.10      # الحد اليومي للبورصة المصرية
MIN_SESSIONS, MIN_TURNOVER = 60, 2e5
COLS = ["date", "open", "high", "low", "close", "volume"]
LAST_BAR = {}        # ticker -> حالة/تحذيرات آخر شريط في ملف التاريخ (provenance)

# ---------------- 1) تحميل + أهلية ----------------
def eligibility(meta, n_sessions, blocklist):
    why, t = [], meta.get("ticker")
    ws = [str(w) for w in meta.get("warnings") or []]
    if t in blocklist: why.append("قائمة حظر يدوية")
    if meta.get("eligibleForDecision") is False: why.append("eligibleForDecision=false")
    if str(meta.get("instrumentStatus") or "").lower() in ("delisted", "suspended", "inactive"): why.append("مشطوب/موقوف")
    if str(meta.get("historyStatus") or "").startswith(("inactive", "current_session_only")): why.append("حالة تاريخ: " + str(meta.get("historyStatus")))
    if any(("delist" in w.lower() or "شطب" in w) for w in ws): why.append("تحذير شطب")
    if any("corporate_action_review_required" in w for w in ws): why.append("إجراء مؤسسي قيد المراجعة (أسعار غير معدّلة)")
    if any(("rows_quarantined" in w or "not_officially_verified" in w or "requires_recent_gap_fill" in w) for w in ws) and meta.get("historyStatus") != "historical_complete_100":
        why.append("بيانات غير موثّقة/بها فجوات")
    if n_sessions < MIN_SESSIONS: why.append(f"تاريخ قصير ({n_sessions} جلسة)")
    return why

def load_prices(paths, blocklist=()):
    raw, metas = {}, {}
    PRI = {"prices": 1, "history": 2, "manual": 3}                                      # عند تداخل التاريخ: اليدوي > التاريخ الموثّق > Yahoo
    for d in paths:
        pr = PRI.get(os.path.basename(os.path.normpath(d)), 2)
        for f in sorted(glob.glob(os.path.join(d, "*.json"))):
            x = json.load(open(f)); s = x.get("sessions") or []
            if s:
                raw.setdefault(x["ticker"], []).append(pd.DataFrame(s)[COLS].assign(_p=pr)); metas[x["ticker"]] = {k: v for k, v in x.items() if k != "sessions"}
                LAST_BAR[x["ticker"]] = dict(date=s[-1]["date"], status=s[-1].get("validationStatus"), warnings=[str(w) for w in s[-1].get("warnings") or []])
        for f in sorted(glob.glob(os.path.join(d, "*.csv"))):
            raw.setdefault(os.path.basename(f)[:-4], []).append(pd.read_csv(f)[COLS].assign(_p=pr))
    res, excluded = {}, {}
    for t, dfs in sorted(raw.items()):
        df = pd.concat(dfs); df["date"] = pd.to_datetime(df["date"])
        df = df.sort_values(["date", "_p"], kind="stable").drop_duplicates("date", keep="last").drop(columns="_p").reset_index(drop=True)
        # Preserve source precedence before rejecting incomplete/invalid bars: no weaker fallback or imputation.
        for c in COLS[1:]: df[c] = pd.to_numeric(df[c], errors="coerce")
        valid = np.isfinite(df[COLS[1:]]).all(axis=1) & (df[["open", "high", "low", "close"]] > 0).all(axis=1) & (df.volume >= 0)
        valid &= (df.low <= df[["open", "close"]].min(axis=1)) & (df.high >= df[["open", "close"]].max(axis=1))
        df = df[valid].reset_index(drop=True)
        jumps = np.where(df.close.pct_change().abs().values > 0.22)[0]      # قفزة >22% = انقسام/خطأ: نقطع السلسلة
        if len(jumps): df = df.iloc[jumps[-1]:].reset_index(drop=True)
        why = eligibility(dict(metas.get(t, {}), ticker=t), len(df), set(blocklist))
        if why: excluded[t] = why
        else: res[t] = df
    return res, excluded

def expected_session(now=None):
    """آخر جلسة متوقعة (أحد–خميس، الإغلاق ~14:30 القاهرة). العطلات الرسمية غير مدرجة => قد يُبالَغ في تحذير التأخر."""
    try:
        from zoneinfo import ZoneInfo; now = now or dt.datetime.now(ZoneInfo("Africa/Cairo"))
    except Exception:
        now = now or dt.datetime.utcnow() + dt.timedelta(hours=3)
    d = now.date()
    if not (d.weekday() in (6, 0, 1, 2, 3) and now.hour >= 15): d -= dt.timedelta(days=1)
    while d.weekday() in (4, 5): d -= dt.timedelta(days=1)          # الجمعة والسبت
    return pd.Timestamp(d)

# ---------------- 2) الخصائص والتسمية (حواجز ثلاثية بتنفيذ واقعي) ----------------
def rsi(c, n=14):
    d = c.diff(); up = d.clip(lower=0).ewm(alpha=1/n, adjust=False).mean(); dn = (-d.clip(upper=0)).ewm(alpha=1/n, adjust=False).mean()
    return 100 - 100/(1 + up/(dn+1e-9))

def run_trade(o, h, l, c, d, i, stp, tgt, refc):
    """تنفيذ خطة واحدة بدأت إشارتها في الفهرس i (أسعار الخطة من إغلاق refc). المصدر الوحيد لقواعد التنفيذ (الاختبار والسجل الحي).
    يرجع None إن لم يتحقق الدخول، أو dict(status closed|open, e, ex, hit, end, locked)."""
    n = len(c)
    if i+1 >= n: return None
    e = o[i+1]
    if not (refc*(1-ZONE) <= e <= refc*(1+ZONE)): return dict(status="unfilled", end=d[i+1])
    ex, hit, end, locked = None, 0, None, False
    for j in range(i+1, min(i+1+H, n)):
        stop_hit = False
        if j > i+1:                                                          # الافتتاح يسبق حركة اليوم دائماً
            if o[j] <= stp: ex, stop_hit = o[j], True                       # فجوة هابطة: خروج بسعر الافتتاح (أسوأ من الوقف)
            elif o[j] >= tgt: ex, hit, end = o[j], 1, d[j]; break           # فجوة صاعدة فوق الهدف: تحقق بسعر الافتتاح
        if not stop_hit:
            if l[j] <= stp: ex, stop_hit = stp, True                        # داخل الجلسة: الوقف أولاً عند التعادل
            elif h[j] >= tgt: ex, hit, end = tgt, 1, d[j]; break
        if stop_hit:
            end = d[j]
            if c[j] <= c[j-1]*(1-LIMIT_DOWN+0.005):                          # أغلق عند حد الهبوط => لا تنفيذ للوقف
                locked = True
                if j+1 < n: ex, end = o[j+1], d[j+1]
                else: ex = c[j]
            break
    if ex is None:
        if i+H < n: ex, end = c[i+H], d[i+H]                                 # خروج زمني
        else: return dict(status="open", e=e, last=c[n-1])                    # الأفق لم يكتمل بعد
    return dict(status="closed", e=e, ex=ex, hit=hit, end=end, locked=locked)

PLAN = dict(t1=1.0, t2=2.5, frac=0.5)     # الهدف 1 = 1.0×ATR (بيع frac ثم نقل الوقف لسعر الدخول)، الهدف 2 = 2.5×ATR، الوقف 1.5×ATR، الأفق H

def run_plan(o, h, l, c, d, i, refc, sd):
    """خطة إدارة بهدفين. الجزء الأول يخرج عند T1؛ بعدها يُنقل الوقف إلى سعر الدخول (تعادل) وينتظر الباقي T2 حتى نهاية الأفق.
    تحفّظات: داخل اليوم الوقف قبل الهدف؛ فجوة هابطة تحت التعادل تُنفَّذ بسعر الافتتاح؛ بلوغ T2 في نفس يوم T1 لا يُحتسب إلا بفجوة افتتاح.
    يرجع None/{status: unfilled|open} أو dict(status=closed, e, hit1, hit2, ret(صافي), xeq(سعر خروج مكافئ), end, locked)."""
    stp = refc*(1-sd); t1 = refc*(1+sd*PLAN["t1"]/STOP_ATR); t2 = refc*(1+sd*PLAN["t2"]/STOP_ATR); n = len(c)
    x1 = run_trade(o, h, l, c, d, i, stp, t1, refc)
    if x1 is None or x1["status"] != "closed": return x1
    e = x1["e"]
    if x1["hit"] == 0: return dict(status="closed", e=e, hit1=0, hit2=0, ret=x1["ex"]/e - 1 - COST, xeq=x1["ex"], end=x1["end"], locked=x1["locked"])
    j0 = int(np.searchsorted(d, x1["end"])); ex2, hit2, end2 = None, 0, None
    if j0 > i+1 and o[j0] >= t2: ex2, hit2, end2 = o[j0], 1, d[j0]
    else:
        for j in range(j0+1, min(i+1+H, n)):
            if o[j] <= e: ex2, end2 = o[j], d[j]; break                       # فجوة تحت التعادل
            if l[j] <= e: ex2, end2 = e, d[j]; break                          # الوقف عند التعادل أولاً
            if o[j] >= t2: ex2, hit2, end2 = o[j], 1, d[j]; break
            if h[j] >= t2: ex2, hit2, end2 = t2, 1, d[j]; break
        if ex2 is None:
            if i+H < n: ex2, end2 = c[i+H], d[i+H]                           # خروج زمني للجزء الباقي
            else: return dict(status="open", e=e, last=c[n-1])
    g = PLAN["frac"]*(x1["ex"]/e - 1) + (1 - PLAN["frac"])*(ex2/e - 1)
    return dict(status="closed", e=e, hit1=1, hit2=hit2, ret=g - COST, xeq=e*(1 + g), end=end2, locked=False)

def label_signals(df, atr_pct):
    """لكل يوم i: خطة من إغلاق i. يرجع y, ret, filled, end, extra(edate, epx, xpx, sd, locked)."""
    n = len(df); o, h, l, c, d = df.open.values, df.high.values, df.low.values, df.close.values, df.date.values
    y = np.full(n, np.nan); R = np.full(n, np.nan); filled = np.zeros(n, bool); end = np.full(n, np.datetime64("NaT"), dtype="datetime64[ns]")
    edate = np.full(n, np.datetime64("NaT"), dtype="datetime64[ns]"); epx = np.full(n, np.nan); xpx = np.full(n, np.nan); sdv = np.full(n, np.nan); locked = np.zeros(n, bool)
    ph1 = np.full(n, np.nan); ph2 = np.full(n, np.nan); pret = np.full(n, np.nan); px = np.full(n, np.nan); pend = np.full(n, np.datetime64("NaT"), dtype="datetime64[ns]")
    for i in range(n-1):
        a = atr_pct[i]
        if not a > 0 or i+H >= n: continue                                     # النتيجة لم تكتمل => خارج التدريب/الاختبار
        sd = min(max(STOP_ATR*a, .025), .08); td = sd*TGT_ATR/STOP_ATR; sdv[i] = sd; end[i] = d[i+1]
        r = run_trade(o, h, l, c, d, i, c[i]*(1-sd), c[i]*(1+td), c[i])
        if r is None or r["status"] != "closed": continue                      # لم يتحقق الدخول => لا صفقة
        filled[i] = True; edate[i] = d[i+1]; epx[i] = r["e"]; xpx[i] = r["ex"]; end[i] = r["end"]; locked[i] = r["locked"]
        y[i] = r["hit"]; R[i] = r["ex"]/r["e"] - 1 - COST
        q = run_plan(o, h, l, c, d, i, c[i], sd)
        if q is not None and q["status"] == "closed": ph1[i], ph2[i], pret[i], px[i], pend[i] = q["hit1"], q["hit2"], q["ret"], q["xeq"], q["end"]
    return y, R, filled, end, dict(edate=edate, epx=epx, xpx=xpx, sd=sdv, locked=locked, p_hit1=ph1, p_hit2=ph2, p_ret=pret, p_x=px, p_end=pend)

def stock_feats(df):
    c, h, l, o, v = df.close, df.high, df.low, df.open, df.volume
    f = pd.DataFrame({"date": df.date})
    for n in (1, 5, 10, 20, 60): f[f"r{n}"] = c.pct_change(n)
    s20, s50 = c.rolling(20).mean(), c.rolling(50, min_periods=30).mean()
    f["d20"], f["d50"] = c/s20-1, c/s50-1; f["trend"] = ((c > s20) & (s20 > s50)).astype(float); f["rsi"] = rsi(c)
    tr = pd.concat([h-l, (h-c.shift()).abs(), (l-c.shift()).abs()], axis=1).max(axis=1); f["atr"] = tr.rolling(14).mean()/c
    f["volr"] = np.log1p(v/(v.rolling(20).mean()+1)); f["turn"] = np.log1p((c*v).rolling(20).mean())
    hh, ll = h.rolling(20).max(), l.rolling(20).min(); f["pos20"] = (c-ll)/(hh-ll+1e-9); f["dhigh"] = c/hh-1
    f["clv"] = (c-l)/(h-l+1e-9); f["gap"] = o/c.shift()-1
    bw = (c.rolling(20).std()*4)/s20; f["squeeze"] = bw.rolling(60, min_periods=20).rank(pct=True)
    f["brk"] = (c >= c.rolling(10).max().shift()).astype(float)
    f["pull"] = ((f.trend == 1) & f.d20.between(-0.04, 0.005) & (f.rsi < 55)).astype(float)
    f["mom"] = ((f.r20 > 0.08) & (f.volr > 0.4)).astype(float)
    y, R, filled, end, ex = label_signals(df, f.atr.values)
    f["y"], f["ret"], f["filled"], f["end"] = y, R, filled, end
    for k_, v_ in ex.items(): f[k_] = v_
    return f

def price_round(c0, x):
    """دقة السعر: 3 خانات للأسعار المنخفضة (<5 ج) كي لا تنهار مستويات الدخول/الوقف/الهدف بعد التقريب."""
    return round(float(x), 3 if c0 < 5 else 2)

def levels_degenerate(entry_lo, entry_hi, stop, t1):
    """مستويات غير قابلة للتنفيذ بعد التقريب (وقف غير أدنى من الدخول أو هدف غير أعلى منه)."""
    return not (stop < entry_lo and t1 > entry_hi)

def eligible_mask(P):
    """نفس الشروط تُطبَّق قبل الترتيب تاريخياً وحالياً (سيولة + اكتمال المؤشرات)."""
    return (P.turn > np.log1p(MIN_TURNOVER)) & P.atr.notna() & P.r20.notna()

def build_panel(prices):
    P = pd.concat([stock_feats(df).assign(ticker=t) for t, df in prices.items()], ignore_index=True); g = P.groupby("date")
    P["m_r5"], P["m_r20"] = g.r5.transform("median"), g.r20.transform("median"); P["m_breadth"] = g.d20.transform(lambda s: (s > 0).mean())
    P["rs20"], P["rs5"] = P.r20 - P.m_r20, P.r5 - P.m_r5
    for c in ("r5", "r20", "rs20", "volr", "turn", "atr", "d20", "pos20", "squeeze"): P[f"k_{c}"] = g[c].rank(pct=True)
    P["regime"] = np.where((P.m_breadth > .55) & (P.m_r20 > 0), "صاعد", np.where((P.m_breadth < .35) | (P.m_r20 < -.03), "هابط", "متذبذب"))
    P["elig"] = eligible_mask(P)
    return P.sort_values(["date", "ticker"]).reset_index(drop=True)          # ترتيب حتمي مستقل عن نظام الملفات

FEATS = ["r1", "r5", "r10", "r20", "r60", "d20", "d50", "trend", "rsi", "atr", "volr", "turn", "pos20", "dhigh", "clv", "gap", "squeeze", "brk", "pull", "mom",
         "m_r5", "m_r20", "m_breadth", "rs20", "rs5", "k_r5", "k_r20", "k_rs20", "k_volr", "k_turn", "k_atr", "k_d20", "k_pos20", "k_squeeze"]

# ---------------- 3) نموذج + Walk-Forward نظيف ----------------
def fit_predict(tr, te, shuffle_seed=None):
    Xtr, Xte, ytr = tr[FEATS].fillna(0), te[FEATS].fillna(0), tr.y.values
    if shuffle_seed is not None: ytr = np.random.RandomState(shuffle_seed).permutation(ytr)     # Placebo
    gb = HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=150, min_samples_leaf=60, l2_regularization=2.0, early_stopping=False, random_state=7)
    lr = make_pipeline(StandardScaler(), LogisticRegression(C=0.05, max_iter=300))
    gb.fit(Xtr, ytr); lr.fit(Xtr.clip(-10, 10), ytr)
    return 0.5*gb.predict_proba(Xte)[:, 1] + 0.5*lr.predict_proba(Xte.clip(-10, 10))[:, 1]

def walk_forward(P, min_train_days=45, step=5, placebo=None):
    tr_all = P[P.elig & P.filled & P.y.notna()]; te_all = P[P.elig & P.end.notna()]               # الاختبار يشمل غير المملوء ليبقى الترتيب كما في الواقع
    dates = np.sort(te_all.date.unique()); out, leak = [], []
    for fold, k in enumerate(range(min_train_days, len(dates), step)):
        start = dates[k]; stop = dates[k+step] if k+step < len(dates) else np.datetime64("2100-01-01")
        tr = tr_all[tr_all.end < start].sort_values(["date", "ticker"])                                        # نتيجة الإشارة معروفة قبل بدء الاختبار (لكل سهم)
        te = te_all[(te_all.date >= start) & (te_all.date < stop)]
        if len(tr) < 1500 or te.empty: continue
        leak.append(bool(tr.end.max() < start))
        te = te.copy(); te["p"] = fit_predict(tr, te, shuffle_seed=(fold + 1000*placebo) if placebo is not None else None); te["fold"] = fold; out.append(te)
    return (pd.concat(out) if out else pd.DataFrame()), leak

def stats(d):
    d = d[d.ret.notna()]
    if len(d) == 0: return dict(n=0, days=0)
    w, l = d.ret[d.ret > 0].sum(), -d.ret[d.ret < 0].sum()
    return dict(n=int(len(d)), days=int(d.date.nunique()), hit=round(100*float(d.y.mean()), 1), win=round(100*float((d.ret > 0).mean()), 1),
                avg=round(100*float(d.ret.mean()), 2), med=round(100*float(d.ret.median()), 2), pf=round(float(w/l), 2) if l > 0 else None)

def honest_calibration(oos):
    """معايرة Expanding بتنقية زمنية: لا تدخل المعايرة إلا صفقات انتهت نتيجتها (end) قبل أول يوم في الطية الحالية."""
    oos["pc_h"] = np.nan; lab = oos[oos.y.notna()]; fstart = oos.groupby("fold").date.min()
    for f in sorted(oos.fold.unique())[2:]:
        prev = lab[(lab.fold < f) & (lab.end < fstart[f])]
        if len(prev) < 300 or prev.y.nunique() < 2: continue
        iso = IsotonicRegression(out_of_bounds="clip", y_min=0, y_max=1).fit(prev.p, prev.y); m = oos.fold == f; oos.loc[m, "pc_h"] = iso.predict(oos.loc[m, "p"])
    return oos

def wilson_low(k, n, z=1.64):
    if n == 0: return 0.0
    p = k/n; return (p + z*z/(2*n) - z*np.sqrt(p*(1-p)/n + z*z/(4*n*n)))/(1 + z*z/n)

LIQ_LOW, LIQ_HIGH, ADV_CAP = 5e6, 15e6, 0.05          # شرائح متوسط التداول اليومي (ج) وسقف المركز كنسبة منه
SLIP_SCENARIOS = {"بدون انزلاق إضافي": (0.0, 0.0), "معتدل (منخفضة +0.5% / متوسطة +0.15%)": (0.005, 0.0015), "قاسٍ (منخفضة +1.0% / متوسطة +0.3%)": (0.010, 0.003)}
def liq_tier(adv): return "منخفضة" if adv < LIQ_LOW else ("متوسطة" if adv < LIQ_HIGH else "عالية")

def liquidity_study(oos, top=5):
    """أين تتركز الميزة؟ وكم تتحمل من انزلاق إضافي في الأسهم الأقل سيولة؟ (الافتراضات للانزلاق حساسية لا تقدير)."""
    adv = np.expm1(oos.turn.values); tier = np.select([adv < LIQ_LOW, adv < LIQ_HIGH], ["منخفضة", "متوسطة"], "عالية"); d = oos.assign(tier=tier)
    t = d[(d.rk <= top) & d.ret.notna()]; per = {}
    for k in ("منخفضة", "متوسطة", "عالية"):
        a, b = t[t.tier == k], d[(d.tier == k) & d.ret.notna()]
        per[k] = dict(top_n=int(len(a)), top_share_pct=round(100*len(a)/max(len(t), 1), 0), top_avg=round(100*float(a.ret.mean()), 2) if len(a) else None,
                      base_avg=round(100*float(b.ret.mean()), 2) if len(b) else None, excess=round(100*float(a.ret.mean() - b.ret.mean()), 2) if len(a) and len(b) else None)
    sens = []
    for name, (lo, mid) in SLIP_SCENARIOS.items():
        pen = np.select([d.tier == "منخفضة", d.tier == "متوسطة"], [lo, mid], 0.0); r = d.ret - pen
        sens.append(dict(scenario=name, top_avg=round(100*float(r[(d.rk <= top)].mean()), 2), base_avg=round(100*float(r.mean()), 2), excess=round(100*float(r[(d.rk <= top)].mean() - r.mean()), 2)))
    return dict(tiers=per, sensitivity=sens, cutoffs_m=[LIQ_LOW/1e6, LIQ_HIGH/1e6], adv_cap_pct=ADV_CAP*100)

def plan_study(oos, top=5):
    """أدلة خطة الهدفين خارج العينة: بلوغ الهدف 1/2، التفوق على كل الأسهم بنفس الخطة، نصفا العينة، وآخر 45 يوماً."""
    d = oos[oos.p_ret.notna()]
    def agg(x):
        if len(x) == 0: return dict(n=0)
        w, l = x.p_ret[x.p_ret > 0].sum(), -x.p_ret[x.p_ret < 0].sum()
        return dict(n=int(len(x)), hit1=round(100*float(x.p_hit1.mean()), 1), hit2=round(100*float(x.p_hit2.mean()), 1), no_t1=round(100*float((x.p_hit1 == 0).mean()), 1),
                    avg=round(100*float(x.p_ret.mean()), 2), win=round(100*float((x.p_ret > 0).mean()), 1), pf=round(float(w/l), 2) if l > 0 else None)
    t = d[d.rk <= top]; cut = np.sort(d.date.unique())[len(d.date.unique())//2]; last = d.date.max() - pd.Timedelta(days=45)
    ex = lambda a, b: round(a["avg"] - b["avg"], 2) if a["n"] and b["n"] else None
    h1, h2 = (agg(t[t.date < cut]), agg(d[d.date < cut])), (agg(t[t.date >= cut]), agg(d[d.date >= cut])); rc = (agg(t[t.date >= last]), agg(d[d.date >= last]))
    return dict(top=agg(t), base=agg(d), excess_avg=ex(agg(t), agg(d)), excess_h1=ex(*h1), excess_h2=ex(*h2), recent45=dict(top=rc[0], base=rc[1]),
                params=dict(stop_atr=STOP_ATR, t1_atr=PLAN["t1"], t2_atr=PLAN["t2"], frac_t1=PLAN["frac"], horizon=H))

def data_fingerprint(prices):
    h = hashlib.sha256()
    for t in sorted(prices): d = prices[t]; h.update(t.encode()); h.update(d[["close", "volume"]].round(4).to_numpy().tobytes())
    return h.hexdigest()[:16]

# ---------------- 4) التشغيل ----------------
def run(paths, out_json, top_n=10, placebo=True, blocklist_file=None):
    bl = json.load(open(blocklist_file)) if blocklist_file and os.path.exists(blocklist_file) else []
    prices, excluded = load_prices(paths, bl); P = build_panel(prices); latest = P.date.max(); exp = expected_session()
    oos, leak = walk_forward(P)
    if oos.empty: sys.exit("بيانات غير كافية للاختبار")
    oos = honest_calibration(oos.sort_values(["date", "ticker"]).reset_index(drop=True))
    oos["rk"] = oos.groupby("date").p.rank(ascending=False, method="first")
    fill_rate = round(100*float(P[P.end.notna()].filled.mean()), 1)
    bucket = lambda r: "top3" if r <= 3 else "top10" if r <= 10 else "top25" if r <= 25 else "rest"
    oos["bucket"] = oos.rk.map(bucket)
    base = stats(oos); top = {f"top{k}": stats(oos[oos.rk <= k]) for k in (3, 5, 10)}
    table = {f"{b}|{rg}": stats(oos[(oos.bucket == b) & ((oos.regime == rg) if rg != "الكل" else True)]) for b in ("top3", "top10", "top25", "rest") for rg in ("صاعد", "متذبذب", "هابط", "الكل")}
    by_month = [dict(month=str(m), **stats(d)) for m, d in oos[oos.rk <= 5].groupby(oos.date.dt.to_period("M"))]
    ev = oos[oos.pc_h.notna() & oos.ret.notna()]; rel, brier, brier0 = [], None, None
    if len(ev) > 500:
        b = pd.qcut(ev.pc_h.rank(method="first"), 8, labels=False)
        rel = [dict(pred=round(100*float(d.pc_h.mean()), 1), actual=round(100*float(d.y.mean()), 1), avg=round(100*float(d.ret.mean()), 2), n=int(len(d))) for _, d in ev.groupby(b)]
        brier = float(((ev.pc_h - ev.y)**2).mean()); brier0 = float(((ev.y.mean() - ev.y)**2).mean())
    rd = oos[oos.rk <= 5].groupby("date").ret.mean().dropna(); recent = float(rd.tail(15).mean()*100); drift = recent < 0
    dd = oos.groupby("date").apply(lambda g: pd.Series(dict(t=g[g.rk <= 5].ret.mean(), b=g.ret.mean()))).dropna(); ex = (dd.t - dd.b).values
    rng = np.random.RandomState(1); blk = 10; nb = max(len(ex)//blk, 1)                          # bootstrap بكتل 10 أيام لمراعاة تداخل الصفقات
    bs = [np.concatenate([ex[i:i+blk] for i in rng.randint(0, max(len(ex)-blk, 1), nb)]).mean() for _ in range(2000)]
    excess_ci = (float(np.percentile(bs, 5))*100, float(np.percentile(bs, 95))*100)
    fold_ex = oos.groupby("fold").apply(lambda g: g[g.rk <= 5].ret.mean() - g.ret.mean()).dropna()
    plc = None
    if placebo:
        exs, bl0 = [], None
        for sd_ in range(5):                                                             # 5 تباديل عشوائية: بذرة واحدة ضجيج
            po, _ = walk_forward(P, placebo=sd_); po["rk"] = po.groupby("date").p.rank(ascending=False, method="first")
            bl0 = stats(po)["avg"]; exs.append(round(stats(po[po.rk <= 5])["avg"] - bl0, 2))
        plc = dict(seeds=5, excess_list=exs, excess_mean=round(float(np.mean(exs)), 2), excess_max=max(exs), baseline=bl0)
    # ---- النموذج الحي ----
    L = P[P.elig & P.filled & P.y.notna()].sort_values(["date", "ticker"]); live = P[P.date == latest].copy()
    fresh_syms = [t for t, d in prices.items() if d.date.iloc[-1] == latest]
    live = live[live.ticker.isin(fresh_syms) & live.elig]
    unverified = sorted(t for t in live.ticker if LAST_BAR.get(t, {}).get("status") == "supplemental_unverified" and LAST_BAR[t]["date"] == str(latest.date()))
    live = live[~live.ticker.isin(unverified)]                                       # آخر شريط غير موثّق => لا يُرتَّب اليوم
    live["p"] = fit_predict(L, live)
    iso = IsotonicRegression(out_of_bounds="clip", y_min=0, y_max=1).fit(oos[oos.y.notna()].p, oos[oos.y.notna()].y); live["pc"] = iso.predict(live.p)
    live["rk"] = live.p.rank(ascending=False, method="first"); live = live.sort_values("p", ascending=False)
    regime = str(live.regime.iloc[0]); breadth, mr20 = float(live.m_breadth.iloc[0]), float(live.m_r20.iloc[0])
    scale = {"صاعد": 1.0, "متذبذب": .7, "هابط": .4}[regime]
    stale = bool(latest < exp); lag = int(np.busday_count(latest.date(), exp.date(), weekmask="1111001")) if stale else 0
    recs = []
    for _, r in live.head(top_n).iterrows():
        c0 = float(prices[r.ticker].iloc[-1].close); sd = float(min(max(STOP_ATR*r.atr, .025), .08)); td = sd*PLAN['t2']/STOP_ATR; t1d = sd*PLAN['t1']/STOP_ATR
        gb = bucket(int(r.rk)); g_all, g_reg = table[f"{gb}|الكل"], table[f"{gb}|{regime}"]; notes = []
        ok_all = g_all["n"] >= 150 and g_all.get("avg", 0) > 0.3 and (g_all.get("pf") or 0) > 1.3 and gb in ("top3", "top10")
        ok_reg = g_reg["n"] >= 60 and g_reg["days"] >= 8 and g_reg.get("avg", 0) > 0
        if not ok_all: notes.append("دليل مجموعة الرتبة غير كافٍ أو غير موجب")
        if not ok_reg: notes.append(f"عيّنة حالة السوق ({regime}) لهذه المجموعة صغيرة ({g_reg['n']} صفقة/{g_reg['days']} يوم) أو غير موجبة")
        if drift: notes.append("مفتاح الأداء الأخير مفعّل")
        if stale: notes.append(f"البيانات متأخرة {lag} جلسة عن المتوقعة")
        adv = float(np.expm1(r.turn)); lt = liq_tier(adv); maxpos = round(ADV_CAP*adv, -3)
        if lt == "منخفضة": notes.append(f"سيولة منخفضة (متوسط تداول {adv/1e6:.1f} م.ج/يوم): خطر انزلاق وتأخر؛ لا يتجاوز المركز العملي {maxpos/1e3:,.0f} ألف ج")
        _lo, _hi, _st, _t1 = price_round(c0, c0*(1-ZONE)), price_round(c0, c0*(1+ZONE)), price_round(c0, c0*(1-sd)), price_round(c0, c0*(1+t1d))
        degenerate = levels_degenerate(_lo, _hi, _st, _t1)
        if degenerate: notes.append("مستويات الخطة تتداخل بعد التقريب السعري؛ لا تصلح للتنفيذ")
        if c0 < 2: notes.append("سعر منخفض (<2 ج): حجم الخطوة السعرية كبير نسبياً فقد لا يُنفَّذ الوقف عند مستواه")
        lb = LAST_BAR.get(r.ticker, {})
        if any("reconstructed" in w for w in lb.get("warnings", [])) and lb.get("date") == str(latest.date()): notes.append("آخر شريط: الافتتاح/الأعلى/الأدنى معاد بناؤها من الإغلاق (دقة الوقف أقل)")
        if any("large_move" in w for w in lb.get("warnings", [])) and lb.get("date") == str(latest.date()): notes.append("حركة آخر جلسة كبيرة (>12%) — راجعها")
        if excess_ci[0] <= 0: notes.append("حدّ الثقة الأدنى للتفوق على خط الأساس ≤ 0")
        tier = "A" if (ok_all and ok_reg and not drift and not stale and excess_ci[0] > 0) else ("B" if g_all.get("avg", 0) > 0 and not stale and not drift else "C")
        if degenerate: tier = "C"
        hn = g_all["n"]; ci = wilson_low(round(g_all.get("hit", 0)*hn/100), hn) if hn else 0
        setups = [n for n, k in (("اختراق", r.brk), ("ارتداد في اتجاه صاعد", r.pull), ("زخم بحجم", r.mom), ("اتجاه صاعد", r.trend)) if k == 1]
        recs.append(dict(rank=int(r.rk), ticker=r.ticker, tier=tier, group_hit=g_all.get("hit"), group_hit_low90=round(100*ci, 1),
            evidence=dict(bucket=gb, n=g_all["n"], hit=g_all.get("hit"), avg=g_all.get("avg"), pf=g_all.get("pf"), regime_n=g_reg["n"], regime_days=g_reg["days"], regime_avg=g_reg.get("avg")),
            stock_prob_experimental=round(100*float(r.pc), 1), notes=notes, score=round(100*float(r.p), 1), close=round(c0, 2),
            entry_zone=[price_round(c0, c0*(1-ZONE)), price_round(c0, c0*(1+ZONE))], entry_rule="شراء عند الافتتاح فقط إذا وقع سعر الافتتاح داخل النطاق، وإلا لا تدخل",
            stop=price_round(c0, c0*(1-sd)), target1=price_round(c0, c0*(1+t1d)), target2=price_round(c0, c0*(1+td)), stop_pct=round(sd*100, 1), target_pct=round(t1d*100, 1), target2_pct=round(td*100, 1), rr=round(td/sd, 2), rr1=round(t1d/sd, 2),
            manage=f"عند الهدف 1 بِع {int(PLAN['frac']*100)}% وانقل الوقف إلى سعر الدخول؛ الباقي للهدف 2 أو التعادل، وأقصى مدة {H} جلسات",
            size_pct=round(min(0.5/sd, 10)*scale, 1), rsi=int(r.rsi), vol_ratio=round(float(np.expm1(r.volr)), 1), r5=round(float(r.r5)*100, 1), r20=round(float(r.r20)*100, 1),
            turnover_m=round(float(np.expm1(r.turn))/1e6, 1), liq_tier=lt, max_position_egp=int(maxpos), setups=setups, horizon=H))
    doc = dict(engine="EGX-NEXT-V2.1", generated=pd.Timestamp.now("UTC").isoformat(), session=str(latest.date()), expected_session=str(exp.date()), stale=stale, stale_lag_sessions=lag,
        universe=int(len(live)), symbols=len(prices), excluded=excluded, excluded_unverified_last_bar=unverified, history_sessions=int(P.date.nunique()), regime=regime, breadth_pct=round(breadth*100, 1), market_r20_pct=round(mr20*100, 1),
        exposure_scale=scale, edge_found=any(r["tier"] == "A" for r in recs), recent_top5_avg_pct=round(recent, 2), drift_guard=bool(drift), recommendations=recs,
        integrity=dict(top5_excess_mean_pct=round(float(ex.mean())*100, 2), top5_excess_ci90_block=[round(excess_ci[0], 2), round(excess_ci[1], 2)], folds_positive=f"{int((fold_ex > 0).sum())}/{len(fold_ex)}", purge_rule="train.end_date < test.start_date (لكل إشارة)", folds=len(leak), all_folds_clean=bool(all(leak)), fill_rate_pct=fill_rate, placebo=plc,
            brier=None if brier is None else round(brier, 4), brier_constant=None if brier0 is None else round(brier0, 4), data_hash=data_fingerprint(prices),
            versions=dict(platform=platform.platform(), cpus=os.cpu_count(), python=sys.version.split()[0], pandas=pd.__version__, numpy=np.__version__, sklearn=sklearn.__version__)),
        backtest=dict(method="Walk-forward + تنقية بتاريخ انتهاء النتيجة + دخول عند الافتتاح داخل ±1% + فجوات بسعر الافتتاح + تكلفة 0.6% + الوقف أولاً",
            oos_sessions=int(oos.date.nunique()), baseline_all=base, calibration=table, by_month_top5=by_month, reliability=rel, params=dict(horizon=H, stop_atr=STOP_ATR, target_atr=TGT_ATR, cost=COST, zone=ZONE), **top))
    liq = liquidity_study(oos); plan_ev = plan_study(oos)
    # ---- محاكاة المحفظة + سجل المتابعة الحي ----
    pf = portfolio.run(oos.assign(xpx=oos.p_x, end=oos.p_end), prices)                 # المحفظة تتبع خطة الهدفين
    pf_hold = portfolio.run(oos, prices)   # بديل: الاحتفاظ بالهدف 2 فقط (هدف واحد بعيد)
    rows_all = [[r.ticker, int(r.rk), round(float(prices[r.ticker].iloc[-1].close), 4), round(float(min(max(STOP_ATR*r.atr, .025), .08)), 4),
                 round(float(min(max(STOP_ATR*r.atr, .025), .08)*TGT_ATR/STOP_ATR), 4), next((x["tier"] for x in recs if x["ticker"] == r.ticker), "-"), int(np.expm1(r.turn))] for _, r in live.iterrows()]
    lpath = os.path.join(ROOT, "data", "ledger.json")
    lstat = ledger.record(lpath, str(latest.date()), rows_all, dict(stale=stale, regime=regime, data_hash=data_fingerprint(prices)))
    forward = ledger.settle(lpath, prices, run_plan, COST); forward["record_status"] = lstat
    doc["portfolio"] = pf; doc["portfolio_hold"] = {k: pf_hold[k] for k in ("strategy", "random_selection")}; doc["forward"] = forward; doc["liquidity"] = liq; doc["plan"] = plan_ev
    intr = os.path.join(ROOT, "data", "intraday.json")
    if os.path.exists(intr):
        it = json.load(open(intr)); doc["intraday_asof"] = it.get("asof")
        for r in recs: r["intraday"] = it.get("symbols", {}).get(r["ticker"])
    json.dump(doc, open(out_json, "w"), ensure_ascii=False, indent=1, default=lambda o: o.item() if hasattr(o, "item") else str(o))
    oos[["date", "ticker", "p", "pc_h", "y", "ret", "end", "fold"]].assign(date=lambda d: d.date.dt.strftime("%Y-%m-%d"), end=lambda d: d.end.dt.strftime("%Y-%m-%d")).to_csv(os.path.join(os.path.dirname(out_json), "oos_signals.csv"), index=False)
    return doc

if __name__ == "__main__":
    a = [x for x in sys.argv[1:] if not x.startswith("--")] or [os.path.join(ROOT, "data", "history")]
    d = run(a + [os.path.join(ROOT, "data", "prices"), os.path.join(ROOT, "data", "manual")], os.path.join(ROOT, "data", "signals.json"), placebo="--fast" not in sys.argv, blocklist_file=os.path.join(ROOT, "config", "blocklist.json"))
    print({k: d[k] for k in ("session", "expected_session", "stale", "universe", "symbols", "regime", "breadth_pct", "edge_found", "drift_guard")})
    print("excluded:", d["excluded"]); print("integrity:", d["integrity"]); b = d["backtest"]
    for k in ("baseline_all", "top3", "top5", "top10"): print(k, b[k])
    print("excess", d["integrity"]["top5_excess_mean_pct"], d["integrity"]["top5_excess_ci90_block"], d["integrity"]["folds_positive"]); print("months", [(m["month"], m["n"], m["avg"]) for m in b["by_month_top5"]]); print("rel", b["reliability"])
    for r in d["recommendations"]: print(r["rank"], r["ticker"], r["tier"], r["group_hit"], r["evidence"], r["notes"])
