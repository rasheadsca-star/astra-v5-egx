"""محاكاة محفظة واقعية فوق إشارات الاختبار خارج العينة: حد أقصى للمراكز، حجم من المخاطرة، سقف سيولة، تكلفة، تقييم يومي، ثم مقارنة باختيار عشوائي ومؤشر السوق."""
import numpy as np, pandas as pd
SCALE = {"صاعد": 1.0, "متذبذب": .7, "هابط": .4}

def simulate(oos, closes, K=5, max_pos=8, risk=0.005, cap=0.10, adv_cap=0.05, eq0=1_000_000.0, cost=0.006, seed=None):
    sig = oos[oos.filled & oos.edate.notna() & oos.xpx.notna()].copy()
    rng = np.random.RandomState(seed) if seed is not None else None
    pool = oos if seed is not None else None
    ent = {}
    if seed is None:
        for _, r in sig[sig.rk <= K].sort_values("rk").iterrows(): ent.setdefault(r.edate, []).append(r)
    else:                                                      # اختيار عشوائي: K أسهم عشوائية من المؤهلين كل يوم إشارة (قبل معرفة الملء)
        for dte, g in oos.groupby("date"):
            pick = g.iloc[rng.permutation(len(g))[:K]]; pick = pick[pick.filled & pick.edate.notna() & pick.xpx.notna()]
            for _, r in pick.iterrows(): ent.setdefault(r.edate, []).append(r)
    cal = closes.index[(closes.index >= sig.edate.min()) & (closes.index <= sig.end.max())]
    cash, pos, eq_prev, curve, trades, expo = eq0, {}, eq0, [], [], []
    for d in cal:
        for t, p in list(pos.items()):
            if p["end"] == d:
                proceeds = p["sh"]*p["xpx"]*(1 - cost/2); cash += proceeds; trades.append(proceeds/p["cost_in"] - 1); del pos[t]
        for r in ent.get(d, []):
            if r.ticker in pos or len(pos) >= max_pos: continue
            size = min(risk/r.sd, cap)*SCALE.get(r.regime, .7)*eq_prev
            size = min(size, adv_cap*np.expm1(r.turn), cash/(1 + cost/2))
            if size < 5000: continue
            pos[r.ticker] = dict(sh=size/r.epx, end=r.end, xpx=r.xpx, cost_in=size*(1 + cost/2)); cash -= size*(1 + cost/2)
        val = sum(p["sh"]*closes.at[d, t] for t, p in pos.items() if not np.isnan(closes.at[d, t]))
        eq = cash + val; curve.append(eq); eq_prev = eq; expo.append(val/eq if eq else 0)
    s = pd.Series(curve, index=cal); return s, trades, float(np.mean(expo)) if expo else 0.0

def metrics(s, trades, expo):
    r = s.pct_change().dropna(); dd = (s/s.cummax() - 1).min()
    return dict(total_return_pct=round(100*(s.iloc[-1]/s.iloc[0] - 1), 2), max_drawdown_pct=round(100*float(dd), 2), sharpe=round(float(r.mean()/r.std()*np.sqrt(247)), 2) if r.std() > 0 else None,
                trades=len(trades), win_pct=round(100*float(np.mean(np.array(trades) > 0)), 1) if trades else None, avg_exposure_pct=round(100*expo, 1), days=len(s))

def run(oos, prices, n_random=20, **kw):
    closes = pd.DataFrame({t: d.set_index("date").close for t, d in prices.items()}).sort_index().ffill()
    s, tr, ex = simulate(oos, closes, **kw); m = metrics(s, tr, ex)
    rnd = []
    for sd in range(n_random):
        s2, t2, e2 = simulate(oos, closes, seed=sd, **kw); rnd.append(metrics(s2, t2, e2))
    rets = np.array([x["total_return_pct"] for x in rnd]); dds = np.array([x["max_drawdown_pct"] for x in rnd])
    bench = closes.loc[s.index].pct_change().mean(axis=1).fillna(0); bcurve = (1 + bench).cumprod()*s.iloc[0]
    bm = dict(total_return_pct=round(100*(bcurve.iloc[-1]/bcurve.iloc[0] - 1), 2), max_drawdown_pct=round(100*float((bcurve/bcurve.cummax() - 1).min()), 2))
    step = max(len(s)//120, 1)
    return dict(params=dict(K=kw.get("K", 5), max_pos=kw.get("max_pos", 8), risk_pct=kw.get("risk", .005)*100, pos_cap_pct=kw.get("cap", .1)*100, adv_cap_pct=kw.get("adv_cap", .05)*100, start_equity=1_000_000),
        strategy=m, market_equal_weight=bm, random_selection=dict(runs=n_random, return_mean=round(float(rets.mean()), 2), return_p10=round(float(np.percentile(rets, 10)), 2), return_p90=round(float(np.percentile(rets, 90)), 2),
            dd_mean=round(float(dds.mean()), 2), strategy_beats_pct=round(100*float((rets < m["total_return_pct"]).mean()), 0)),
        curve=dict(dates=[d.strftime("%Y-%m-%d") for d in s.index[::step]], strategy=[round(float(x), 0) for x in s.values[::step]], market=[round(float(x), 0) for x in bcurve.values[::step]]))
