#!/usr/bin/env python3
"""Research only: paired before/after evaluation; restores the live ledger."""
import json, os, sys, subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "quant/engine"))
import egx_engine as e
OUT = ROOT / "quant/research/results/five-year"
OUT.mkdir(parents=True, exist_ok=True)
paths = [str(ROOT / "quant/data" / k) for k in ("prices", "history", "manual")]
block = str(ROOT / "quant/config/blocklist.json")
ledger = ROOT / "quant/data/ledger.json"
original = ledger.read_bytes() if ledger.exists() else None

def evaluate(label):
    prices, excluded = e.load_prices(paths, json.loads(Path(block).read_text()))
    panel = e.build_panel(prices)
    doc = e.run(paths, str(OUT / (label + ".json")), placebo=True, blocklist_file=block)
    return {"history_sessions": doc["history_sessions"], "symbols": doc["symbols"],
            "first_session": str(panel.date.min().date()), "last_session": doc["session"],
            "bear_sessions": int(panel.loc[panel.regime == "هابط", "date"].nunique()),
            "oos_sessions": doc["backtest"]["oos_sessions"], "top5": doc["backtest"]["top5"],
            "baseline": doc["backtest"]["baseline_all"], "integrity": doc["integrity"],
            "excluded_count": len(excluded)}

try:
    report = {"executionAllowed": False, "scope": "research_only_current_universe_survivorship_bias", "before": evaluate("before")}
    fetched = subprocess.run([sys.executable, "quant/fetch/fetch_free.py", "--range", "5y"], cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    (OUT / "fetch.log").write_text(fetched.stdout)
    print(fetched.stdout, flush=True)
    report["fetch_exit_code"] = fetched.returncode
    report["after"] = evaluate("after")
    report["added_sessions"] = report["after"]["history_sessions"] - report["before"]["history_sessions"]
    report["csv_files"] = len(list((ROOT / "quant/data/prices").glob("*.csv")))
    report["five_year_coverage_proven"] = report["after"]["history_sessions"] >= 1000 and report["added_sessions"] > 0
    report["edge_proven"] = report["after"]["integrity"]["top5_excess_ci90_block"][0] > 0
    (OUT / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
finally:
    if original is None: ledger.unlink(missing_ok=True)
    else: ledger.write_bytes(original)
