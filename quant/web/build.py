#!/usr/bin/env python3
"""يبني الموقع الثابت (GitHub Pages) من مخرجات محرك الكم:  docs/v2.html + docs/data/*.json
الصفحة تجلب data/signals.json بلا تخزين مؤقت (تتحدث وحدها بعد كل commit)، وتحمل نسخة مضمّنة احتياطية.
  python quant/web/build.py"""
import os, sys, json, shutil
W = os.path.dirname(os.path.abspath(__file__)); Q = os.path.dirname(W); ROOT = os.path.dirname(Q); DOCS = os.path.join(ROOT, "docs")

def build():
    sig_p = os.path.join(Q, "data", "signals.json"); st_p = os.path.join(Q, "data", "daily-data-update-status.json")
    if not os.path.exists(sig_p): sys.exit("quant/data/signals.json غير موجود — شغّل المحرك أولاً")
    sig = open(sig_p, encoding="utf-8").read(); st = open(st_p, encoding="utf-8").read() if os.path.exists(st_p) else "null"
    tpl = open(os.path.join(W, "template.html"), encoding="utf-8").read()
    assert "/*DATA*/null" in tpl and "/*STATUS*/null" in tpl, "قالب الصفحة تغيّر"
    html = tpl.replace("/*DATA*/null", sig).replace("/*STATUS*/null", st)
    os.makedirs(os.path.join(DOCS, "data"), exist_ok=True)
    for name, text in (("v2.html", html), (os.path.join("data", "signals.json"), sig), (os.path.join("data", "daily-data-update-status.json"), st)):
        p = os.path.join(DOCS, name); tmp = p + ".tmp"; open(tmp, "w", encoding="utf-8").write(text); os.replace(tmp, p)
    d = json.loads(sig); print(f"docs/v2.html جاهز — جلسة {d['session']} | {len(d['recommendations'])} مرشحاً")
    return DOCS

if __name__ == "__main__": build()
