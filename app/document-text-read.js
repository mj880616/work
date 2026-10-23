// SEARCH-전체검색 ② (docs/design/global-search.md 8절): 자료 파일 안 글자를 서버가 한 번 읽어 두게 하는 화면 쪽 요청.
// 글자 읽기 자체는 서버 한 곳(document-actions `document-text` → _shared/document-text.ts)이 한다. AI 호출 없음.
// 서버가 자료 행·소유자·Drive 파일을 DB에서 확인하고, 이미 읽은 자료(ready)는 다시 읽지 않는다. 응답에 글자는 없다(상태만).
// 자료실 올리기·바구니 보내기는 LIB-AI자동분류(library-ai-fill.js)가 이미 같은 요청을 보낸다. 여기는 그 밖의 등록 경로
// (회의자료 올리기·HWP 편집기의 새 파일 저장·주간보고 확정 저장)가 쓴다. 어떤 실패도 올리기 결과를 바꾸지 않고, 다시 보내지 않는다.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DOCUMENT_TEXT_PATH='/functions/v1/document-actions';
// PDF·HWP는 Drive 변환을 거쳐 몇 초~수십 초 걸릴 수 있다. 화면은 기다리지 않는다.
export const DOCUMENT_TEXT_TIMEOUT_MS=60000;

// 한 자료의 글자 읽기를 서버에 맡긴다. 결과 {ok:true,status} 또는 {ok:false}. 던지지 않는다.
export async function requestDocumentText(id,{rt=globalThis.window?.KPTURuntime}={}){
  if(typeof id!=='string'||!UUID.test(id)||!rt?.api)return {ok:false};
  try{
    const data=await rt.api(DOCUMENT_TEXT_PATH,{method:'POST',body:{action:'document-text',document_id:id},refreshSession:false,singleFlight:false,timeoutMs:DOCUMENT_TEXT_TIMEOUT_MS});
    return data?.ok===true&&['ready','error'].includes(data.status)?{ok:true,status:data.status}:{ok:false};
  }catch{return {ok:false}}
}
// 올리기 응답의 자료 ID로 뒤에서 읽기를 시작한다(기다리지 않음).
export function readTextLater(document,options){
  const id=document&&typeof document==='object'?document.id:null;
  if(typeof id==='string'&&UUID.test(id))void requestDocumentText(id,options).catch(()=>{});
}

// ---- 기존 자료 채우기(backfill) ----
// 자료실을 열 때 뒤에서 조용히 소량씩 돈다(startAutoTextRead, library-upload.js가 LIB-자동정리와 같은 자리에서 부른다). 건수 확인·되돌리기 SQL은 docs/design/global-search.md 8.4절.
// 서버도 매일 밤 같은 조건으로 몇 개씩 읽는다(drive-summary ?action=text_backfill, 8.7절). 두 경로는 같은 결과 칸을 쓰고 밤 경로는 조건부로 써서 덮지 않는다.
// 아직 한 번도 읽지 않은 자료(extraction_status가 ready·error가 아닌 것)만 최근 것부터 limit개, 한 번에 하나씩 읽는다.
// 결과 {asked,ready,error,failed,stop}. 던지지 않는다. isCurrent()가 거짓이면(로그아웃·화면 이동) 다음 요청을 보내지 않는다.
export const BACKFILL_MAX=50;
export async function readMissingTexts({rt=globalThis.window?.KPTURuntime,limit=10,isCurrent=()=>true,skip=null}={}){
  const out={asked:0,ready:0,error:0,failed:0,stop:null};
  try{
    const workspace=rt?.context?.read?.()?.workspace?.id;
    const n=Number.isInteger(limit)?Math.min(Math.max(limit,1),BACKFILL_MAX):10;
    if(!rt?.api||typeof workspace!=='string'||!UUID.test(workspace))return {...out,stop:'invalid_request'};
    const rows=await rt.api('/rest/v1/app_documents?workspace_id=eq.'+encodeURIComponent(workspace)
      +'&or=(extraction_status.is.null,extraction_status.not.in.(ready,error))&file_id=not.is.null&select=id&order=created_at.desc&limit='+(n+(skip?skip.size:0)),
      {refreshSession:false,singleFlight:false});
    if(!Array.isArray(rows))return {...out,stop:'list_failed'};
    // skip: 이 화면 사용 중 이미 보낸 자료(요청이 실패해 상태가 안 바뀐 것)는 다시 보내지 않는다.
    const todo=(skip?rows.filter(r=>!skip.has(r?.id)):rows).slice(0,n);
    for(const row of todo){
      if(!isCurrent())return {...out,stop:'stale'};
      if(skip&&typeof row?.id==='string')skip.add(row.id);
      const r=await requestDocumentText(row?.id,{rt});
      out.asked++;
      if(!r.ok)out.failed++;else out[r.status]++;
    }
    return out;
  }catch{return {...out,stop:'list_failed'}}
}

// ---- 자동 채우기: 자료실을 열 때 호출. 기다리지 않고, 한 번에 AUTO_READ_BATCH개, 동시에 하나만 ----
// 이미 도는 중이면 건너뛴다. 같은 로그인·업무공간(scopeKey) 동안 보낸 자료는 다시 보내지 않고(화면 메모리만, 브라우저 저장소 없음),
// 한 번에 보낸 것이 전부 실패하면 그 로그인 동안 더 부르지 않는다. 새로 고치거나 다시 로그인하면 서버 상태로 다시 판단한다.
export const AUTO_READ_BATCH=5;
let autoRun=null,autoKey='',autoSkip=new Set(),autoHalted='';
export function startAutoTextRead({rt=globalThis.window?.KPTURuntime,scopeKey,isCurrent=()=>true,limit=AUTO_READ_BATCH}={}){
  if(autoRun||typeof scopeKey!=='string'||!scopeKey||autoHalted===scopeKey||!isCurrent())return null;
  if(autoKey!==scopeKey){autoKey=scopeKey;autoSkip=new Set()}
  autoRun=readMissingTexts({rt,limit:Math.min(limit,AUTO_READ_BATCH),isCurrent,skip:autoSkip})
    .then(r=>{if(r.stop==='invalid_request'||(r.asked>0&&r.failed===r.asked))autoHalted=scopeKey;return r})
    .catch(()=>null).finally(()=>{autoRun=null});
  return autoRun;
}
