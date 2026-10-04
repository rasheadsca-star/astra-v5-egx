"""اختبار بناء الموقع الثابت. التشغيل: python tests/test_site.py"""
import sys, os, json, re, subprocess, tempfile, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); Q = os.path.dirname(HERE)

def test_build_produces_self_contained_site_with_live_data_and_embedded_fallback():
    sys.path.insert(0, os.path.join(Q, "web")); import build as B
    real = os.path.join(Q, "data", "signals.json"); assert os.path.exists(real)
    docs = B.build(); idx = open(os.path.join(docs, "index.html"), encoding="utf-8").read(); sig = json.load(open(real, encoding="utf-8"))
    assert "/*DATA*/null" not in idx and "/*STATUS*/null" not in idx and sig["session"] in idx
    live = json.load(open(os.path.join(docs, "data", "signals.json"), encoding="utf-8")); assert live["session"] == sig["session"] and live["recommendations"]
    assert "fetch('data/signals.json'" in idx and "manifest.webmanifest" in idx and "serviceWorker" in idx          # يتحدث بجلب حي + قابل للتثبيت
    for f in ("manifest.webmanifest", "sw.js", "icons/icon-192.png", "icons/icon-512.png", ".nojekyll"): assert os.path.exists(os.path.join(docs, f)), f
    m = json.load(open(os.path.join(docs, "manifest.webmanifest"), encoding="utf-8")); assert m["start_url"].startswith("./") and m["scope"] == "./"      # يعمل تحت مسار /REPO/

if __name__ == "__main__":
    fs = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for f in fs: f(); print("PASS", f.__name__)
    print(len(fs), "tests passed")
