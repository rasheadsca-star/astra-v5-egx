// EGX connector pipeline validation without a test-framework dependency.
'use strict';
const fs=require('fs'),path=require('path');

(async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../data-engine/market-snapshot.js'),'utf8');
  const mod=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const {validateSnapshot}=mod;
  const sample={timestamp:new Date().toISOString(),quotes:[{symbol:'COMI',price:70,volume:10000}]};
  const fresh=validateSnapshot(sample);
  if(fresh.status!=='FRESH')throw new Error('Expected FRESH snapshot');
  const missingTime=validateSnapshot({quotes:[]});
  if(missingTime.status!=='INVALID')throw new Error('Expected missing timestamp to be INVALID');
  const stale=validateSnapshot({timestamp:new Date(Date.now()-10*60*1000).toISOString(),quotes:[]});
  if(stale.status!=='STALE')throw new Error('Expected old snapshot to be STALE');
  console.log('EGX connector pipeline validation passed');
})().catch(e=>{console.error(e);process.exit(1)});
