#!/usr/bin/env python3
"""تأكيد الافتتاح (أول 15 دقيقة) لتوصيات data/signals.json — يُشغَّل بعد المحرك ويعدّل signals.json في مكانه ثم يُعاد بناء index.html.
لا يدخل في الترتيب (لا يوجد تاريخ 15د كافٍ للتدريب) — عرض وتأكيد تنفيذ فقط. Yahoo (.CA) متأخر؛ لم يُجرَّب على الشبكة في بيئة التطوير.
حالات كل سهم (status):
  ok              جلسة يوم الدخول المتوقع + الشمعة الأولى مكتملة  => open_in_zone / first15_ret / first15_vol_pct_of_avg_day
  not_entry_day   آخر يوم متاح ليس جلسة الدخول (قبل الافتتاح أو تأخر المصدر)
  incomplete      الشمعة الأولى لم تكتمل بعد (لا توجد شمعة لاحقة)
  unavailable     فشل الجلب / لا بيانات"""
import os, json, time, urllib.request, datetime as dt
from zoneinfo import ZoneInfo
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); P = os.path.join(ROOT, "data", "signals.json")
CAI = ZoneInfo("Africa/Cairo")

def entry_day(sig):
    """يوم الدخول = أول جلسة تداول بعد جلسة الإشارة (أحد–خميس)."""
    d = dt.date.fromisoformat(sig["session"]) + dt.timedelta(days=1)
    while d.weekday() in (4, 5): d += dt.timedelta(days=1)
    return d

def analyse(rec, res, eday):
    ts, q = res["timestamp"], res["indicators"]["quote"][0]; bars = {}
    for i, x in enumerate(ts):
        if q["open"][i] is None or q["volume"][i] is None: continue
        t = dt.datetime.fromtimestamp(x, dt.timezone.utc).astimezone(CAI); bars.setdefault(t.date(), []).append((t, q["open"][i], q["close"][i], q["volume"][i]))
    if not bars: return dict(status="unavailable")
    days = sorted(bars)
    if days[-1] != eday: return dict(status="not_entry_day", latest_day=str(days[-1]), entry_day=str(eday))
    today = sorted(bars[days[-1]]); first = today[0]
    if len(today) < 2: return dict(status="incomplete", entry_day=str(eday))       # لا توجد شمعة بعد الأولى => لم تكتمل
    prev = [sum(b[3] for b in bars[d]) for d in days[:-1]]; avg = sum(prev)/len(prev) if prev else None
    lo, hi = rec["entry_zone"]
    return dict(status="ok", entry_day=str(eday), open=round(first[1], 3), open_in_zone=bool(lo <= first[1] <= hi),
                first15_ret_pct=round((first[2]/first[1]-1)*100, 2), first15_vol_pct_of_avg_day=round(100*first[3]/avg, 1) if avg else None)

if __name__ == "__main__":
    sig = json.load(open(P, encoding="utf-8")); eday = entry_day(sig); ok = 0
    for r in sig["recommendations"]:
        try:
            req = urllib.request.Request(f"https://query1.finance.yahoo.com/v8/finance/chart/{r['ticker']}.CA?range=5d&interval=15m", headers={"User-Agent": "Mozilla/5.0"})
            r["intraday"] = analyse(r, json.load(urllib.request.urlopen(req, timeout=25))["chart"]["result"][0], eday)
        except Exception as e: r["intraday"] = dict(status="unavailable", error=str(e)[:80])
        ok += r["intraday"]["status"] == "ok"; time.sleep(0.5)
    sig["intraday_asof"] = dt.datetime.now(dt.timezone.utc).isoformat()
    json.dump(sig, open(P, "w", encoding="utf-8"), ensure_ascii=False, indent=1); print(f"intraday ok: {ok}/{len(sig['recommendations'])}")
