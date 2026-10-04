#!/usr/bin/env python3
"""جلب تاريخ يومي مجاني (Yahoo Finance، رموز .CA) -> data/prices/SYMBOL.csv مع تشخيص واضح لحداثة ما جُلب.
التحقق المتقاطع: يُتخطى السهم إذا اختلف آخر إغلاق عن آخر إغلاق محلي >15%.
الاستخدام:  python fetch/fetch_free.py [--range 5y]      (للتحديث اليومي السريع: --range 1mo)
يخرج بكود 2 إذا وصل أقل من 50% من الأسهم إلى آخر جلسة متاحة (مؤشر أن المصدر متأخر) — عندها استخدم fetch/import_today.py."""
import os, sys, json, time, glob, csv, collections, urllib.request, datetime as dt
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); OUT = os.path.join(ROOT, "data", "prices"); os.makedirs(OUT, exist_ok=True)
rng = sys.argv[sys.argv.index("--range")+1] if "--range" in sys.argv else "5y"
def local_last(t):
    try: return json.load(open(os.path.join(ROOT, "data", "history", t + ".json")))["sessions"][-1]["close"]
    except Exception: return None
def get(t):
    err = None
    for host in ("query1", "query2", "query1"):                                   # 3 محاولات بمضيفين مختلفين
        try:
            url = f"https://{host}.finance.yahoo.com/v8/finance/chart/{t}.CA?range={rng}&interval=1d&events=history"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}); return json.load(urllib.request.urlopen(req, timeout=25))["chart"]["result"][0]
        except Exception as e: err = e; time.sleep(1.0)
    raise err
ok, bad, last_dates, streak = 0, [], collections.Counter(), 0
for f in sorted(glob.glob(os.path.join(ROOT, "data", "history", "*.json"))):
    t = os.path.basename(f)[:-5]
    try:
        r = get(t); q = r["indicators"]["quote"][0]; rows = []
        for i, ts in enumerate(r["timestamp"]):
            if any(q[k][i] is None for k in ("open", "high", "low", "close", "volume")): continue
            if min(q[k][i] for k in ("open", "high", "low", "close")) <= 0 or q["volume"][i] < 0: continue
            if not (q["low"][i] <= min(q["open"][i], q["close"][i]) <= max(q["open"][i], q["close"][i]) <= q["high"][i]): continue
            rows.append([dt.datetime.fromtimestamp(ts, dt.timezone.utc).strftime("%Y-%m-%d"), q["open"][i], q["high"][i], q["low"][i], q["close"][i], q["volume"][i]])
        ref = local_last(t)
        if not rows: bad.append((t, "فارغ")); continue
        if ref and abs(rows[-1][4]/ref-1) > 0.15: bad.append((t, "تعارض سعر >15% مع المحلي")); continue
        fp = os.path.join(OUT, t + ".csv"); merged = {}
        if os.path.exists(fp):                                                    # دمج لا استبدال: التحديث السريع لا يمحو التاريخ الطويل
            merged = {x[0]: x for x in csv.reader(open(fp)) if x and x[0] != "date"}
        merged.update({r_[0]: [str(v) for v in r_] for r_ in rows})
        with open(fp, "w", newline="") as fh:
            w = csv.writer(fh); w.writerow(["date", "open", "high", "low", "close", "volume"]); w.writerows(merged[k] for k in sorted(merged))
        ok += 1; last_dates[rows[-1][0]] += 1; streak = 0
    except Exception as e:
        bad.append((t, str(e)[:160])); print(t, str(e)[:160], flush=True); streak += 1
        if streak >= 5 and ok == 0: print("5 إخفاقات متتالية بلا أي نجاح: لا يوجد اتصال بالمصدر (أو محجوب). إيقاف مبكر."); sys.exit(3)
    time.sleep(0.3)
print(f"نجح: {ok}   فشل/تخطي: {len(bad)}")
print("توزيع آخر تاريخ لكل سهم:", dict(sorted(last_dates.items())[-4:]))
for t, why in bad[:15]: print("  -", t, why)
if not ok: print("لم يُجلب شيء: تأكد من الإنترنت أو استخدم fetch/import_today.py"); sys.exit(3)
newest = max(last_dates); share = last_dates[newest]/ok
print(f"أحدث تاريخ: {newest} (يصل إليه {share:.0%} من الأسهم)")
if share < 0.5: print("تحذير: المصدر متأخر أو غير مكتمل لهذا اليوم. استخدم fetch/import_today.py بملف إغلاق اليوم."); sys.exit(2)
