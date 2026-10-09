'use strict';

function riskStatePolicy(m){
  if(!m)return {allowed:false,factor:0,reason:'MONITORING_STATE_MISSING'};
  if(m.gatePass!==true)return {allowed:false,factor:0,reason:'DECISION_GATE_BLOCKED'};
  switch(m.state){
    case 'IN_ENTRY_ZONE': return {allowed:true,factor:1,reason:'IN_ENTRY_ZONE_GATE_PASSED'};
    case 'STOP_HIT': return {allowed:false,factor:0,reason:'STOP_HIT'};
    case 'NEAR_STOP': return {allowed:false,factor:0,reason:'NEAR_STOP_CRITICAL'};
    case 'CHASE_RISK': return {allowed:false,factor:0,reason:'CHASE_RISK'};
    case 'GATE_BLOCKED': return {allowed:false,factor:0,reason:'DECISION_GATE_BLOCKED'};
    case 'ABOVE_ENTRY_ZONE': return {allowed:false,factor:0,reason:'ABOVE_ENTRY_ZONE_DO_NOT_CHASE'};
    case 'SLIGHTLY_ABOVE_ENTRY': return {allowed:false,factor:0,reason:'SLIGHTLY_ABOVE_ENTRY_WAIT'};
    case 'BELOW_ENTRY_ZONE': return {allowed:false,factor:0,reason:'BELOW_ENTRY_ZONE_WAIT'};
    case 'T1_HIT': return {allowed:false,factor:0,reason:'T1_ALREADY_HIT_NO_NEW_ENTRY'};
    case 'T2_HIT': return {allowed:false,factor:0,reason:'T2_ALREADY_HIT_NO_NEW_ENTRY'};
    case 'NO_CURRENT_PRICE': return {allowed:false,factor:0,reason:'CURRENT_PRICE_MISSING'};
    default: return {allowed:false,factor:0,reason:'STATE_NOT_ENTRY_ACTIONABLE'};
  }
}
module.exports={riskStatePolicy};
