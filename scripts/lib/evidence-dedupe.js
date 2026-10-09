'use strict';

function stableEvidenceKey(r){
  return [r?.session||'',r?.ticker||''].join('|');
}
function dedupeEvidenceRecords(records){
  const groups=new Map();
  for(const r of records||[]){
    const k=stableEvidenceKey(r);
    if(!groups.has(k))groups.set(k,[]);
    groups.get(k).push(r);
  }
  const primary=[],duplicates=[];
  for(const [key,rows] of groups){
    rows.sort((a,b)=>String(a.capturedAt||'').localeCompare(String(b.capturedAt||''))||String(a.id||'').localeCompare(String(b.id||'')));
    primary.push(rows[0]);
    for(const d of rows.slice(1))duplicates.push({key,record:d,primary:rows[0]});
  }
  return {primary,duplicates};
}
module.exports={stableEvidenceKey,dedupeEvidenceRecords};
