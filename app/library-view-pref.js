// LIB-보기기억 (2026-10-23 사용자 요청 11:47): 자료실에서 마지막으로 고른 묶기·종류 칩을 서버에 기억해 PC와 폰이 같게 열린다.
// 저장 위치: 내 프로필 행의 library_view 칸(app_profiles, migration 20261023150000). 분류 목록(document_categories)·자주 가는 링크(quick_links)와
// 같은 방식이며 기존 owner RLS로 내 행만 읽고 쓴다. 새 표·새 함수·권한 변경 없음. 브라우저 기기 저장소는 쓰지 않는다.
// 값 모양: {"group_by":"project"|"organization"|"category"|"month"|"folder","categories_off":["회의",…],"recent_folders":[폴더 id,…]} — 세 칸 모두 선택.
//   recent_folders = [폴더로 옮기기] 목록 맨 위에 보일 '최근 넣은 폴더'(LIB-폴더로옮기기, migration 20261027173000). 폴더 id 글자 최대 5개, 맨 앞이 가장 최근.
//   칸이 비어 있으면(null) 아직 고른 적 없음 → 화면의 기본(묶기 프로젝트, 종류는 [회의]만 꺼짐).
//   꺼 둔 종류를 이름으로 기억하므로 새로 만든 분류는 켜진 채로 보인다. 검색어·담당조직·프로젝트 거르기·펼침은 기억하지 않는다(그때그때 값).
// 'folder'는 LIB-폴더묶기기억(migration 20261026180000)부터 받는다. 그 전 서버는 400이라 'pending'이고 화면이 폴더만 빼고 다시 보낸다.
// recent_folders도 같다: 20261027173000 적용 전 서버는 400('pending')이라 화면이 그 칸만 빼고 다시 보내고, 최근 폴더는 이번 방문 동안만 기억한다.
// group_order(LIB-폴더보기 칩 순서, migration 20261028140000)도 같다: 묶기 칩 순서(묶기 다섯 값, 중복 없이 최대 5개, 맨 앞이 칩 줄 맨 앞).
//   적용 전 서버는 400('pending')이라 화면이 그 칸만 빼고 다시 보내고, 칩 순서는 이번 방문 동안만 기억한다. 빠진 값은 기본 순서(DEFAULT_GROUP_ORDER)로 뒤에 붙인다.
// 칸이 아직 없는 서버(적용 전)에서는 읽기·쓰기가 400이라 화면은 기본값으로 그대로 동작하고 기억만 하지 않는다.
export const VIEW_GROUPS=Object.freeze(['project','organization','category','month','folder']);
// 묶기 칩 처음 순서: [폴더] 맨 앞(2026-10-28 08:25 요청 ②), 나머지는 원래 차례.
export const DEFAULT_GROUP_ORDER=Object.freeze(['folder','project','organization','category','month']);
const cleanOrder=list=>Array.isArray(list)&&list.length<=VIEW_GROUPS.length&&list.every(v=>VIEW_GROUPS.includes(v))&&new Set(list).size===list.length;
// 기억한 순서(일부여도 됨) → 다섯 값 모두 든 칩 순서. 틀린 값이면 기본 순서.
export function orderedGroups(order){const head=cleanOrder(order)?order:[];return [...head,...DEFAULT_GROUP_ORDER.filter(v=>!head.includes(v))]}
// 칩 하나를 index 자리(그 칩을 뺀 목록 기준)로 옮긴 새 순서.
export function moveGroup(order,id,index){const list=orderedGroups(order).filter(v=>v!==id);if(!VIEW_GROUPS.includes(id))return orderedGroups(order);const at=Math.max(0,Math.min(list.length,Number.isInteger(index)?index:list.length));list.splice(at,0,id);return list}
export const VIEW_NAME_MAX=40,VIEW_OFF_MAX=60,VIEW_RECENT_MAX=5;
const FOLDER_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const cleanFolderId=v=>typeof v==='string'&&FOLDER_ID.test(v);

const cleanName=v=>typeof v==='string'&&v===v.trim()&&v!==''&&[...v].length<=VIEW_NAME_MAX&&!/\p{Cc}/u.test(v);
// 저장된 값 → 화면용 {groupBy?, categoriesOff?, recentFolders?}. 비어 있으면 {}, 모양이 틀리면 null(아무것도 믿지 않음).
export function parseView(value){
  if(value===null||value===undefined)return {};
  if(typeof value!=='object'||Array.isArray(value))return null;
  if(Object.keys(value).some(k=>k!=='group_by'&&k!=='categories_off'&&k!=='recent_folders'&&k!=='group_order'))return null;
  const out={};
  if('group_by' in value){if(!VIEW_GROUPS.includes(value.group_by))return null;out.groupBy=value.group_by}
  if('categories_off' in value){
    const list=value.categories_off;
    if(!Array.isArray(list)||list.length>VIEW_OFF_MAX||!list.every(cleanName)||new Set(list).size!==list.length)return null;
    out.categoriesOff=[...list];
  }
  if('recent_folders' in value){
    const list=value.recent_folders;
    if(!Array.isArray(list)||list.length>VIEW_RECENT_MAX||!list.every(cleanFolderId)||new Set(list).size!==list.length)return null;
    out.recentFolders=[...list];
  }
  if('group_order' in value){if(!cleanOrder(value.group_order))return null;out.groupOrder=[...value.group_order]}
  return out;
}
// 화면 값 → 저장할 값(정해진 칸만). 틀린 값은 null.
export function serializeView({groupBy,categoriesOff,recentFolders,groupOrder}={}){
  const out={};
  if(groupBy!==undefined){if(!VIEW_GROUPS.includes(groupBy))return null;out.group_by=groupBy}
  if(categoriesOff!==undefined){const list=[...new Set(categoriesOff)];if(list.length>VIEW_OFF_MAX||!list.every(cleanName))return null;out.categories_off=list}
  if(recentFolders!==undefined){const list=[...new Set(recentFolders)];if(list.length>VIEW_RECENT_MAX||!list.every(cleanFolderId))return null;out.recent_folders=list}
  if(groupOrder!==undefined){if(!cleanOrder(groupOrder))return null;out.group_order=[...groupOrder]}
  return parseView(out)?out:null;
}
// [전체] 칩 상태: 모두 켜짐 'all' · 모두 꺼짐 'none' · 일부 'some'. 목록이 비어 있으면 'all'.
export function allState(names,off){const on=names.filter(n=>!off.has(n)).length;return on===names.length?'all':on===0?'none':'some'}
// [전체]를 누른 뒤의 꺼진 종류: 모두 켜졌으면 모두 끄고, 아니면(일부·없음) 모두 켠다.
export function afterAllTap(names,off){return allState(names,off)==='all'?new Set(names):new Set()}

const profileUrl=rt=>{const user=rt?.context?.read?.()?.user?.id;return user?`/rest/v1/app_profiles?user_id=eq.${encodeURIComponent(user)}`:''};
// {status:'ok', view} | {status:'pending'} (칸이 아직 없음) | {status:'error'}. 어느 쪽이든 화면은 기본값으로 동작한다.
export async function readView(rt=globalThis.window?.KPTURuntime){
  const url=profileUrl(rt);if(!url)return {status:'error'};
  try{
    const rows=await rt.api(`${url}&select=library_view&limit=1`);
    if(!Array.isArray(rows)||rows.length!==1)return {status:'error'};
    const view=parseView(rows[0]?.library_view);
    return view?{status:'ok',view}:{status:'error'};
  }catch(error){return {status:error?.status===400?'pending':'error'}}
}
export async function saveView(view,rt=globalThis.window?.KPTURuntime){
  const url=profileUrl(rt),body=serializeView(view);
  if(!url||!body)return {status:'error'};
  try{
    const saved=await rt.api(url,{method:'PATCH',prefer:'return=representation',body:{library_view:body}});
    return Array.isArray(saved)&&saved.length===1?{status:'ok'}:{status:'error'};
  }catch(error){return {status:error?.status===400?'pending':'error'}}
}
