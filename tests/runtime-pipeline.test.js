// ASTRA runtime pipeline contract test.
'use strict';
const { buildRuntimeRecommendations } = require('../engine/runtime-pipeline');

(async()=>{
  const snapshot={
    quotes:[{symbol:'COMI',price:100,previousClose:98,change:2,volume:50000,timestamp:new Date().toISOString()}],
    source:'TEST'
  };
  const result=await buildRuntimeRecommendations(snapshot);
  if(result.status!=='READY')throw new Error('Pipeline did not reach READY state: '+result.status);
  if(!Array.isArray(result.recommendations))throw new Error('Recommendations contract is not an array');
  if(!Array.isArray(result.watchlist))throw new Error('Watchlist contract is not an array');
  if(result.executionAllowed===true||result.automaticOrders===true)throw new Error('Runtime test observed automatic execution enabled');
  console.log('ASTRA runtime pipeline test passed');
})().catch(e=>{console.error(e);process.exit(1)});
