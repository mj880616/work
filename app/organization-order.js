(()=>{
'use strict';
if(window.KPTUOrganizationOrder)return;
// TASK-조직순서: the one order for every screen that lists, picks or checks organizations.
// Organizations are matched by their exact name, as the task editor already did (TASK-화면정리-보완): app_suborganizations
// has no sort column and no stable key other than the row id, and row ids differ between production and test data.
// A renamed or unknown organization is not lost; it goes to the tail, which is sorted 가나다순.
// MULTI-노조사용자 ②-3(D5): 묶음·순서·고르기에서 뺄 조직은 사람마다 다르다. 이 파일에는 이름을 두지 않고 내 프로필 화면 기억
// (app_profiles.view_prefs.org_order = {groups:[{name, orgs:[조직 이름…]}…], hidden:[조직 이름…]}, view-prefs.js)을 그때그때 읽는다.
// 값이 없으면(새 사람·읽기 전) 묶음 없이 모두 '그 외' 한 묶음 = 가나다순이고 빼는 조직도 없다. 화면 기억은 앱을 열 때 화면보다 먼저 읽힌다(loader-v2.js).
const TAIL='그 외';
// The home update input (not built yet) puts the organizations recorded most recently on top.
const RECENT_LIMIT=3;
const EMPTY=Object.freeze({groups:Object.freeze([]),names:Object.freeze([TAIL]),hidden:Object.freeze([]),place:new Map(),excluded:new Set()});
let lastRaw,lastSetting=EMPTY;
// 지금 설정(같은 값이면 앞서 만든 표를 그대로 쓴다). 모양이 틀린 칸은 view-prefs.js가 이미 버린다.
function setting(){
  let raw;
  try{raw=window.KPTUViewPrefs?.get?.('org_order')}catch{raw=undefined}
  if(raw===lastRaw)return lastSetting;
  lastRaw=raw;
  if(!raw||!Array.isArray(raw.groups)){lastSetting=EMPTY;return lastSetting}
  const groups=raw.groups.map(g=>Object.freeze([...(g?.orgs||[])].map(String))),place=new Map();
  groups.forEach((names,group)=>names.forEach((name,index)=>{if(!place.has(name))place.set(name,{group,index})}));
  const hidden=Object.freeze((raw.hidden||[]).map(String));
  lastSetting={groups:Object.freeze(groups),names:Object.freeze([...raw.groups.map(g=>String(g?.name||'')),TAIL]),hidden,place,excluded:new Set(hidden)};
  return lastSetting
}
const nameOf=o=>String(o?.name??'');
const groupOf=o=>{const s=setting();return s.place.get(nameOf(o))?.group??s.groups.length};
const groupName=o=>setting().names[groupOf(o)];
function compare(a,b){
  const place=setting().place,pa=place.get(nameOf(a)),pb=place.get(nameOf(b));
  if(pa&&pb)return pa.group-pb.group||pa.index-pb.index;
  if(pa||pb)return pa?-1:1;
  return nameOf(a).localeCompare(nameOf(b),'ko')
}
const sort=list=>[...(list||[])].sort(compare);
// Sorted organizations split where a group ends; organizations outside the set groups form the last group. Screens draw a thin line between groups.
function groups(list){
  const out=[];let last=null;
  for(const o of sort(list)){const g=groupOf(o);if(g!==last){out.push([]);last=g}out[out.length-1].push(o)}
  return out
}
// Picker choices. An organization already chosen (keep) stays, so saving a picker never drops an existing link.
function forPicker(list,keep=[]){
  const kept=new Set(keep||[]),excluded=setting().excluded;
  return (list||[]).filter(o=>!excluded.has(nameOf(o))||kept.has(o?.id))
}
const unlisted=list=>{const place=setting().place;return (list||[]).filter(o=>!place.has(nameOf(o))).length};
// 묶음을 하나라도 정했는가(정하지 않았으면 화면은 묶음 이름 없이 가나다순 한 목록으로 그린다).
const hasGroups=()=>setting().groups.length>0;
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
const api={RECENT_LIMIT,TAIL,groupName,compare,sort,groups,forPicker,unlisted,withRecent,hasGroups};
// GROUPS(묶음마다 조직 이름)·GROUP_NAMES(묶음 이름 + 맨 끝 '그 외')·PICKER_EXCLUDED는 지금 설정을 읽는 값이다.
Object.defineProperties(api,{
  GROUPS:{get:()=>setting().groups,enumerable:true},
  GROUP_NAMES:{get:()=>setting().names,enumerable:true},
  PICKER_EXCLUDED:{get:()=>setting().hidden,enumerable:true}
});
window.KPTUOrganizationOrder=Object.freeze(api);
})();
