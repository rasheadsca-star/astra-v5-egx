'use strict';

const fs=require('fs');
const assert=require('assert');
const {
  n,mean,std,ema,rsi,atr,linreg,pivots,clusterLevels,assess
}=require('./lib/technical-indicators');

assert.strictEqual(n(null),null);
assert.strictEqual(n(''),null);
assert.strictEqual(n('12.5'),12.5);
assert.strictEqual(mean([1,2,3]),2);
assert.ok(Math.abs(std([1,2,3])-1)<1e-12);
assert.deepStrictEqual(ema([10,10,10],2),[10,10,10]);
assert.strictEqual(rsi(Array.from({length:20},(_,i)=>i+1),14),100);

const rows=Array.from({length:30},(_,i)=>({
  date:'D'+i,open:100+i,high:102+i,low:98+i,close:100+i
}));
assert.ok(atr(rows,14)>0);
const lr=linreg(rows.slice(-20).map(x=>x.close));
assert.ok(lr&&lr.slope>0);
const pts=pivots([
  {date:'1',high:10,low:8},{date:'2',high:11,low:7},{date:'3',high:13,low:6},
  {date:'4',high:11,low:7},{date:'5',high:10,low:8}
]);
assert.ok(pts.some(x=>x.type==='R'&&x.price===13));
assert.ok(pts.some(x=>x.type==='S'&&x.price===6));
const levels=clusterLevels([{price:99},{price:100},{price:101},{price:110}],105);
assert.ok(levels.supports.length>=1);
const a=assess({close:110,sma20:100,sma50:95,rsi14:60,channelSlopePct:0.2});
assert.strictEqual(a.outlook,'BULLISH_BIAS');
assert.ok(a.score>=68);

for(const p of ['scripts/build-technical-analysis.js','app/api/stock-analysis.js']){
  const src=fs.readFileSync(p,'utf8');
  for(const name of ['mean','std','ema','rsi','atr','linreg']){
    assert.ok(!new RegExp('function\\s+'+name+'\\s*\\(').test(src),p+' still duplicates '+name);
  }
  assert.match(src,/technical-indicators/);
}
console.log(JSON.stringify({ok:true,sharedModule:'scripts/lib/technical-indicators.js',assessment:a},null,2));
