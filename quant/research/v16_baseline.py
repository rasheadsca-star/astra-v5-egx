#!/usr/bin/env python3
"""Prospective selection-only comparison. Never backfills today's basket into history."""
import json,datetime as dt,urllib.request,sys,re
from pathlib import Path
from zoneinfo import ZoneInfo
ROOT=Path(__file__).resolve().parents[2]
SOURCE='https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/main/data/stable/v16-main-app-consensus.json'
ID='V16_9_EQUAL_WEIGHT_BASKET'

def capture(source,signals,snapshots,observed):
    session=source.get('sessionDate')
    if source.get('engineRegistry',{}).get('primary',{}).get('id')!=ID:return 'WAITING_DATA'
    if session!=signals.get('session'):return 'MISALIGNED'
    raw=source.get('current',{}).get('mainAppBasket',[])
    basket=[r if isinstance(r,str) else r.get('ticker',r.get('symbol','')) for r in raw]
    quant=[r['ticker'] for r in signals.get('recommendations',[])[:5]]
    if not basket or not quant or any(not re.fullmatch(r'[A-Z0-9]+',t) for t in basket+quant):return 'WAITING_DATA'
    if session not in snapshots:
        snapshots[session]={'session':session,'observedAt':observed.isoformat(),'sourceGeneratedAt':source.get('generatedAt'),
            'source':SOURCE,'baselineId':ID,'baseline':sorted(set(basket)),'quant':quant}
    return 'COLLECTING'

def compare(snapshots,histories):
    pairs=[];pending=0
    for session,snap in sorted(snapshots.items()):
        names=set(snap['baseline']+snap['quant'])
        observed=dt.datetime.fromisoformat(snap['observedAt'])
        dates=sorted({r['date'] for t in names for r in histories.get(t,[]) if r['date']>session})
        if not dates:pending+=1;continue
        end=dates[0]
        opened=dt.datetime.combine(dt.date.fromisoformat(end),dt.time(10),ZoneInfo('Africa/Cairo'))
        if observed>=opened:pending+=1;continue # refuse retrospective basket evidence
        returns={}
        for t in names:
            rows={r['date']:r for r in histories.get(t,[])}
            a,b=rows.get(session),rows.get(end)
            if not a or not b:continue
            if any(r.get('validationStatus') not in ('accepted','verified','precise_public_source_session_confirmed','precise_public_source_confirmed','cross_verified_latest_close','public_egx_database_exact_symbol_validated') or not isinstance(r.get('close'),(int,float)) or r['close']<=0 for r in (a,b)):continue
            returns[t]=100*(b['close']/a['close']-1)
        if set(returns)!=names:pending+=1;continue
        avg=lambda xs:sum(returns[t] for t in xs)/len(xs)
        q,v=avg(snap['quant']),avg(snap['baseline'])
        pairs.append({'session':session,'nextSession':end,'quantPct':q,'v169Pct':v,'excessPct':q-v})
    return {'pairedSessions':len(pairs),'pendingSnapshots':pending,'pairs':pairs,
        'meanQuantPct':sum(r['quantPct'] for r in pairs)/len(pairs) if pairs else None,
        'meanV169Pct':sum(r['v169Pct'] for r in pairs)/len(pairs) if pairs else None,
        'meanExcessPct':sum(r['excessPct'] for r in pairs)/len(pairs) if pairs else None}

def main():
    data=ROOT/'quant/data';sp=data/'v16-snapshots.json';out=data/'v16-comparison.json'
    snapshots=json.loads(sp.read_text()) if sp.exists() else {}
    sig=json.loads((data/'signals.json').read_text());source={};error=None
    try:
        req=urllib.request.Request(SOURCE,headers={'User-Agent':'ASTRA-V5-research'})
        source=json.load(urllib.request.urlopen(req,timeout=30))
        status=capture(source,sig,snapshots,dt.datetime.now(dt.timezone.utc))
    except Exception as ex: status='WAITING_DATA';error=str(ex)[:160]
    history={p.stem:json.loads(p.read_text()).get('sessions',[]) for p in (data/'history').glob('*.json')}
    result=dict(status=status,executionAllowed=False,source=SOURCE,baselineId=ID,sourceSession=source.get('sessionDate'),quantSession=sig.get('session'),
        method='Prospective equal-weight close-to-next-close selection comparison; gross, no costs, not a tradable portfolio or plan return.',error=error,**compare(snapshots,history))
    for p,v in ((sp,snapshots),(out,result)):
        text=json.dumps(v,ensure_ascii=False,indent=2)+'\n'
        if not p.exists() or p.read_text()!=text:p.write_text(text)
    print(json.dumps(result,ensure_ascii=False))
if __name__=='__main__':main()
