// LIB-보기기억 (2026-10-23 사용자 요청 11:47): 자료실에서 마지막으로 고른 묶기·종류 칩을 서버에 기억해 PC와 폰이 같게 열린다.
// 저장 위치: 내 프로필 행의 library_view 칸(app_profiles, migration 20261023150000). 분류 목록(document_categories)·자주 가는 링크(quick_links)와
// 같은 방식이며 기존 owner RLS로 내 행만 읽고 쓴다. 새 표·새 함수·권한 변경 없음. 브라우저 기기 저장소는 쓰지 않는다.
// 값 모양: {"group_by":"project"|"organization"|"category"|"month","categories_off":["회의",…]} — 두 칸 모두 선택.
//   칸이 비어 있으면(null) 아직 고른 적 없음 → 화면의 기본(묶기 프로젝트, 종류는 [회의]만 꺼짐).
//   꺼 둔 종류를 이름으로 기억하므로 새로 만든 분류는 켜진 채로 보인다. 검색어·담당조직·프로젝트 거르기·펼침은 기억하지 않는다(그때그때 값).
// 칸이 아직 없는 서버(적용 전)에서는 읽기·쓰기가 400이라 화면은 기본값으로 그대로 동작하고 기억만 하지 않는다.
export const VIEW_GROUPS=Object.freeze(['project','organization','category','month']);
export const VIEW_NAME_MAX=40,VIEW_OFF_MAX=60;

const cleanName=v=>typeof v==='string'&&v===v.trim()&&v!==''&&[...v].length<=VIEW_NAME_MAX&&!/\p{Cc}/u.test(v);
// 저장된 값 → 화면용 {groupBy?, categoriesOff?}. 비어 있으면 {}, 모양이 틀리면 null(아무것도 믿지 않음).
export function parseView(value){
  if(value===null||value===undefined)return {};
  if(typeof value!=='object'||Array.isArray(value))return null;
  if(Object.keys(value).some(k=>k!=='group_by'&&k!=='categories_off'))return null;
  const out={};
  if('group_by' in value){if(!VIEW_GROUPS.includes(value.group_by))return null;out.groupBy=value.group_by}
  if('categories_off' in value){
    const list=value.categories_off;
    if(!Array.isArray(list)||list.length>VIEW_OFF_MAX||!list.every(cleanName)||new Set(list).size!==list.length)return null;
    out.categoriesOff=[...list];
  }
  return out;
}
// 화면 값 → 저장할 값(정해진 칸만). 틀린 값은 null.
export function serializeView({groupBy,categoriesOff}={}){
  const out={};
  if(groupBy!==undefined){if(!VIEW_GROUPS.includes(groupBy))return null;out.group_by=groupBy}
  if(categoriesOff!==undefined){const list=[...new Set(categoriesOff)];if(list.length>VIEW_OFF_MAX||!list.every(cleanName))return null;out.categories_off=list}
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
