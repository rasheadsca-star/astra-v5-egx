#!/usr/bin/env python3
"""استيراد يدوي لجلسة/جلسات من ملف CSV (تصدير من مباشر مصر أو البورصة المصرية أو أي جدول) -> data/manual/SYMBOL.csv
الأعمدة المقبولة (بأي ترتيب/حالة): symbol|ticker|code , date , open , high , low , close|last , volume .
إن غاب date يُستخدم --date YYYY-MM-DD. إن غاب open/high/low يُستخدم close (وتنبيه: يضعف دقة الوقف/الفجوات).
الاستخدام:  python fetch/import_today.py closes.csv [--date 2026-09-30]"""
import os, sys, csv, glob
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); OUT = os.path.join(ROOT, "data", "manual"); os.makedirs(OUT, exist_ok=True)
ALIAS = dict(symbol="symbol", ticker="symbol", code="symbol", date="date", open="open", high="high", low="low", close="close", last="close", volume="volume", vol="volume")
def num(x):
    x = str(x).replace(",", "").replace("%", "").strip(); return float(x) if x not in ("", "-", "None") else None
def main(path, date=None):
    known = {os.path.basename(f)[:-5] for f in glob.glob(os.path.join(ROOT, "data", "history", "*.json"))}
    rows = list(csv.DictReader(open(path, encoding="utf-8-sig"))); n = skipped = noohl = 0; unknown = []
    for r in rows:
        r = {ALIAS.get(k.strip().lower()): v for k, v in r.items() if k and k.strip().lower() in ALIAS}
        t = (r.get("symbol") or "").strip().upper(); d = (r.get("date") or date or "").strip()[:10]
        if not t or not d: skipped += 1; continue
        if t not in known: unknown.append(t); continue
        c = num(r.get("close")); v = num(r.get("volume")) or 0
        if not c or c <= 0: skipped += 1; continue
        o, h, l = (num(r.get(k)) for k in ("open", "high", "low"))
        if not (o and h and l): noohl += 1; o, h, l = o or c, h or c, l or c
        f = os.path.join(OUT, t + ".csv"); old = {}
        if os.path.exists(f): old = {x["date"]: x for x in csv.DictReader(open(f))}
        old[d] = dict(date=d, open=o, high=max(h, o, c), low=min(l, o, c), close=c, volume=v)
        with open(f, "w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=["date", "open", "high", "low", "close", "volume"]); w.writeheader(); [w.writerow(old[k]) for k in sorted(old)]
        n += 1
    print(f"تم استيراد {n} سهماً | تخطي {skipped} | رموز غير معروفة {len(set(unknown))}" + (f" | بدون O/H/L: {noohl}" if noohl else ""))
    if unknown: print("  رموز غير موجودة في data/history:", ", ".join(sorted(set(unknown))[:15]))
    return n
if __name__ == "__main__":
    a = [x for x in sys.argv[1:] if not x.startswith("--")]
    if not a: sys.exit(__doc__)
    main(a[0], sys.argv[sys.argv.index("--date")+1] if "--date" in sys.argv else None)
