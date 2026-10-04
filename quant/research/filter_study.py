"""دراسة فلاتر عملية مسبقة التحديد على إشارات خارج العينة + تحقق نصفي العينة. التشغيل: python research/filter_study.py
الخلاصة المسجّلة (1/10/2026): لا فلتر حسّن الأداء بشكل مثبت؛ ميزة النموذج متركزة في الشريحة الأعلى سيولة (≥15 م.ج/يوم)."""
import sys, os, json, numpy as np, pandas as pd
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); os.chdir(ROOT); sys.path.insert(0, os.path.join(ROOT, 'engine')); import egx_engine as E
prices, ex = E.load_prices(['data/history','data/prices','data/manual'])
P = E.build_panel(prices); oos, _ = E.walk_forward(P)
oos = oos.sort_values(['date','ticker']).reset_index(drop=True)
cl = pd.concat([d[['date','close']].assign(ticker=t) for t,d in prices.items()])
oos = oos.merge(cl, on=['date','ticker'], how='left')
oos['rk'] = oos.groupby('date').p.rank(ascending=False, method='first')
# رتبة الأمس لنفس السهم (استمرار الإشارة)
pv = oos.pivot(index='date', columns='ticker', values='rk').shift(1)
oos['rk_prev'] = [pv.at[d,t] if d in pv.index and t in pv.columns else np.nan for d,t in zip(oos.date, oos.ticker)]
oos['turn_med'] = oos.groupby('date').turn.transform('median')
dates = np.sort(oos.date.unique()); half = dates[len(dates)//2]
def top5(df, mask_day=None):
    d = df if mask_day is None else df[df.date.isin(mask_day)]
    d = d.copy(); d['rk2'] = d.groupby('date').p.rank(ascending=False, method='first'); return d[d.rk2 <= 5]
def st(t, b):
    t = t[t.ret.notna()]; b = b[b.ret.notna()]
    if len(t) < 30: return None
    return dict(n=len(t), hit=round(100*t.y.mean(),1), avg=round(100*t.ret.mean(),2), exc=round(100*(t.ret.mean()-b.ret.mean()),2), pf=round(t.ret[t.ret>0].sum()/max(-t.ret[t.ret<0].sum(),1e-9),2))
def block_ci(t, b, blk=10, B=1500):
    td = t.groupby('date').ret.mean(); bd = b.groupby('date').ret.mean(); ex = (td - bd.reindex(td.index)).dropna().values
    if len(ex) < 2*blk: return None
    rng = np.random.RandomState(3); nb = max(len(ex)//blk,1)
    bs = [np.concatenate([ex[i:i+blk] for i in rng.randint(0, len(ex)-blk, nb)]).mean() for _ in range(B)]
    return [round(100*np.percentile(bs,5),2), round(100*np.percentile(bs,95),2)]
F = {
 'F0 الأساس (Top5)': oos,
 'F1 سعر ≥ 2 ج': oos[oos.close >= 2],
 'F2 استمرار الإشارة (Top10 أمس واليوم)': oos[oos.rk_prev <= 10],
 'F3 سيولة فوق وسيط اليوم': oos[oos.turn > oos.turn_med],
 'F4 بلا مطاردة (RSI<70 و r5<12%)': oos[(oos.rsi < 70) & (oos.r5 < 0.12)],
 'F5 تذبذب معتدل (ATR ≤ 5%)': oos[oos.atr <= 0.05],
 'F6 F1+F2+F3 معاً': oos[(oos.close >= 2) & (oos.rk_prev <= 10) & (oos.turn > oos.turn_med)],
}
base_all = oos
print('عدد جلسات الاختبار', len(dates), '| نصف العينة عند', str(half)[:10])
rows = []
for name, d in F.items():
    t = top5(d); b = base_all[base_all.date.isin(t.date.unique())]
    tot = st(t, b); h1 = st(t[t.date < half], b[b.date < half]); h2 = st(t[t.date >= half], b[b.date >= half]); ci = block_ci(t, b)
    rows.append((name, tot, h1, h2, ci)); 
    f = lambda s: '—' if not s else f"n={s['n']:>3} hit={s['hit']:>4}% avg={s['avg']:>5}% exc={s['exc']:>5}%"
    print(f"{name:42s} كل: {f(tot)} pf={tot['pf'] if tot else '—'} | نصف1: exc={h1['exc'] if h1 else '—'} | نصف2: exc={h2['exc'] if h2 else '—'} | CI90 للتفوق: {ci}")
# اختبار بوابة السوق (على مستوى اليوم): أداء Top5 حسب اتساع السوق
t = top5(oos); t = t.assign(b=pd.cut(t.m_breadth, [0,.25,.45,.6,1.0], labels=['<25%','25–45%','45–60%','>60%']))
print('\nأداء Top5 حسب اتساع السوق يوم الإشارة:'); 
for k,g in t.groupby('b', observed=True): print(f"  اتساع {k:7s} n={g.ret.notna().sum():>3} أيام={g.date.nunique():>3} avg={100*g.ret.mean():>5.2f}% hit={100*g.y.mean():>4.1f}%")
b = oos.assign(b=pd.cut(oos.m_breadth, [0,.25,.45,.6,1.0], labels=['<25%','25–45%','45–60%','>60%']))
print('  (خط الأساس لكل الأسهم):', {str(k): round(100*g.ret.mean(),2) for k,g in b.groupby('b', observed=True)})

