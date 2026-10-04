"""دراسة هندسة الصفقة (قرب الهدف/الأفق/الخروج الجزئي) على إشارات Top5 خارج العينة. ترتيب الأسهم ثابت؛ يتغير الهدف والوقف فقط.
التشغيل: python research/geometry_study.py"""
import sys, os, numpy as np, pandas as pd
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); os.chdir(ROOT); sys.path.insert(0, os.path.join(ROOT, 'engine')); import egx_engine as E
prices, _ = E.load_prices(['data/history', 'data/prices', 'data/manual']); P = E.build_panel(prices); oos, _ = E.walk_forward(P)
oos = oos.sort_values(['date', 'ticker']).reset_index(drop=True); oos['rk'] = oos.groupby('date').p.rank(ascending=False, method='first')
top = oos[oos.rk <= 5][['date', 'ticker', 'atr', 'rk']].copy(); dates = np.sort(oos.date.unique()); half = dates[len(dates)//2]
arr = {t: tuple(d[k].values for k in ('open', 'high', 'low', 'close', 'date')) for t, d in prices.items()}
def sim(stop_atr, tgt_atr, H, scale=None, rows=None, need=None):
    """scale=(frac, t1_atr): بيع frac عند t1 ثم نقل الوقف لسعر الدخول وانتظار الهدف النهائي."""
    E.H = H; res = []
    for r in (top if rows is None else rows).itertuples():
        o, h, l, c, d = arr[r.ticker]; i = int(np.searchsorted(d, np.datetime64(r.date)))
        if i + (need or H) >= len(c): continue
        sd = min(max(stop_atr*r.atr, .025), .08); td = sd*tgt_atr/stop_atr; stp, tgt = c[i]*(1-sd), c[i]*(1+td)
        if scale is None:
            x = E.run_trade(o, h, l, c, d, i, stp, tgt, c[i])
            if x is None or x['status'] != 'closed': continue
            res.append((r.date, x['hit'], x['ex']/x['e'] - 1 - E.COST, 1, x['hit'] == 1)); continue
        frac, t1a = scale; t1 = c[i]*(1 + sd*t1a/stop_atr)
        x1 = E.run_trade(o, h, l, c, d, i, stp, t1, c[i])                    # الجزء الأول: هدف قريب
        if x1 is None or x1['status'] != 'closed': continue
        e = x1['e']
        if x1['hit'] == 0: res.append((r.date, 0, x1['ex']/e - 1 - E.COST, 0, False)); continue          # لم يبلغ الهدف القريب: خسارة/خروج زمني كاملاً
        # بعد بلوغ الهدف القريب: يُنقل الوقف إلى الدخول والباقي يطلب الهدف النهائي ضمن الأفق المتبقي
        j0 = int(np.searchsorted(d, np.datetime64(x1['end']))); ex2 = None
        for j in range(j0 + 1, min(i + 1 + H, len(c))):
            if o[j] <= e: ex2 = o[j]; break
            if l[j] <= e: ex2 = e; break
            if h[j] >= tgt: ex2 = tgt; break
        if ex2 is None: ex2 = c[min(i + H, len(c) - 1)]
        pnl = frac*(x1['ex']/e - 1) + (1 - frac)*(ex2/e - 1) - E.COST; res.append((r.date, 1, pnl, 1, ex2 >= tgt))
    E.H = 10; return pd.DataFrame(res, columns=['date', 'hit', 'ret', 'full', 'hit2'])
def row(name, df):
    if len(df) < 50: return f"{name:34s} (عينة غير كافية)"
    a, b = df[df.date < half], df[df.date >= half]; w, l = df.ret[df.ret > 0].sum(), -df.ret[df.ret < 0].sum()
    return f"{name:34s} n={len(df):>3} إصابة الهدف={100*df.hit.mean():>4.1f}% ربح={100*(df.ret>0).mean():>4.1f}% متوسط={100*df.ret.mean():>5.2f}% PF={w/max(l,1e-9):>4.2f} | نصف1={100*a.ret.mean():>5.2f}% نصف2={100*b.ret.mean():>5.2f}%"

allr = oos[['date', 'ticker', 'atr', 'rk']].copy()
print('=== مقارنة منضبطة: نفس الإشارات تماماً (اكتمال 20 جلسة لكل إشارة) والتفوق على كل الأسهم بنفس الهندسة ===')
def both(name, **kw):
    t = sim(rows=top, need=20, **kw); b = sim(rows=allr, need=20, **kw); a1, b1 = t[t.date < half], t[t.date >= half]; ba, bb = b[b.date < half], b[b.date >= half]
    w, l = t.ret[t.ret > 0].sum(), -t.ret[t.ret < 0].sum()
    print(f"{name:40s} n={len(t):>3} إصابة={100*t.hit.mean():>4.1f}% (الأساس {100*b.hit.mean():>4.1f}%) متوسط={100*t.ret.mean():>5.2f}% (الأساس {100*b.ret.mean():>5.2f}%) تفوق={100*(t.ret.mean()-b.ret.mean()):>+5.2f}% PF={w/max(l,1e-9):.2f} | تفوق نصف1={100*(a1.ret.mean()-ba.ret.mean()):+.2f}% نصف2={100*(b1.ret.mean()-bb.ret.mean()):+.2f}%")
    return t
both('الحالي: هدف 2.5 / أفق 10', stop_atr=1.5, tgt_atr=2.5, H=10)
both('هدف 2.5 / أفق 15', stop_atr=1.5, tgt_atr=2.5, H=15)
both('هدف 2.5 / أفق 20', stop_atr=1.5, tgt_atr=2.5, H=20)
both('هدف 1.0 / أفق 10', stop_atr=1.5, tgt_atr=1.0, H=10)
both('هدف 1.5 / أفق 15', stop_atr=1.5, tgt_atr=1.5, H=15)
t = both('خروج جزئي 50% عند 1.0 / نهائي 2.5 / أفق 15', stop_atr=1.5, tgt_atr=2.5, H=15, scale=(0.5, 1.0))
print(f"   ضمن هذه الخطة: بلوغ الهدف 1 = {100*t.hit.mean():.1f}% | بلوغ الهدف 2 (من إجمالي الصفقات) = {100*t.hit2.mean():.1f}% | خسارة كاملة (وقف قبل الهدف 1) = {100*(t.hit==0).mean():.1f}%")
t = both('خروج جزئي 50% عند 1.25 / نهائي 2.5 / أفق 15', stop_atr=1.5, tgt_atr=2.5, H=15, scale=(0.5, 1.25))
print(f"   بلوغ الهدف 1 = {100*t.hit.mean():.1f}% | الهدف 2 = {100*t.hit2.mean():.1f}%")

print('\\n=== الخروج الجزئي بأفق 10 مقابل 15 (نفس الإشارات) ===')
both('خروج جزئي 50% عند 1.0 / نهائي 2.5 / أفق 10', stop_atr=1.5, tgt_atr=2.5, H=10, scale=(0.5, 1.0))
# كل الإشارات المتاحة لأفق 10 (بدون استبعاد آخر 20 يوماً)
t = sim(1.5, 2.5, 10, scale=(0.5, 1.0), rows=top); b = sim(1.5, 2.5, 10, scale=(0.5, 1.0), rows=allr)
a1, b1 = t[t.date < half], t[t.date >= half]; ba, bb = b[b.date < half], b[b.date >= half]
print(f"كل الإشارات (n={len(t)}): بلوغ الهدف1={100*t.hit.mean():.1f}% (الأساس {100*b.hit.mean():.1f}%) الهدف2={100*t.hit2.mean():.1f}% خسارة كاملة={100*(t.hit==0).mean():.1f}% متوسط={100*t.ret.mean():.2f}% (الأساس {100*b.ret.mean():.2f}%) تفوق={100*(t.ret.mean()-b.ret.mean()):+.2f}% | نصف1={100*(a1.ret.mean()-ba.ret.mean()):+.2f}% نصف2={100*(b1.ret.mean()-bb.ret.mean()):+.2f}%")
rec = t[t.date >= t.date.max() - pd.Timedelta(days=45)]; recb = b[b.date >= b.date.max() - pd.Timedelta(days=45)]
print(f"آخر 45 يوماً (الأضعف): n={len(rec)} بلوغ الهدف1={100*rec.hit.mean():.1f}% (الأساس {100*recb.hit.mean():.1f}%) متوسط={100*rec.ret.mean():.2f}% (الأساس {100*recb.ret.mean():.2f}%)")
