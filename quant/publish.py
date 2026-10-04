#!/usr/bin/env python3
"""ينشر مخرجات محرك الكم إلى مخزن ASTRA كحمولة مضغوطة بعقد ثابت: data/quant/signals.json  (schema = astra-quant/v1).
  python quant/publish.py [--out ../data/quant]
لا يغيّر أي قاعدة قرار؛ يعيد تشكيل المخرجات فقط ويقيّم شروط الترقية بنفس عتبات سياسة ASTRA (ucp-forward-promotion/v1)."""
import os, sys, json, argparse, datetime as dt
Q = os.path.dirname(os.path.abspath(__file__))
SCHEMA = "astra-quant/v1"
POLICY = dict(version="ucp-forward-promotion/v1", minForwardSessions=30, minResolvedTrades=30, minObservedCalendarDays=90, minProfitFactor=1.2, minAverageNetReturnPct=0.0, maxCriticalBreaches=0)

def promotion(forward, today=None):
    """نفس عتبات ASTRA. التنفيذ الآلي مرفوض دائماً؛ 'eligible' معلومة فقط."""
    today = today or dt.date.today(); top = forward.get("top") or {}; first = forward.get("first_valid")
    days = (today - dt.date.fromisoformat(first)).days if first else 0
    blockers = []
    if (forward.get("sessions_valid") or 0) < POLICY["minForwardSessions"]: blockers.append("MIN_FORWARD_SESSIONS_NOT_MET")
    if (top.get("n") or 0) < POLICY["minResolvedTrades"]: blockers.append("MIN_RESOLVED_TRADES_NOT_MET")
    if days < POLICY["minObservedCalendarDays"]: blockers.append("MIN_CALENDAR_DAYS_NOT_MET")
    if top.get("pf") is None or top["pf"] < POLICY["minProfitFactor"]: blockers.append("PROFIT_FACTOR_NOT_ESTABLISHED")
    if top.get("avg") is None or top["avg"] <= POLICY["minAverageNetReturnPct"]: blockers.append("AVERAGE_NET_RETURN_NOT_ESTABLISHED")
    return dict(eligible=not blockers, automaticPromotionAllowed=False, executionAllowed=False, status="PROMOTION_REVIEW_ALLOWED" if not blockers else "FORWARD_VALIDATION_REQUIRED",
                blockers=blockers, observedCalendarDays=days, policy=POLICY)

def candidate(r):
    return dict(ticker=r["ticker"], rank=r["rank"], tier=r["tier"], entryLow=r["entry_zone"][0], entryHigh=r["entry_zone"][1], close=r["close"], stop=r["stop"], target1=r["target1"], target2=r["target2"],
                stopPct=r["stop_pct"], target1Pct=r["target_pct"], target2Pct=r["target2_pct"], rr1=r["rr1"], rr2=r["rr"], sizePct=r["size_pct"], horizonSessions=r["horizon"], manage=r["manage"],
                setups=r["setups"], liquidity=dict(tier=r["liq_tier"], turnoverM=r["turnover_m"], maxPositionEgp=r["max_position_egp"]), notes=r["notes"],
                entryRule=r["entry_rule"], intraday=r.get("intraday"))

def build(sig, status=None, today=None):
    I, b, pf = sig["integrity"], sig["backtest"], sig["portfolio"]
    return dict(schemaVersion=SCHEMA, engine="EGX-NEXT-QUANT-V5", generatedAt=sig["generated"], session=sig["session"], expectedSession=sig["expected_session"], stale=bool(sig["stale"]), staleLagSessions=sig["stale_lag_sessions"],
        regime=sig["regime"], breadthPct=sig["breadth_pct"], exposureScale=sig["exposure_scale"], driftGuard=bool(sig["drift_guard"]), recentTop5AvgPct=sig["recent_top5_avg_pct"],
        permissions=dict(researchOnly=True, executionAllowed=False, productionAllocation=False, automaticOrders=False),
        universe=sig["universe"], symbols=sig["symbols"], excludedCount=len(sig.get("excluded") or {}), candidates=[candidate(r) for r in sig["recommendations"]],
        plan=sig["plan"], liquidity=sig["liquidity"],
        evidence=dict(top5ExcessMeanPct=I["top5_excess_mean_pct"], top5ExcessCi90=I["top5_excess_ci90_block"], foldsPositive=I["folds_positive"], placebo=I["placebo"], leakFree=I["all_folds_clean"], fillRatePct=I["fill_rate_pct"],
                      baseline=b["baseline_all"], top5=b["top5"], portfolioTwoTargets=pf["strategy"], portfolioHoldT2=sig["portfolio_hold"]["strategy"], marketEqualWeightPct=pf["market_equal_weight"]["total_return_pct"],
                      randomSelection=pf["random_selection"], oosSessions=b["oos_sessions"]),
        integrity=dict(dataHash=I["data_hash"], versions=I["versions"]), forward=sig["forward"], promotion=promotion(sig["forward"], today),
        dataStatus=None if not status else {k: status.get(k) for k in ("finalStatus", "guard", "expectedSession", "actualAcceptedSession", "coveragePct", "acceptedRows", "staleRows", "quarantinedCount", "stage1Prepared", "preparedCandidateCount")})

def main(argv=None):
    ap = argparse.ArgumentParser(); ap.add_argument("--out", default=os.path.join(os.path.dirname(Q), "data", "quant")); a = ap.parse_args(argv)
    sig = json.load(open(os.path.join(Q, "data", "signals.json"), encoding="utf-8")); st = None
    sp = os.path.join(Q, "data", "daily-data-update-status.json")
    if os.path.exists(sp): st = json.load(open(sp, encoding="utf-8"))
    doc = build(sig, st); os.makedirs(a.out, exist_ok=True); p = os.path.join(a.out, "signals.json"); tmp = p + ".tmp"
    # لا commit بلا تغيير حقيقي: تجاهل generatedAt عند المقارنة
    try:
        old = json.load(open(p, encoding="utf-8")); strip = lambda d: {k: v for k, v in d.items() if k != "generatedAt"}
        if strip(old) == strip(doc): print("لا تغيير في حمولة ASTRA"); return 0
    except Exception: pass
    json.dump(doc, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=1); os.replace(tmp, p)
    print(f"نُشرت {SCHEMA}: جلسة {doc['session']} | {len(doc['candidates'])} مرشحاً | الترقية: {doc['promotion']['status']}"); return 0

if __name__ == "__main__": sys.exit(main())
