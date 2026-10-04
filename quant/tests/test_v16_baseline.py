import sys,datetime as dt
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'research'))
from v16_baseline import capture,compare,ID
source={'sessionDate':'2026-10-01','engineRegistry':{'primary':{'id':ID}},'current':{'mainAppBasket':['AAA','BBB']}}
sig={'session':'2026-10-01','recommendations':[{'ticker':'AAA'}]};s={}
assert capture(source,{**sig,'session':'2026-09-30'},s,dt.datetime.now(dt.timezone.utc))=='MISALIGNED' and not s
assert capture(source,sig,s,dt.datetime(2026,10,1,17,tzinfo=dt.timezone.utc))=='COLLECTING'
h={t:[{'date':d,'close':c,'validationStatus':'accepted'} for d,c in zip(['2026-10-01','2026-10-04'],cs)] for t,cs in [('AAA',[10,11]),('BBB',[10,9])]}
r=compare(s,h);assert r['pairedSessions']==1 and abs(r['meanV169Pct'])<1e-10 and abs(r['meanExcessPct']-10)<1e-10
assert compare(s,{'AAA':h['AAA']})['pairedSessions']==0
s['2026-10-01']['observedAt']='2026-10-04T12:00:00+00:00'
assert compare(s,h)['pairedSessions']==0
print('PASS V16 comparison: alignment, equal weights, missing bars, prospective timing')
