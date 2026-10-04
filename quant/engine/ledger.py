"""سجل المتابعة الحي (Forward Test): تُسجَّل توصيات كل جلسة *قبل* افتتاح يوم الدخول ولا تُعدَّل أبداً، ثم تُسوّى لاحقاً بنفس دالة التنفيذ المستخدمة في الاختبار.
القاعدة الصارمة: أي تسجيل بعد فتح يوم الدخول يُوسم late ويُستبعد من الإحصاء (لأن الرؤية بأثر رجعي ممكنة)."""
import json, os, datetime as dt
import numpy as np
try: from zoneinfo import ZoneInfo; CAI = ZoneInfo("Africa/Cairo")
except Exception: CAI = None
OPEN_HOUR = 10

def now_cairo(): return dt.datetime.now(CAI) if CAI else dt.datetime.utcnow() + dt.timedelta(hours=3)

def entry_day(session):
    d = dt.date.fromisoformat(session) + dt.timedelta(days=1)
    while d.weekday() in (4, 5): d += dt.timedelta(days=1)
    return d

def load(path):
    if os.path.exists(path): return json.load(open(path, encoding="utf-8"))
    return dict(version=1, sessions={})

def record(path, session, rows, meta, now=None):
    """rows: [[ticker, rank, close, sd, td, tier]] لكل سهم مؤهل. غير قابل للكتابة فوقه. يرجع حالة التسجيل."""
    led = load(path)
    if session in led["sessions"]: return "exists"
    if meta.get("stale"): return "skipped_stale"
    now = now or now_cairo(); opens = dt.datetime.combine(entry_day(session), dt.time(OPEN_HOUR, 0), tzinfo=CAI) if CAI else dt.datetime.combine(entry_day(session), dt.time(OPEN_HOUR, 0))
    late = bool(now.replace(tzinfo=None) >= opens.replace(tzinfo=None))
    led["sessions"][session] = dict(recorded_at=now.isoformat(), late=late, regime=meta.get("regime"), data_hash=meta.get("data_hash"), rows=rows)
    os.makedirs(os.path.dirname(path), exist_ok=True); json.dump(led, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    return "recorded_late" if late else "recorded"

def _agg(rs, cost):
    rs = [r for r in rs if r["status"] == "closed"]
    if not rs: return dict(n=0)
    ret = np.array([r["ret"] for r in rs]); w, l = ret[ret > 0].sum(), -ret[ret < 0].sum()
    return dict(n=len(rs), hit=round(100*float(np.mean([r["hit"] for r in rs])), 1), avg=round(100*float(ret.mean()), 2), win=round(100*float((ret > 0).mean()), 1),
                pf=round(float(w/l), 2) if l > 0 else None)

def settle(path, prices, runner, cost, top=5):
    led = load(path); trades = []
    for sess, rec in led["sessions"].items():
        for row in rec["rows"]:
            t, rk, close, sd, td, tier, *extra = row; adv = extra[0] if extra else None
            df = prices.get(t)
            if df is None: continue
            idx = np.where(df.date.values == np.datetime64(sess))[0]
            if len(idx) == 0: continue
            i = int(idx[0]); o, h, l, c, d = (df[k].values for k in ("open", "high", "low", "close", "date"))
            r = runner(o, h, l, c, d, i, close, sd)
            if r is None: trades.append(dict(session=sess, ticker=t, rank=rk, tier=tier, adv=adv, late=rec["late"], status="pending")); continue
            out = dict(session=sess, ticker=t, rank=rk, tier=tier, adv=adv, late=rec["late"], status=r["status"])
            if r["status"] == "closed": out.update(hit=r["hit1"], hit2=r.get("hit2"), ret=r["ret"])
            trades.append(out)
    live = [x for x in trades if not x["late"]]
    st = lambda f: _agg([x for x in live if f(x)], cost)
    cnt = lambda s: sum(1 for x in live if x["status"] == s)
    sessions = led["sessions"]
    return dict(sessions_recorded=len(sessions), sessions_valid=sum(1 for v in sessions.values() if not v["late"]), sessions_late=sum(1 for v in sessions.values() if v["late"]),
        pending=cnt("pending"), open=cnt("open"), unfilled=cnt("unfilled"), closed=cnt("closed"), top=st(lambda x: x["rank"] <= top), all=st(lambda x: True),
        tierA=st(lambda x: x["tier"] == "A"),
        by_liquidity={k: _agg([x for x in live if x["rank"] <= top and x.get("adv") is not None and lo <= x["adv"] < hi], cost) for k, (lo, hi) in {"منخفضة": (0, 5e6), "متوسطة": (5e6, 15e6), "عالية": (15e6, 1e18)}.items()}, top_n=top, first_valid=min([k for k, v in sessions.items() if not v["late"]], default=None))
