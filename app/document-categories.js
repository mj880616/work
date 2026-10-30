// UI-바구니첨부메모: 자료 분류 목록. 기본은 7개(교섭·투쟁·교육·선전·정책·회의·기타 = DB 칸 기본값)이고, 내 목록은 내 프로필의
// document_categories 칸에 저장된다(PR 2b). 이 모듈이 그 목록을 읽어 두는 유일한 곳이며(새 저장소 없음), 화면은 여기서만 목록을 얻는다.
// 저장된 자료의 값은 바꾸지 않고 화면에서만 목록의 이름으로 대응해 보여 준다(B1). 예전 자동분류 12개 이름(library-files)은 아래 표로 대응하고,
// 표에 없는 값은 목록의 이름으로 시작하면 그 분류, 아니면 '기타'로 본다. 자료실·담당조직·프로젝트 [자료] 꼬리표가 모두 이 목록 하나를 쓴다.
// 서버 AI(supabase/functions/ai-assist/library-fill.ts DEFAULT_CATEGORIES·RENAMED_CATEGORIES)도 같은 목록·같은 옛 이름 규칙을 쓴다.
// 추가·이름 바꾸기·삭제는 DB 함수 app_document_category_add/rename/delete만 부른다. 소유자·권한 판정은 함수와 RLS가 한다.
// 2026-10-23 사용자 요청('교섭' → '교섭·합의', '성명·보도자료'·'공문' 추가)은 내 목록(프로필)에서 바꾼다(분류 목록 편집 = 기존 함수).
// 기본값은 DB 칸 기본값과 같게 둔다(목록을 못 읽을 때만 쓰임). 옛 이름·새 이름은 아래 LEGACY로 같은 꼬리표가 된다.
export const DEFAULT_DOCUMENT_CATEGORIES=Object.freeze(['교섭','투쟁','교육','선전','정책','회의','기타']);
export const LOCKED_CATEGORY='기타';
export const CATEGORY_NAME_LIMIT=20;
// 저장된 값 → 보여 줄 분류(앞의 것부터, 지금 목록에 있는 첫 이름). 저장된 자료 값은 다시 쓰지 않는다.
// '교섭'↔'교섭·합의'는 이름만 바뀐 같은 분류(내 목록이 아직 옛 이름이어도, 새 이름이어도 같은 꼬리표).
const LEGACY=Object.freeze({
  교섭:['교섭·합의'],'교섭·합의':['교섭'],
  교섭자료:['교섭·합의','교섭'],
  교육자료:['교육'],
  보도자료:['성명·보도자료','선전'],취재요청:['성명·보도자료','선전'],'성명·논평':['성명·보도자료','선전'],'선전·언론자료':['선전'],
  국회자료:['정책'],정부자료:['정책'],'토론회·발제자료':['정책'],
  회의자료:['회의'],회의결과:['회의'],
  // LIB-소분류: '주간보고 확정본·개인본'은 '주간보고›확정본·개인본'(소분류)으로 합친다(DB 20261031000000). 합치기 전후 같은 꼬리표.
  '주간보고 확정본':['주간보고›확정본'],'주간보고›확정본':['주간보고 확정본'],
  '주간보고 개인본':['주간보고›개인본'],'주간보고›개인본':['주간보고 개인본'],
});
// LIB-소분류: 주간보고 상자가 찾고 저장하는 분류 값. 합치기(DB) 전에는 옛 이름, 뒤에는 새 이름이 자료에 있으므로 두 이름을 모두 찾는다.
export const WEEKLY_CATEGORY_NAMES=Object.freeze({confirmed:Object.freeze(['주간보고 확정본','주간보고›확정본']),personal:Object.freeze(['주간보고 개인본','주간보고›개인본'])});
// PostgREST 조건(category=…): 두 이름 중 하나.
export const weeklyCategoryFilter=kind=>'in.('+encodeURIComponent(WEEKLY_CATEGORY_NAMES[kind].map(name=>`"${name}"`).join(','))+')';
// 저장할 값: 내 목록에 새 이름이 있으면 새 이름, 아니면 옛 이름(지금 목록의 꼬리표와 맞게).
export const weeklySaveCategory=kind=>{const [old,next]=WEEKLY_CATEGORY_NAMES[kind];return current.includes(next)?next:old;};
let current=DEFAULT_DOCUMENT_CATEGORIES,currentOwner='';
let flight=null,loadedOwner='';
const eventTarget=()=>typeof window!=='undefined'?window:null;
const notify=name=>{const target=eventTarget();if(target&&typeof CustomEvent==='function')target.dispatchEvent(new CustomEvent(name));};

// 지금 쓰는 분류 목록(기본 7개이거나 내가 고친 목록). 늘 '기타'가 들어 있다.
export function documentCategories(){return current;}
// 이 로그인에서 서버의 내 목록을 읽어 왔는지(못 읽었으면 편집 화면은 기본 7개를 믿고 고치지 않는다).
export function documentCategoriesLoaded(){return !!loadedOwner;}
function validList(list){
  return Array.isArray(list)&&list.length>=1&&list.length<=30&&list.every(name=>typeof name==='string'&&name.trim()===name&&name!==''&&[...name].length<=CATEGORY_NAME_LIMIT)
    &&new Set(list).size===list.length&&list.includes(LOCKED_CATEGORY);
}
// 서버가 준 목록을 받아 둔다. 모양이 맞지 않으면 무시한다(기존 목록 유지). 바뀌었으면 true.
export function setDocumentCategories(list,owner=currentOwner){
  if(!validList(list))return false;
  const same=list.length===current.length&&list.every((name,index)=>name===current[index]);
  current=Object.freeze([...list]);currentOwner=owner||currentOwner;
  if(!same)notify('kptu:document-categories-changed');
  return !same;
}
export function resetDocumentCategories(){
  const changed=current!==DEFAULT_DOCUMENT_CATEGORIES;
  current=DEFAULT_DOCUMENT_CATEGORIES;currentOwner='';loadedOwner='';flight=null;
  if(changed)notify('kptu:document-categories-changed');
}
const ownerOf=rt=>rt?.context?.read?.()?.user?.id||'';
// 내 분류 목록을 한 번 읽는다(같은 로그인에서는 다시 읽지 않음. force면 다시). 읽지 못하면 기본 7개 그대로 둔다.
export async function loadDocumentCategories({rt=window.KPTURuntime,force=false}={}){
  const owner=ownerOf(rt);
  if(!owner)return current;
  if(!force&&loadedOwner===owner)return current;
  if(flight&&flight.owner===owner)return flight.promise;
  const promise=(async()=>{
    try{
      const rows=await rt.api(`/rest/v1/app_profiles?user_id=eq.${encodeURIComponent(owner)}&select=document_categories&limit=1`);
      if(ownerOf(rt)!==owner)return current;
      const list=Array.isArray(rows)?rows[0]?.document_categories:null;
      if(validList(list)){if(currentOwner&&currentOwner!==owner)resetDocumentCategories();setDocumentCategories(list,owner);loadedOwner=owner;}
      else if(force)loadedOwner='';
    }catch{/* 읽지 못하면 지금 목록을 그대로 쓴다. 자료는 그대로 보이고, 분류 목록 편집만 안내 문구로 막힌다. */
      if(force&&ownerOf(rt)===owner)loadedOwner='';
    }
    return current;
  })().finally(()=>{if(flight?.promise===promise)flight=null;});
  flight={owner,promise};
  return promise;
}
if(typeof window!=='undefined')window.addEventListener('kptu:session-changed',()=>resetDocumentCategories());

export function categoryOf(value){
  const name=String(value??'').trim();
  if(current.includes(name))return name;
  const legacy=(Object.hasOwn(LEGACY,name)?LEGACY[name]:[]).find(category=>current.includes(category));
  if(legacy)return legacy;
  // 직접 적은 값(예: 정책자료)은 목록의 이름으로 시작하면 그 분류로 본다(여러 개면 가장 긴 이름).
  let best='';
  for(const category of current)if(category!==LOCKED_CATEGORY&&name.startsWith(category)&&category.length>best.length)best=category;
  return best||LOCKED_CATEGORY;
}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// <select> 안의 <option> 목록. empty가 있으면 맨 앞에 값 없는 선택지(예: 자동 분류)를 둔다.
export function categoryOptions(selected,{empty=''}={}){
  const value=selected===''&&empty?'':categoryOf(selected);
  return (empty?`<option value=""${value===''?' selected':''}>${esc(empty)}</option>`:'')+current.map(name=>`<option value="${esc(name)}"${name===value?' selected':''}>${esc(name)}</option>`).join('');
}
// 자료 줄의 작은 분류 꼬리표.
export function categoryTag(value){
  const name=categoryOf(value);
  return `<span class="doc-category-tag" data-doc-category="${esc(name)}">${esc(name)}</span>`;
}

// 이 분류로 보이는 자료의 "저장된 예전 값"들(정부자료 등). 이름 바꾸기·삭제 함수가 이 값의 자료도 함께 바꾸도록 넘긴다.
// 지금 목록에 있는 이름은 넘기지 않는다(함수가 거절함). 50개를 넘기면 null(함수 한도).
export function storedValuesOf(name,documents){
  const stored=new Set();
  for(const doc of documents||[]){
    const value=doc?.category;
    if(typeof value!=='string'||value===''||current.includes(value))continue;
    if(categoryOf(value)===name)stored.add(value);
  }
  return stored.size>50?null:[...stored];
}
// 이 분류로 보이는 자료 수(안내 문구용).
export function documentCountOf(name,documents){return (documents||[]).filter(doc=>categoryOf(doc?.category)===name).length;}

// 새 이름을 서버에 보내기 전 쉬운 말로 먼저 걸러 준다(최종 판정은 함수와 표 검사가 한다).
export function categoryNameProblem(raw,{except=''}={}){
  const name=String(raw??'').trim();
  if(!name)return '분류 이름을 적어 주세요.';
  if([...name].length>CATEGORY_NAME_LIMIT)return `분류 이름은 ${CATEGORY_NAME_LIMIT}자까지 쓸 수 있어요.`;
  if(/[,\u0000-\u001f\u007f]/.test(name))return '분류 이름에는 쉼표를 쓸 수 없어요.';
  if(name!==except&&current.includes(name))return '이미 있는 분류 이름이에요.';
  if(current.length>=30&&!except)return '분류는 30개까지 만들 수 있어요.';
  return '';
}
const ERROR_TEXT=Object.freeze({
  PERMISSION_DENIED:'분류 목록을 바꿀 권한을 확인하지 못했어요. 다시 로그인한 뒤 시도해 주세요. 아무것도 바뀌지 않았어요.',
  INVALID_NAME:'분류 이름을 확인해 주세요. 1~20자, 쉼표 없이, 앞뒤 빈칸 없이 적어 주세요. 아무것도 바뀌지 않았어요.',
  CATEGORY_EXISTS:'이미 있는 분류 이름이에요. 아무것도 바뀌지 않았어요.',
  CATEGORY_NOT_FOUND:'그 분류가 목록에 없어요. 목록을 다시 불러왔어요. 아무것도 바뀌지 않았어요.',
  CATEGORY_LOCKED:`‘${LOCKED_CATEGORY}’는 이름을 바꾸거나 지울 수 없어요. 아무것도 바뀌지 않았어요.`,
  INVALID_INPUT:'이 분류에 묶인 예전 이름이 너무 많아 바꾸지 않았어요. 아무것도 바뀌지 않았어요.',
  FUNCTION_UNAVAILABLE:'분류 목록 기능이 아직 준비되지 않았어요. 아무것도 바뀌지 않았어요.',
  UNKNOWN:'저장했는지 확인하지 못했어요. 목록을 다시 불러온 뒤 확인해 주세요.',
  REFUSED:'분류 목록을 바꾸지 못했어요. 아무것도 바뀌지 않았어요.',
});
export const categoryErrorText=code=>ERROR_TEXT[code]||ERROR_TEXT.REFUSED;

// 함수 3개 호출. 결과: {ok:true,categories,documents} · {ok:false,error:코드} · {ok:false,error:'UNKNOWN'}(보냈는지 모름: 다시 보내지 않고 목록을 다시 읽어 확인).
async function call(name,body,rt){
  let data;
  try{
    data=await rt.api('/rest/v1/rpc/'+name,{method:'POST',body,singleFlight:false});
  }catch(error){
    const status=Number(error?.status)||0;
    if(status===404||/PGRST202|Could not find the function/i.test(error?.message||''))return {ok:false,error:'FUNCTION_UNAVAILABLE'};
    if(status===401||status===403)return {ok:false,error:'PERMISSION_DENIED'};
    // 400번대(401·403·404 제외)는 서버가 실행 전에 거절한 것. 그 밖(시간 초과·끊김·5xx)은 결과를 모른다.
    return status>=400&&status<500?{ok:false,error:'REFUSED'}:{ok:false,error:'UNKNOWN'};
  }
  if(data&&typeof data==='object'&&data.ok===true&&validList(data.categories)){
    setDocumentCategories(data.categories);
    return {ok:true,categories:data.categories,documents:Number.isInteger(data.documents)?data.documents:0};
  }
  if(data&&typeof data==='object'&&data.ok===false&&typeof data.error==='string')return {ok:false,error:data.error};
  return {ok:false,error:'UNKNOWN'};
}
const done=result=>{
  if(result.ok&&result.documents>0&&typeof window!=='undefined')window.dispatchEvent(new CustomEvent('kptu:documents-changed'));
  return result;
};
export const addDocumentCategory=(name,{rt=window.KPTURuntime}={})=>call('app_document_category_add',{p_name:name},rt).then(done);
export const renameDocumentCategory=(from,to,stored,{rt=window.KPTURuntime}={})=>call('app_document_category_rename',{p_from:from,p_to:to,p_stored:stored||[]},rt).then(done);
export const deleteDocumentCategory=(name,stored,{rt=window.KPTURuntime}={})=>call('app_document_category_delete',{p_name:name,p_stored:stored||[]},rt).then(done);
