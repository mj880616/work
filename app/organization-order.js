(()=>{
'use strict';
if(window.KPTUOrganizationOrder)return;
// TASK-조직순서: the one order for every screen that lists, picks or checks organizations.
// Organizations are matched by their exact name, as the task editor already did (TASK-화면정리-보완): app_suborganizations
// has no sort column and no stable key other than the row id, and row ids differ between production and test data.
// A renamed or unknown organization is not lost; it goes to the tail, which is sorted 가나다순.
const GROUPS=Object.freeze([
  ['전국철도노동조합'],
  ['서울교통공사노동조합','부산지하철노동조합','대구교통공사노동조합','인천교통공사노동조합'],
  ['서해선지부','신분당선지부','지티엑스에이운영지부','공항철도지부'],
  ['메트로9호선노동조합','서울교통공사9호선지부'],
  ['김포도시철도지부','용인경전철지부']
].map(names=>Object.freeze(names)));
// Old spaces that are not offered for picking. Only pickers leave them out; their rows are not touched.
const PICKER_EXCLUDED=Object.freeze(['궤도협의회']);
// The home update input (not built yet) puts the organizations recorded most recently on top.
const RECENT_LIMIT=3;
const place=new Map();
GROUPS.forEach((names,group)=>names.forEach((name,index)=>place.set(name,{group,index})));
const excluded=new Set(PICKER_EXCLUDED);
const nameOf=o=>String(o?.name??'');
const groupOf=o=>place.get(nameOf(o))?.group??GROUPS.length;
function compare(a,b){
  const pa=place.get(nameOf(a)),pb=place.get(nameOf(b));
  if(pa&&pb)return pa.group-pb.group||pa.index-pb.index;
  if(pa||pb)return pa?-1:1;
  return nameOf(a).localeCompare(nameOf(b),'ko')
}
const sort=list=>[...(list||[])].sort(compare);
// Sorted organizations split where a group ends; organizations outside the 13 form the last group. Screens draw a thin line between groups.
function groups(list){
  const out=[];let last=null;
  for(const o of sort(list)){const g=groupOf(o);if(g!==last){out.push([]);last=g}out[out.length-1].push(o)}
  return out
}
// Picker choices. An organization already chosen (keep) stays, so saving a picker never drops an existing link.
function forPicker(list,keep=[]){
  const kept=new Set(keep||[]);
  return (list||[]).filter(o=>!excluded.has(nameOf(o))||kept.has(o?.id))
}
const unlisted=list=>(list||[]).filter(o=>!place.has(nameOf(o))).length;
// recentIds is newest first. Unknown ids and repeats are skipped. The full groups still hold the recent ones, so the list below keeps its order.
function withRecent(list,recentIds=[],limit=RECENT_LIMIT){
  const byId=new Map((list||[]).map(o=>[o?.id,o])),recent=[];
  for(const id of recentIds||[]){
    if(recent.length>=limit)break;
    const o=byId.get(id);
    if(o&&!recent.includes(o))recent.push(o)
  }
  return {recent,groups:groups(list)}
}
window.KPTUOrganizationOrder=Object.freeze({GROUPS,PICKER_EXCLUDED,RECENT_LIMIT,compare,sort,groups,forPicker,unlisted,withRecent});
})();
