// LIB-AI자동분류 (docs/design/library-ai-fill.md): 자료실에 막 들어온 자료의 빈 칸(제목·자료 날짜·작성 주체·유형)을 버튼 없이 AI가 채운다.
// 순서: document-actions `document-text`(파일 글자 앞부분을 서버가 읽어 자료 표 글자 칸에 둠, AI 없음)
//   → ai-assist `library_fill`(mode fill: 사용자가 올릴 때 넣은 칸(keep)과 사용자가 고친 칸은 빼고 저장).
// 화면에는 AI 표시를 하지 않는다(사용자 결정 ③). 칸별 안쪽 기록(field_origin)은 서버만 쓰고 화면은 그리지 않는다.
// 어떤 실패도 올리기 결과를 바꾸지 않는다: 자료는 이미 등록됐고, 여기서는 조용히 끝낸다(다시 보내지 않음).
import {callAiAssist} from './basket-ai-summary.js';

export const LIBRARY_AI_FIELDS=Object.freeze(['title','document_date','source','category']);
// LIB-AI분류보완: AI는 비어 있는 프로젝트·담당조직 연결도 채운다(서버가 내 목록에서 고름). 화면에는 표시하지 않는다.
export const LIBRARY_LINK_FIELDS=Object.freeze(['project_id','organization_id']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// ai-assist 오류 코드 중 이 흐름이 아는 것(나머지는 internal_error). 문구는 화면에 쓰지 않는다.
const CODES=Object.freeze(Object.fromEntries(['session_required','auth_unavailable','forbidden','invalid_request','unsupported_kind','not_found','ai_not_configured',
  'monthly_limit','daily_limit','usage_unavailable','read_unavailable','ai_busy','ai_timeout','ai_invalid_response','library_not_ready','library_unavailable','internal_error']
  .map(code=>[code,code])));

// jsonb가 돌려주는 키 순서(짧은 것 먼저, 같으면 바이트 순). 저장 확인 비교가 같은 모양을 쓰도록.
export function canonicalOrigin(origin){
  const out={};
  for(const key of Object.keys(origin||{}).sort((a,b)=>a.length-b.length||(a<b?-1:a>b?1:0)))out[key]=origin[key];
  return out;
}
// 사용자가 자료 정보 수정에서 고친 칸은 'user'로(AI 기록을 지우고 다시 덮어쓰지 않게). 다른 칸의 기록은 그대로.
// 칸이 아직 없는 DB(적용 전)이면 null: 그때는 field_origin을 보내지 않는다.
// 연결(프로젝트)은 AI가 붙인 기록이 이미 있을 때만 'user'로 바꾼다(그 기록이 있으면 DB가 연결 키를 받는 판이라는 뜻).
// 기록이 없는 연결은 원래 사람 것으로 보고 AI가 건드리지 않으며, 수정 창 저장의 '사용자 수정' 표시로도 잠긴다.
export function originAfterEdit(original,changed){
  if(!original||!Object.hasOwn(original,'field_origin'))return null;
  const base=original.field_origin&&typeof original.field_origin==='object'&&!Array.isArray(original.field_origin)?original.field_origin:{};
  const next={...base};
  for(const field of changed)if(LIBRARY_AI_FIELDS.includes(field)||LIBRARY_LINK_FIELDS.includes(field)&&Object.hasOwn(base,field))next[field]='user';
  return canonicalOrigin(next);
}
// 올리기 창에서 사용자가 직접 넣은 칸 → keep(AI가 쓰지 않을 칸). 여러 파일이면 자료명은 파일마다 따로라 keep에 넣지 않는다.
export function keptFields(form,{multiple=false}={}){
  const keep=[];
  if(!multiple&&String(form?.title??'').trim())keep.push('title');
  if(String(form?.document_date??'').trim())keep.push('document_date');
  if(String(form?.source??'').trim())keep.push('source');
  if(String(form?.category??'').trim())keep.push('category');
  return keep;
}

async function readText(id,rt){
  try{await rt.api('/functions/v1/document-actions',{method:'POST',body:{action:'document-text',document_id:id},refreshSession:false,singleFlight:false});}
  catch{/* 글자를 못 읽어도 파일 이름으로 채운다 */}
}

// 한 자료 채우기. 결과: {ok,updated} 또는 {ok:false,code}. 던지지 않는다.
export async function fillLibraryDocument(id,{keep=[],rt=globalThis.window?.KPTURuntime,call=callAiAssist,notify=true}={}){
  if(typeof id!=='string'||!UUID.test(id)||!rt?.api)return {ok:false,code:'invalid_request'};
  const fields=LIBRARY_AI_FIELDS.filter(f=>keep.includes(f));
  await readText(id,rt);
  const r=await call({kind:'library_fill',mode:'fill',document_ids:[id],keep:fields},{rt},CODES);
  if(!r.ok)return {ok:false,code:r.code};
  const updated=Number.isInteger(r.data?.updated)?r.data.updated:0;
  if(updated&&notify&&typeof window!=='undefined')window.dispatchEvent(new CustomEvent('kptu:documents-changed'));
  return {ok:true,updated};
}

// LIB-수정파일교체: 파일을 바꾼 자료를 새 파일 기준으로 한 번 다시 본다(글자 읽기 → ai-assist tidy). 서버가 정리 안 된 칸만 고르고(손으로 고친 칸·'user' 칸은 그대로,
// 연결은 비어 있을 때만) 끝나면 자료의 reclassify_needed 표시를 끈다. 던지지 않는다. 화면에는 아무 표시도 없다.
export async function reclassifyLibraryDocument(id,{rt=globalThis.window?.KPTURuntime,call=callAiAssist,notify=true}={}){
  if(typeof id!=='string'||!UUID.test(id)||!rt?.api)return {ok:false,code:'invalid_request'};
  await readText(id,rt);
  const r=await call({kind:'library_fill',mode:'tidy',document_ids:[id]},{rt},CODES);
  if(!r.ok)return {ok:false,code:r.code};
  const updated=Number.isInteger(r.data?.updated)?r.data.updated:0;
  if(updated&&notify&&typeof window!=='undefined')window.dispatchEvent(new CustomEvent('kptu:documents-changed'));
  return {ok:true,updated};
}

// ---- LIB-자동정리 (docs/design/library-ai-fill.md 6절, 사용자 결정 2026-10-22 20:54) ----
// 기존 자료의 정리 안 된 칸(사용자가 넣거나 고치지 않은 칸)을 버튼 없이 채운다. 화면에는 아무 표시도 없다(결정 ③).
// 화면은 대상 후보를 고르고 서버(ai-assist library_fill mode tidy)에 자료 ID만 보낸다. 칸 판단·검사·백업·저장은 서버와 DB 함수가 다시 한다.
// 이미 AI에 보낸 자료는 서버 분류 시도 기록(app_library_classify_attempts, LIB-AI분류보완)으로 빼므로 같은 자료를 다시 보내지 않는다.
// 예외 하나: 그때 파일 이름만으로 판단한 자료(with_text=false)는 글자가 들어오면(밤 읽기·열 때 읽기) 한 번 더 보낸다. 브라우저 저장소는 쓰지 않는다.
// 기존 자료 전체(약 75개)를 한 번 열 때 끝내도록 한 번에 최대 8묶음(80개). 하루 한도 50회·월 한도는 서버가 그대로 지킨다.
export const TIDY_BATCH=10;
export const TIDY_MAX_BATCHES=8;
export const TIDY_TEXT_CONCURRENCY=3;
export const TIDY_TEXT_TIMEOUT_MS=20000;
export const TIDY_FRESH_MS=60*60*1000;
const LOCKED='기타';
const squash=s=>String(s??'').normalize('NFKC').toLowerCase().replace(/[\s_\-.()[\]]+/g,'');
const baseName=name=>String(name??'').replace(/\.[^.]{1,8}$/,'').trim();
// 서버 legacyUserFields와 같은 규칙: 칸별 기록이 생기기 전에 사람이 손댄 칸.
export function legacyUserFields(note){
  const text=typeof note==='string'?note.trim():'';
  if(text==='사용자 수정')return [...LIBRARY_AI_FIELDS,'project_id'];
  if(text.startsWith('사용자 입력 제목'))return ['title'];
  return [];
}
// 서버 needsTidy와 같은 규칙(후보 고르기용일 뿐, 서버가 다시 판단한다).
export function untidyFields(doc,categories){
  const origin=doc?.field_origin&&typeof doc.field_origin==='object'&&!Array.isArray(doc.field_origin)?doc.field_origin:{};
  const legacy=legacyUserFields(doc?.classification_note);
  return LIBRARY_AI_FIELDS.filter(field=>{
    if(origin[field]==='user'||legacy.includes(field))return false;
    if(field==='category')return !doc.category||doc.category===LOCKED||!categories.includes(doc.category);
    if(field==='document_date')return !doc.document_date;
    if(field==='source')return !String(doc.source??'').trim();
    const title=String(doc.title??'').trim();
    return !title||squash(title)===squash(baseName(doc.file_name));
  });
}
// 서버 openLinkFields와 같은 규칙(후보 고르기용): 비어 있고, 칸 기록이 없고(사람이 뺀 연결은 기록 'ai'가 남음), 옛 수정 칸이 아닌 연결.
export function openLinks(doc){
  const origin=doc?.field_origin&&typeof doc.field_origin==='object'&&!Array.isArray(doc.field_origin)?doc.field_origin:{};
  const legacy=legacyUserFields(doc?.classification_note);
  return LIBRARY_LINK_FIELDS.filter(field=>!doc?.[field]&&!Object.hasOwn(origin,field)&&!legacy.includes(field));
}
// 후보: DB에 칸별 기록 칸이 있는 행이고(적용 전이면 빈 목록), 올린 지 1시간 지났고(막 올린 자료는 fill이 맡음),
// 분류 시도 기록이 없으면서 정리 안 된 칸이나 비어 있는 연결이 있거나, 파일 이름만으로 판단했던 자료에 이제 글자가 있는(ready) 자료.
// tried: Map(자료 id → 그때 글자로 판단했는지) 또는 Set(모두 끝난 것으로 봄).
export function tidyCandidates(docs,{tried=new Set(),categories=[],now=Date.now()}={}){
  return (docs||[]).filter(doc=>{
    if(!doc||typeof doc.id!=='string'||!UUID.test(doc.id)||!Object.hasOwn(doc,'field_origin'))return false;
    // 파일을 바꾼 자료(reclassify_needed): 올린 시각·시도 기록과 상관없이 한 번 다시 보낸다(서버가 끝나면 표시를 끈다). 창을 닫았거나 AI가 바빴을 때의 안전망.
    if(doc.reclassify_needed===true)return true;
    const created=Date.parse(doc.created_at||'');
    if(!Number.isFinite(created)||now-created<=TIDY_FRESH_MS)return false;
    const id=doc.id.toLowerCase();
    if(tried.has(id))return tried instanceof Map&&tried.get(id)===false&&doc.extraction_status==='ready';
    return untidyFields(doc,categories).length>0||openLinks(doc).length>0;
  });
}
// 글자 읽기가 필요한 자료: 아직 한 번도 읽지 않은 자료만(ready·error는 이미 읽어 본 것이라 다시 부르지 않는다).
export const needsText=doc=>!['ready','error'].includes(doc?.extraction_status);
// 작은 동시 수로 글자를 읽는다. 한 자료가 오래 걸리면(20초) 기다리지 않고 넘어간다(그 자료는 파일 이름만으로 판단).
export async function readTexts(docs,{rt,isCurrent=()=>true,concurrency=TIDY_TEXT_CONCURRENCY,timeoutMs=TIDY_TEXT_TIMEOUT_MS}={}){
  const queue=docs.filter(needsText);
  const worker=async()=>{
    while(queue.length&&isCurrent()){
      const doc=queue.shift();
      let timer;
      const limit=new Promise(resolve=>{timer=setTimeout(resolve,timeoutMs)});
      try{await Promise.race([rt.api('/functions/v1/document-actions',{method:'POST',body:{action:'document-text',document_id:doc.id},refreshSession:false,singleFlight:false,timeoutMs}).catch(()=>{}),limit]);}
      finally{clearTimeout(timer)}
    }
  };
  await Promise.all(Array.from({length:Math.min(concurrency,queue.length)},worker));
}
async function readTried(rt,workspace){
  try{
    const rows=await rt.api('/rest/v1/app_library_classify_attempts?workspace_id=eq.'+encodeURIComponent(workspace)+'&select=document_id,with_text&limit=5000',{refreshSession:false,singleFlight:false});
    return Array.isArray(rows)?new Map(rows.map(r=>[String(r?.document_id||'').toLowerCase(),r?.with_text===true])):null;
  }catch{return null}
}
// 한 번 돌기: 후보를 10개씩(최대 8묶음) 서버에 보낸다. 어떤 실패도 조용히 멈춘다(재시도 없음). 결과 {sent,updated,stop}. 던지지 않는다.
// isCurrent()가 거짓이 되면(다른 업무공간·로그아웃·자료실을 떠남) 다음 요청을 보내지 않는다.
export async function autoTidyLibrary(docs,{rt=globalThis.window?.KPTURuntime,call=callAiAssist,workspace,categories=[],isCurrent=()=>true,now=Date.now(),onChanged=null}={}){
  const out={sent:0,updated:0,stop:null};
  try{
    if(!rt?.api||typeof workspace!=='string'||!workspace||!isCurrent())return {...out,stop:'invalid_request'};
    // 칸별 기록 칸이 없는 DB(적용 전)면 부르지 않는다.
    if(!(docs||[]).some(doc=>doc&&Object.hasOwn(doc,'field_origin')))return {...out,stop:'library_not_ready'};
    const tried=await readTried(rt,workspace);
    if(!tried)return {...out,stop:'library_not_ready'};
    const list=tidyCandidates(docs,{tried,categories,now});
    for(let i=0;i<Math.min(list.length,TIDY_BATCH*TIDY_MAX_BATCHES);i+=TIDY_BATCH){
      if(!isCurrent())return {...out,stop:'stale'};
      const batch=list.slice(i,i+TIDY_BATCH);
      await readTexts(batch,{rt,isCurrent});
      if(!isCurrent())return {...out,stop:'stale'};
      const r=await call({kind:'library_fill',mode:'tidy',document_ids:batch.map(d=>d.id)},{rt},CODES);
      out.sent+=batch.length;
      if(!r.ok)return {...out,stop:r.code};
      const updated=Number.isInteger(r.data?.updated)?r.data.updated:0;
      out.updated+=updated;
      if(updated&&isCurrent()&&typeof onChanged==='function')onChanged();
    }
    return out;
  }catch{return {...out,stop:'internal_error'}}
}
