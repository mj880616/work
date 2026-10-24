// AI-서버연동 S4(쓰임 1, docs/design/ai-server.md 5.1·D11): 연결 요약 칸 옆 [AI 요약].
// 서버 함수 ai-assist(kind=link_summary)에 메모 ID·대상 종류·대상 ID만 보낸다. 글은 서버가 로그인 토큰(RLS)으로 읽는다.
// 답은 후보일 뿐 저장하지 않는다. 칸이 비었을 때만 바로 넣고, 글이 있으면 제안을 따로 보여 주며
// [이걸로 바꾸기]를 눌러야 칸이 바뀐다. 저장은 기존 [연결]·[저장] 버튼(기존 RPC)이 한다.
export const AI_SUMMARY_PATH='/functions/v1/ai-assist';
// 서버는 OpenAI를 30초 기다리고 1번 다시 시도할 수 있다. 화면은 그보다 조금 더 기다린다.
export const AI_SUMMARY_TIMEOUT_MS=75000;
const MAX_RESPONSE_CHARS=64*1024;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// basket-link-records.js validateLinkSummary와 같은 빈칸 문자 집합.
const ONLY_WHITESPACE=/^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*$/u;

// 서버 오류 코드(supabase/functions/ai-assist/handler.ts MESSAGES)와 화면 전용 코드의 일상어 안내.
export const AI_SUMMARY_TEXT=Object.freeze({
  not_ready:'AI 요약은 아직 준비 중이에요.',
  offline:'인터넷 연결을 확인한 뒤 다시 눌러 주세요.',
  session_required:'로그인이 필요해요. 다시 로그인한 뒤 눌러 주세요.',
  auth_unavailable:'로그인을 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.',
  forbidden:'이 기능을 쓸 권한이 없어요.',
  method_not_allowed:'지원하지 않는 요청이에요.',
  invalid_request:'요청 내용을 확인해 주세요.',
  unsupported_kind:'아직 지원하지 않는 AI 기능이에요.',
  not_found:'자료를 찾거나 열 수 없어요.',
  note_excluded:'이 기록은 AI에 보내지 않도록 되어 있어요.',
  input_too_large:'기록이 너무 길어 AI 요약을 만들 수 없어요.',
  ai_not_configured:'지금은 AI를 쓸 수 없어요.',
  monthly_limit:'이번 달 AI 한도에 닿았어요. 요약은 직접 써 주세요.',
  daily_limit:'오늘 AI 요약을 쓸 수 있는 횟수를 다 썼어요. 요약은 직접 써 주세요.',
  usage_unavailable:'AI 사용 기록을 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.',
  read_unavailable:'자료를 읽지 못했어요. 잠시 뒤 다시 시도해 주세요.',
  ai_busy:'AI가 지금 바빠요. 잠시 뒤 다시 눌러 주세요.',
  ai_timeout:'AI 답이 늦어 멈췄어요. 잠시 뒤 다시 눌러 주세요.',
  ai_invalid_response:'AI 답을 읽지 못했어요. 다시 눌러 주세요.',
  in_progress:'다른 AI 작업이 진행 중이에요. 잠시 뒤 다시 눌러 주세요.',
  radar_unavailable:'AI 요청을 처리하지 못했어요. 다시 눌러 주세요.',
  ledger_not_ready:'원장 후보 기능이 아직 준비되지 않았어요.',
  ledger_unavailable:'원장 후보를 읽거나 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.',
  ledger_busy:'원장 자동 기록이 이미 돌고 있어요. 잠시 뒤 다시 시도해 주세요.',
  ledger_record_failed:'원장에 기록하지 못했어요. 다음에 다시 시도해요.',
  org_summary_not_ready:'조직 요약은 아직 준비 중이에요.',
  org_summary_unavailable:'조직 요약을 읽거나 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.',
  library_not_ready:'자료 정보 채우기가 아직 준비되지 않았어요.',
  library_unavailable:'자료를 읽거나 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.',
  text_pending:'글자 읽는 중이에요. 잠시 뒤 다시 눌러 주세요.',
  no_file_text:'요약할 글자가 없어요. 직접 써 주세요.',
  internal_error:'AI 요청을 처리하지 못했어요. 다시 눌러 주세요.',
});
// 잠깐의 문제라 같은 버튼을 [다시 시도]로 보여 줄 코드.
const RETRYABLE=new Set(['offline','text_pending','auth_unavailable','usage_unavailable','read_unavailable','ai_busy','ai_timeout','ai_invalid_response','in_progress','radar_unavailable','ledger_unavailable','ledger_busy','org_summary_unavailable','internal_error']);
export const aiSummaryRetryable=code=>RETRYABLE.has(code);

// 서버가 거절하는 메모(일기·보관·AI 제외·빈 글)에서는 버튼을 보이지 않는다(서버가 다시 확인한다).
export function aiSummaryAllowed(note){
  return !!note&&typeof note==='object'&&note.kind!=='diary'&&!note.archived_at&&note.ai_export_allowed===true&&(note.raw_text===undefined||(typeof note.raw_text==='string'&&!ONLY_WHITESPACE.test(note.raw_text)));
}
export const isBlankSummary=value=>value==null||(typeof value==='string'&&ONLY_WHITESPACE.test(value));
function validSummary(value){
  return typeof value==='string'&&!ONLY_WHITESPACE.test(value)&&!value.includes('\0')&&value.isWellFormed?.()!==false&&[...value].length<=2000;
}
const fail=code=>({ok:false,code,message:AI_SUMMARY_TEXT[code]||AI_SUMMARY_TEXT.internal_error,retry:aiSummaryRetryable(code)});

// One POST to ai-assist with the signed-in token. Shared by every ai-assist use on the screen (연결 요약, 챙길 것 찾기).
// Returns {ok:true,data} for a well-formed success, or {ok:false,code} with a known code. Never throws, never saves.
// An undeployed function (404, or blocked without CORS so it looks like a network error) is 'not_ready'.
export async function callAiAssist(body,{rt=globalThis.window?.KPTURuntime,fetcher=(...a)=>globalThis.fetch(...a),timeoutMs=AI_SUMMARY_TIMEOUT_MS,online=()=>globalThis.navigator?.onLine!==false}={},codes=AI_SUMMARY_TEXT){
  let signedIn=false;
  try{signedIn=await rt.session.ensure();}catch{return {ok:false,code:'auth_unavailable'};}
  const token=rt.session.read?.()?.access_token;
  if(!signedIn||!token)return {ok:false,code:'session_required'};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  let response,text='';
  try{
    response=await fetcher(rt.config.url+AI_SUMMARY_PATH,{method:'POST',cache:'no-store',signal:controller.signal,
      headers:{apikey:rt.config.key,Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify(body)});
    text=await response.text();
  }catch{
    if(controller.signal.aborted)return {ok:false,code:'ai_timeout'};
    return {ok:false,code:online()?'not_ready':'offline'};
  }finally{clearTimeout(timer);}
  let data=null;
  if(text.length<=MAX_RESPONSE_CHARS){try{data=JSON.parse(text);}catch{data=null;}}
  if(response.ok&&data?.ok===true&&data.kind===body.kind)return {ok:true,data};
  if(response.ok&&data?.ok===true)return {ok:false,code:'ai_invalid_response'};
  if(data?.ok===false&&typeof data.error==='string'&&Object.hasOwn(codes,data.error)&&!['not_ready','offline'].includes(data.error))return {ok:false,code:data.error};
  if(response.status===404)return {ok:false,code:'not_ready'};
  if(response.status===401)return {ok:false,code:'session_required'};
  if(response.status===429||response.status>=500)return {ok:false,code:'ai_busy'};
  return {ok:false,code:'internal_error'};
}

// UPD-요약부품통일·UPD-사진요약기록: one server use (link_summary) for every summary box. The material is one id:
// noteId (update text; with use:'files' the text already read from its photos and files), meetingId (사업 보고), documentId (자료).
// targetKind 'reference' (참고 묶음) is for updates only, as in app_basket_confirm_links.
export const LINK_TARGET_KINDS=Object.freeze(['organization','project','reference']);
export function linkSummaryBody({noteId,meetingId,documentId,use,targetKind,targetId}){
  const given=[noteId,meetingId,documentId].filter(v=>v!==undefined&&v!==null);
  if(given.length!==1||typeof given[0]!=='string'||!UUID.test(given[0])||typeof targetId!=='string'||!UUID.test(targetId)||!LINK_TARGET_KINDS.includes(targetKind))return null;
  if(use!==undefined&&(use!=='files'||noteId==null))return null;
  if(targetKind==='reference'&&noteId==null)return null;
  const source=noteId!=null?{note_id:noteId,...(use?{use}:{})}:meetingId!=null?{meeting_id:meetingId}:{document_id:documentId};
  return {kind:'link_summary',...source,target_kind:targetKind,target_id:targetId};
}
// Returns {ok:true,summary} or {ok:false,code,message,retry}. Never throws, never saves.
export async function requestLinkSummary(input,options={}){
  const body=linkSummaryBody(input||{});
  if(!body)return fail('invalid_request');
  const r=await callAiAssist(body,options);
  if(!r.ok)return fail(r.code);
  if(validSummary(r.data.summary))return {ok:true,summary:r.data.summary};
  return fail('ai_invalid_response');
}

// D11: an empty box is filled at once; a box with text keeps it and gets a separate proposal.
// save: the host's existing save button (both labels end in a consonant, so the particle is 을).
export const appliedText=(save='저장')=>`AI 요약을 칸에 넣었어요. 아직 저장 전이에요. 고친 뒤 [${save}]을 눌러 주세요.`;
export function placeAiSummary(current,summary,save='저장'){
  return isBlankSummary(current)?{fill:summary,proposal:'',status:appliedText(save)}
    :{fill:null,proposal:summary,status:'칸에 쓴 글은 그대로 두었어요. 제안을 쓰려면 [이걸로 바꾸기]를 눌러 주세요.'};
}
export const newAiState=()=>({busy:false,status:'',retry:false,proposal:'',run:0});

// One small control row under a summary box, shared by the basket link panel, the summary editor and the 사업 보고 link form.
// attr: the data attribute prefix the host already uses (so its focus keeping and click routing work).
// slot: a second row on the same box uses its own attribute names (UPD-사진요약기록 [요약해서 기록으로] = slot 'files-ai').
// waiting: a fixed note shown instead of the button (for example '글자 읽는 중'), so the person sees why it cannot run yet.
export function aiSummaryMarkup(state,key,attr,esc,{label:name='AI 요약',slot='ai',aria='AI 요약 만들기',waiting=''}={}){
  const k=esc(key),p=`${attr}-${slot}`,label=state.retry&&!state.busy?'다시 시도':name;
  if(waiting&&!state.busy)return `<div class="ai-summary" data-ai-summary><div class="ai-summary-row"><span class="ai-summary-status" ${p}-status role="status" aria-live="polite">${esc(waiting)}</span></div></div>`;
  return `<div class="ai-summary" data-ai-summary><div class="ai-summary-row"><button type="button" class="ai-summary-run" ${p}-run="${k}" aria-label="${state.retry&&!state.busy?esc(name)+' 다시 시도':esc(aria)}"${state.busy?' disabled aria-busy="true"':''}>${esc(label)}</button><span class="ai-summary-status" ${p}-status role="status" aria-live="polite">${esc(state.busy?'요약 만드는 중…':state.status)}</span></div>`
    +(state.proposal&&!state.busy?`<div class="ai-summary-proposal" ${p}-proposal><p class="ai-summary-proposal-label">AI 제안</p><p class="ai-summary-proposal-text">${esc(state.proposal)}</p><div class="ai-summary-actions"><button type="button" ${p}-apply="${k}">이걸로 바꾸기</button><button type="button" ${p}-dismiss="${k}">제안 닫기</button></div></div>`:'')
    +'</div>';
}

// UPD-사진요약기록: whether an update's attachments already have text the server can summarize (no AI, no request).
// 'ready' = a photo with read text, or a non-photo file (한글·PDF; the server checks the library text and may answer no_file_text);
// 'pending' = a photo is still being read; 'none' = nothing to read (then the screen shows only the title, no button).
const PHOTO_TYPES=new Set(['image/jpeg','image/png']);
export function attachmentTextState(note){
  if(!note||typeof note!=='object'||note.kind==='diary'||note.archived_at||note.ai_export_allowed!==true)return 'none';
  const files=Array.isArray(note.attachments)?note.attachments:[];let ready=false,pending=false;
  for(const f of files){
    if(!f||typeof f!=='object')continue;
    if(!PHOTO_TYPES.has(f.mime_type)){ready=true;continue;}
    const o=f.ocr;if(o?.state==='reading')pending=true;else if(o?.state==='done'&&typeof o.text==='string'&&!ONLY_WHITESPACE.test(o.text))ready=true;
  }
  return pending?'pending':ready?'ready':'none';
}

// UPD-요약부품통일 ②③: a summary that already exists (통화·텔레그램 핵심내용, 자료 올릴 때 만든 'b1:' 요약) is the box's starting
// text, without calling AI again. It follows the same rule as an AI answer: an empty box takes it, a box with text keeps its text.
export function placeDefaultSummary(current,text){
  const value=typeof text==='string'&&validSummary(text)?text:'';
  return value&&isBlankSummary(current)?value:current??'';
}
// 자료 올릴 때 만든 한두 줄 요약(app_document_ai_index 'b1:' 행, #1108·#1116) 하나를 owner RLS로 읽는다. 없으면 ''(그때는 [AI 요약]).
export async function readDocumentBrief(documentId,{rt=globalThis.window?.KPTURuntime}={}){
  const ws=rt?.context?.read?.()?.workspace?.id;
  if(typeof documentId!=='string'||!UUID.test(documentId)||typeof ws!=='string'||!UUID.test(ws)||!rt?.api)return '';
  try{
    const rows=await rt.api(`/rest/v1/app_document_ai_index?workspace_id=eq.${encodeURIComponent(ws)}&document_id=eq.${encodeURIComponent(documentId)}&content_hash=like.${encodeURIComponent('b1:*')}&select=document_id,content_hash,summary&limit=2`);
    const row=Array.isArray(rows)&&rows.length===1?rows[0]:null;
    return row?.document_id===documentId&&/^b1:[0-9a-f]{32}$/.test(row.content_hash||'')&&validSummary(row.summary)?row.summary:'';
  }catch{return '';}
}
