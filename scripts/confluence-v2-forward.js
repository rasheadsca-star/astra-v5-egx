'use strict';

const fs=require('fs'), path=require('path');
const LEDGER='data/confluence-v2/forward-ledger.json';
const HIST='quant/data/history';
const ROUND_TRIP_COST_PCT=0.60;
const ENTRY_EXPIRY_SESSIONS=3;

function read(p){return JSON.parse(fs.readFileSync(p,'utf8'))}
function write(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n')}
function ret(exitPrice,entryPrice){return ((exitPrice/entryPrice)-1)*100-ROUND_TRIP_COST_PCT}
function profitFactor(records){
  const vals=records.map(x=>Number(x.netReturnPct)).filter(Number.isFinite);
  const gp=vals.filter(x=>x>0).reduce((a,b)=>a+b,0), gl=Math.abs(vals.filter(x=>x<0).reduce((a,b)=>a+b,0));
  return gl>0?+(gp/gl).toFixed(3):gp>0?null:null;
}
if(!fs.existsSync(LEDGER)){console.log('no ledger');process.exit(0)}
const l=read(LEDGER); l.records=Array.isArray(l.records)?l.records:[];
for(const rec of l.records){
  if(['TARGET1','STOP','TIME_EXIT','UNFILLED_EXPIRED'].includes(rec.status))continue;
  const hp=path.join(HIST,rec.ticker+'.json'); if(!fs.existsSync(hp))continue;
  let h; try{h=read(hp)}catch{continue}
  const bars=(h.sessions||[]).filter(x=>x.date>rec.signalSession).map(x=>({date:x.date,open:Number(x.open),high:Number(x.high),low:Number(x.low),close:Number(x.close)})).filter(x=>[x.open,x.high,x.low,x.close].every(Number.isFinite));
  if(!bars.length)continue;

  if(rec.status==='PENDING_ENTRY'){
    const search=bars.slice(0,ENTRY_EXPIRY_SESSIONS);
    let fillIndex=-1;
    for(let i=0;i<search.length;i++){
      const b=search[i];
      const intersects=b.low<=rec.entryHigh&&b.high>=rec.entryLow;
      if(intersects){
        const fill=b.open>=rec.entryLow&&b.open<=rec.entryHigh?b.open:rec.entryHigh;
        rec.status='OPEN';rec.entrySession=b.date;rec.entryPrice=+fill.toFixed(4);fillIndex=i;break;
      }
    }
    if(rec.status==='PENDING_ENTRY'&&bars.length>=ENTRY_EXPIRY_SESSIONS){
      rec.status='UNFILLED_EXPIRED';rec.exitSession=bars[ENTRY_EXPIRY_SESSIONS-1].date;rec.outcome='NO_FILL';rec.netReturnPct=0;continue;
    }
    if(fillIndex<0)continue;
  }

  const startIdx=bars.findIndex(x=>x.date===rec.entrySession);
  if(startIdx<0)continue;
  const evalBars=bars.slice(startIdx,startIdx+Number(rec.maxHoldSessions||10));
  for(let i=0;i<evalBars.length;i++){
    const b=evalBars[i];
    const stop=Number(rec.stop),t1=Number(rec.targets?.t1);
    if(b.open<=stop){
      rec.status='STOP';rec.exitSession=b.date;rec.exitPrice=b.open;rec.outcome='STOP_GAP';rec.netReturnPct=+ret(b.open,rec.entryPrice).toFixed(3);break;
    }
    if(b.open>=t1){
      rec.status='TARGET1';rec.exitSession=b.date;rec.exitPrice=b.open;rec.outcome='TARGET1_GAP';rec.netReturnPct=+ret(b.open,rec.entryPrice).toFixed(3);break;
    }
    const hitStop=b.low<=stop,hitT1=b.high>=t1;
    if(hitStop&&hitT1){
      rec.status='STOP';rec.exitSession=b.date;rec.exitPrice=stop;rec.outcome='STOP_FIRST_SAME_BAR';rec.netReturnPct=+ret(stop,rec.entryPrice).toFixed(3);break;
    }
    if(hitStop){
      rec.status='STOP';rec.exitSession=b.date;rec.exitPrice=stop;rec.outcome='STOP';rec.netReturnPct=+ret(stop,rec.entryPrice).toFixed(3);break;
    }
    if(hitT1){
      rec.status='TARGET1';rec.exitSession=b.date;rec.exitPrice=t1;rec.outcome='TARGET1';rec.netReturnPct=+ret(t1,rec.entryPrice).toFixed(3);break;
    }
    if(i===Number(rec.maxHoldSessions||10)-1){
      rec.status='TIME_EXIT';rec.exitSession=b.date;rec.exitPrice=b.close;rec.outcome='TIME_EXIT';rec.netReturnPct=+ret(b.close,rec.entryPrice).toFixed(3);
    }
  }
}
const resolved=l.records.filter(x=>['TARGET1','STOP','TIME_EXIT'].includes(x.status));
const wins=resolved.filter(x=>Number(x.netReturnPct)>0),losses=resolved.filter(x=>Number(x.netReturnPct)<0);
l.updatedAt=new Date().toISOString();
l.metrics={
  total:l.records.length,
  pending:l.records.filter(x=>x.status==='PENDING_ENTRY').length,
  open:l.records.filter(x=>x.status==='OPEN').length,
  unfilled:l.records.filter(x=>x.status==='UNFILLED_EXPIRED').length,
  resolved:resolved.length,
  wins:wins.length,losses:losses.length,
  hitRatePct:resolved.length?+(wins.length/resolved.length*100).toFixed(1):null,
  avgNetReturnPct:resolved.length?+(resolved.reduce((a,x)=>a+Number(x.netReturnPct||0),0)/resolved.length).toFixed(3):null,
  profitFactor:profitFactor(resolved),
  roundTripCostPct:ROUND_TRIP_COST_PCT
};
write(LEDGER,l);
console.log(JSON.stringify(l.metrics,null,2));
