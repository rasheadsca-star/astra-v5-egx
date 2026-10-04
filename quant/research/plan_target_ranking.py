#!/usr/bin/env python3
"""Paired research: existing far-target rank versus two-target plan rank."""
import sys,json
from pathlib import Path
import numpy as np,pandas as pd
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'quant/engine'))
import egx_engine as e
OUT=ROOT/'quant/research/results/plan-target';OUT.mkdir(parents=True,exist_ok=True)

def plan_predict(tr,te,shuffle_seed=None):
    # Each half-position contributes one target objective. T2 labels come from run_plan,
    # so reaching T2 requires surviving the break-even rule after T1.
    scores=[]
    for label in ('p_hit1','p_hit2'):
        train=tr.assign(y=tr[label]).dropna(subset=['y'])
        if train.y.nunique()<2: scores.append(np.full(len(te),train.y.mean()))
        else: scores.append(e.fit_predict(train,te,shuffle_seed))
    return e.PLAN['frac']*scores[0]+(1-e.PLAN['frac'])*scores[1]

def paired_walk(P,mode,seed=None):
    dates=np.sort(P.loc[P.elig & P.end.notna(),'date'].unique());out=[];clean=[]
    for fold,k in enumerate(range(45,len(dates),5)):
        start=dates[k];stop=dates[k+5] if k+5<len(dates) else np.datetime64('2100-01-01')
        # Common training eligibility and conservative label-end for BOTH models.
        tr=P[P.elig & P.filled & P.y.notna() & P.p_hit1.notna() & P.p_hit2.notna() & (P.known_end<start)]
        te=P[P.elig & P.end.notna() & (P.date>=start) & (P.date<stop)].copy()
        if len(tr)<1500 or te.empty:continue
        assert tr.known_end.max()<start
        clean.append(True)
        shuffle=None if seed is None else fold+1000*seed
        te['p']=(plan_predict if mode=='plan' else e.fit_predict)(tr,te,shuffle)
        te['fold']=fold;out.append(te)
    if not out:raise RuntimeError('Insufficient paired data')
    result=pd.concat(out).sort_values(['date','ticker']);result['rk']=result.groupby('date').p.rank(ascending=False,method='first')
    return result,clean

def evaluate(d):
    top=d[d.rk<=5]
    daily=pd.concat([top.groupby('date').p_ret.mean(),d.groupby('date').p_ret.mean()],axis=1,keys=['top','base']).dropna()
    excess=(daily.top-daily.base).values
    rng=np.random.RandomState(1);block=10;n=max(len(excess)//block,1)
    bs=[np.concatenate([excess[i:i+block] for i in rng.randint(0,max(len(excess)-block+1,1),n)]).mean()*100 for _ in range(2000)]
    return {'plan_top5':e.stats(top.assign(ret=top.p_ret,y=top.p_hit1)), 'plan_baseline':e.stats(d.assign(ret=d.p_ret,y=d.p_hit1)),
        't1_hit_pct':float(top.p_hit1.mean()*100),'t2_hit_pct':float(top.p_hit2.mean()*100),
        'daily_plan_excess_pct':float(excess.mean()*100),'ci90':np.percentile(bs,[5,95]).tolist()}

def main():
    paths=[str(ROOT/'quant/data'/x) for x in ('prices','history','manual')]
    prices,_=e.load_prices(paths,json.loads((ROOT/'quant/config/blocklist.json').read_text()))
    panel=e.build_panel(prices);panel['known_end']=panel[['end','p_end']].max(axis=1)
    report={'executionAllowed':False,'production_model_changed':False,'data_hash':e.data_fingerprint(prices),'sessions':int(panel.date.nunique()),'purge':'max(far_end, plan_end) < test_start','objective':'0.5 P(T1 1ATR) + 0.5 P(T2 after T1 and break-even)', 'versions':{'numpy':np.__version__,'pandas':pd.__version__,'sklearn':e.sklearn.__version__}}
    keys=None
    for mode in ('far','plan'):
        d,clean=paired_walk(panel,mode)
        now=list(zip(d.date.astype(str),d.ticker))
        if keys is not None:assert now==keys,'Different evaluation signals'
        keys=now;summary=evaluate(d);summary.update(folds=len(clean),all_clean=all(clean),signals=len(d))
        summary['placebo_daily_excess_pct']=[]
        for seed in range(5):
            placebo,_=paired_walk(panel,mode,seed)
            summary['placebo_daily_excess_pct'].append(evaluate(placebo)['daily_plan_excess_pct'])
        report[mode]=summary
        d[['date','ticker','p','rk','p_ret','p_hit1','p_hit2','fold','known_end']].to_csv(OUT/(mode+'.csv'),index=False)
        print(mode,json.dumps(summary),flush=True)
    report['same_signals']=True
    a=pd.read_csv(OUT/'far.csv');b=pd.read_csv(OUT/'plan.csv')
    pair=pd.concat([a[a.rk<=5].groupby('date').p_ret.mean(),b[b.rk<=5].groupby('date').p_ret.mean()],axis=1,keys=['far','plan']).dropna()
    delta=(pair.plan-pair.far).values; rng=np.random.RandomState(7)
    bs=[np.concatenate([delta[i:i+10] for i in rng.randint(0,max(len(delta)-9,1),max(len(delta)//10,1))]).mean()*100 for _ in range(2000)]
    report['paired_plan_minus_far_pct']=float(delta.mean()*100);report['paired_ci90']=np.percentile(bs,[5,95]).tolist()
    report['live_profitability_proven']=False
    (OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
