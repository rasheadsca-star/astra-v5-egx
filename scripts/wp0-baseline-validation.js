'use strict';

const fs=require('fs');
const assert=require('assert');

function read(p){return JSON.parse(fs.readFileSync(p,'utf8'))}

const baseline=read('docs/baseline-metrics.json');
const q=read('quant/data/signals.json');
const cockpit=read('data/decision-cockpit.json');

assert.strictEqual(baseline.source.session,q.session,'baseline session drift');
assert.strictEqual(baseline.safety.researchOnly,true);
assert.strictEqual(baseline.safety.executionAllowed,false);
assert.strictEqual(baseline.safety.automaticOrders,false);
assert.strictEqual(cockpit.safety?.researchOnly,true);
assert.strictEqual(cockpit.safety?.executionAllowed,false);
assert.strictEqual(cockpit.safety?.automaticOrders,false);

function eq(path,a,b){
  assert.deepStrictEqual(a,b, path+' changed from frozen WP0 baseline');
}

eq('baselineAll',baseline.oos.baselineAll,{
  n:q.backtest.baseline_all.n,
  days:q.backtest.baseline_all.days,
  hitPct:q.backtest.baseline_all.hit,
  winPct:q.backtest.baseline_all.win,
  avgNetReturnPct:q.backtest.baseline_all.avg,
  medianNetReturnPct:q.backtest.baseline_all.med,
  profitFactor:q.backtest.baseline_all.pf
});
for(const k of ['top3','top5','top10']){
  const src=q.backtest[k], dst=baseline.oos[k];
  eq(k,dst,{
    n:src.n,days:src.days,hitPct:src.hit,winPct:src.win,
    avgNetReturnPct:src.avg,medianNetReturnPct:src.med,profitFactor:src.pf
  });
}
eq('top5 excess',baseline.oos.top5ExcessMeanPct,q.integrity.top5_excess_mean_pct);
eq('top5 CI',baseline.oos.top5ExcessCi90BlockPct,q.integrity.top5_excess_ci90_block);
eq('folds positive',baseline.oos.foldsPositive,q.integrity.folds_positive);
eq('placebo',baseline.placebo.excessPct,q.integrity.placebo.excess_list);
eq('portfolio two targets',baseline.portfolio.twoTargets,{
  totalReturnPct:q.portfolio.strategy.total_return_pct,
  maxDrawdownPct:q.portfolio.strategy.max_drawdown_pct,
  sharpe:q.portfolio.strategy.sharpe,
  trades:q.portfolio.strategy.trades,
  winPct:q.portfolio.strategy.win_pct,
  avgExposurePct:q.portfolio.strategy.avg_exposure_pct,
  days:q.portfolio.strategy.days
});
assert.ok(
  baseline.oos.top5ExcessCi90BlockPct[0] <= 0 &&
  baseline.oos.top5ExcessCi90BlockPct[1] >= 0,
  'baseline interpretation requires CI to include zero'
);
assert.strictEqual(baseline.interpretation.top5OutperformanceEstablished,false);
console.log('WP0 baseline metrics are frozen and internally consistent.');
