#!/usr/bin/env python3
import json, os, sys, math
import numpy as np

HERE=os.path.dirname(os.path.abspath(__file__))
QUANT=os.path.dirname(HERE)
REPO=os.path.dirname(QUANT)
sys.path.insert(0,os.path.join(QUANT,"engine"))
import egx_engine as E

with open(os.path.join(REPO,"config","execution-contract.json"),encoding="utf-8") as f:
    spec=json.load(f)
with open(os.path.join(REPO,"config","execution-golden-vectors.json"),encoding="utf-8") as f:
    golden=json.load(f)

assert golden["specVersion"]==spec["version"]
assert len(golden["vectors"])>=30
assert E.H==spec["plan"]["holdingHorizonSessions"]
assert abs(E.COST-spec["plan"]["roundTripCostRate"])<1e-12
assert abs(E.ZONE-spec["entry"]["referenceZonePct"])<1e-12
assert abs(E.STOP_ATR-spec["plan"]["stopAtrMultiple"])<1e-12
assert abs(E.PLAN["t1"]-spec["plan"]["target1AtrMultiple"])<1e-12
assert abs(E.PLAN["t2"]-spec["plan"]["target2AtrMultiple"])<1e-12
assert abs(E.PLAN["frac"]-spec["plan"]["target1Fraction"])<1e-12

def close(a,b,tol=1e-9):
    if a is None and b is None: return True
    return a is not None and b is not None and abs(float(a)-float(b))<=tol

passed=0
for v in golden["vectors"]:
    bars=v["bars"]
    o=np.array([x["open"] for x in bars],dtype=float)
    h=np.array([x["high"] for x in bars],dtype=float)
    l=np.array([x["low"] for x in bars],dtype=float)
    c=np.array([x["close"] for x in bars],dtype=float)
    d=np.array([np.datetime64(x["date"]) for x in bars])
    ref=float(v["referenceClose"])
    sd=(ref-float(v["stop"]))/ref
    got=E.run_plan(o,h,l,c,d,int(v["signalIndex"]),ref,sd)
    exp=v["expected"]
    if exp["status"]=="unfilled":
        assert got is not None and got["status"]=="unfilled", (v["id"],got)
        assert exp["netReturnRate"] is None
    else:
        assert got is not None and got["status"]==exp["status"], (v["id"],got,exp)
        assert got.get("hit1")==exp["hit1"], (v["id"],got,exp)
        assert got.get("hit2")==exp["hit2"], (v["id"],got,exp)
        assert bool(got.get("locked",False))==bool(exp["locked"]), (v["id"],got,exp)
        assert close(got.get("ret"),exp["netReturnRate"]), (v["id"],got.get("ret"),exp["netReturnRate"])
    passed+=1

print(json.dumps({"ok":True,"engine":"python","spec":spec["version"],"goldenVectors":passed},indent=2))
