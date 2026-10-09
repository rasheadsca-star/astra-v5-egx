"""اختبار بناء الموقع الثابت. التشغيل: python tests/test_site.py"""
import sys, os, json
HERE = os.path.dirname(os.path.abspath(__file__)); Q = os.path.dirname(HERE)

def test_build_preserves_v5_root_and_builds_v2_page_with_live_data():
    sys.path.insert(0, os.path.join(Q, "web")); import build as B
    real = os.path.join(Q, "data", "signals.json"); assert os.path.exists(real)
    docs_root = os.path.dirname(Q)
    root_index = os.path.join(docs_root, "docs", "index.html")
    before = open(root_index, encoding="utf-8").read() if os.path.exists(root_index) else ""
    assert "ASTRA V5.1" in before or "Decision Cockpit" in before

    docs = B.build()
    v2_path = os.path.join(docs, "v2.html")
    assert os.path.exists(v2_path)
    v2 = open(v2_path, encoding="utf-8").read()
    sig = json.load(open(real, encoding="utf-8"))

    assert "/*DATA*/null" not in v2 and "/*STATUS*/null" not in v2 and sig["session"] in v2
    live = json.load(open(os.path.join(docs, "data", "signals.json"), encoding="utf-8"))
    assert live["session"] == sig["session"] and live["recommendations"]
    assert "fetch('data/signals.json'" in v2 and "manifest.webmanifest" in v2 and "serviceWorker" in v2

    after = open(root_index, encoding="utf-8").read()
    assert after == before, "quant build must not overwrite the V5.1 root cockpit"
    assert "ASTRA V5.1" in after or "Decision Cockpit" in after

    for name in ("manifest.webmanifest", "sw.js", "icons/icon-192.png", "icons/icon-512.png", ".nojekyll"):
        assert os.path.exists(os.path.join(docs, name)), name
    m = json.load(open(os.path.join(docs, "manifest.webmanifest"), encoding="utf-8"))
    assert m["start_url"].startswith("./") and m["scope"] == "./"

if __name__ == "__main__":
    fs = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for f in fs: f(); print("PASS", f.__name__)
    print(len(fs), "tests passed")
