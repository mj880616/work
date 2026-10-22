// LIB-AI자동분류 (docs/design/library-ai-fill.md): 자료실에 막 들어온 자료의 빈 칸(제목·자료 날짜·작성 주체·유형)을 버튼 없이 AI가 채운다.
// 순서: document-actions `document-text`(파일 글자 앞부분을 서버가 읽어 자료 표 글자 칸에 둠, AI 없음)
//   → ai-assist `library_fill`(mode fill: 사용자가 올릴 때 넣은 칸(keep)과 사용자가 고친 칸은 빼고 저장).
// 화면에는 AI 표시를 하지 않는다(사용자 결정 ③). 칸별 안쪽 기록(field_origin)은 서버만 쓰고 화면은 그리지 않는다.
// 어떤 실패도 올리기 결과를 바꾸지 않는다: 자료는 이미 등록됐고, 여기서는 조용히 끝낸다(다시 보내지 않음).
import {callAiAssist} from './basket-ai-summary.js';

export const LIBRARY_AI_FIELDS=Object.freeze(['title','document_date','source','category']);
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
export function originAfterEdit(original,changed){
  if(!original||!Object.hasOwn(original,'field_origin'))return null;
  const base=original.field_origin&&typeof original.field_origin==='object'&&!Array.isArray(original.field_origin)?original.field_origin:{};
  const next={...base};
  for(const field of changed)if(LIBRARY_AI_FIELDS.includes(field))next[field]='user';
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

// 기존 자료 정리 목록 만들기(⑥ 1단계): 저장하지 않고 {document_id, field, from, to} 목록만 돌려준다.
// 적용은 사용자 확인 뒤 별도 단계(원래 값 백업 포함, docs/design/library-ai-fill.md 6절). 10개씩 나눠 보낸다.
// 화면용 덧붙임: onProgress(done,total)로 진행을 알리고, stopOnError면 첫 실패에서 멈추며, remaining(못 본 자료 id)·stop(멈춘 이유)을 돌려준다.
const TIDY_STOP_CODES=Object.freeze(['monthly_limit','daily_limit','ai_not_configured','library_not_ready','session_required']);
export async function buildTidyProposals(ids,{rt=globalThis.window?.KPTURuntime,call=callAiAssist,readFirst=true,onProgress=null,stopOnError=false}={}){
  const list=[...new Set((ids||[]).filter(id=>typeof id==='string'&&UUID.test(id)))];
  const proposals=[],failed=[],remaining=[];
  let stop=null,done=0;
  for(let i=0;i<list.length;i+=10){
    const batch=list.slice(i,i+10);
    if(stop){remaining.push(...batch);continue;}
    if(readFirst)for(const id of batch)await readText(id,rt);
    const r=await call({kind:'library_fill',mode:'propose',document_ids:batch},{rt},CODES);
    if(!r.ok){
      failed.push({ids:batch,code:r.code});remaining.push(...batch);
      if(stopOnError||TIDY_STOP_CODES.includes(r.code))stop=r.code;
      continue;
    }
    done+=batch.length;
    for(const p of Array.isArray(r.data?.proposals)?r.data.proposals:[]){
      if(batch.includes(p?.document_id)&&LIBRARY_AI_FIELDS.includes(p?.field)&&typeof p?.to==='string')proposals.push({document_id:p.document_id,field:p.field,from:p.from??null,to:p.to});
    }
    if(typeof onProgress==='function')onProgress(done,list.length);
  }
  return {proposals,failed,remaining,stop,done};
}

// ---- 정리 제안 화면용 순수 함수(저장 없음, 결과는 화면 메모리에만) ----
export const TIDY_FIELD_LABEL=Object.freeze({title:'제목',document_date:'날짜',source:'출처',category:'분류'});
const squash=s=>String(s??'').normalize('NFKC').toLowerCase().replace(/[\s_\-.()[\]]+/g,'');
const baseName=name=>String(name??'').replace(/\.[^.]{1,8}$/,'').trim();
// 값 한 칸의 화면 문구. 빈 값은 "(빈 칸)", 파일 이름과 같은 제목은 "(파일 이름 그대로)", 분류는 표시 이름(categoryName), 날짜는 YYYY.MM.DD.
export function tidyValueText(field,value,doc,{categoryName=v=>v}={}){
  const text=String(value??'').trim();
  if(!text)return '(빈 칸)';
  if(field==='title'&&doc&&squash(text)===squash(baseName(doc.file_name)))return '(파일 이름 그대로)';
  if(field==='category')return String(categoryName(text)??text);
  if(field==='document_date'){const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(text);return m?`${m[1]}.${m[2]}.${m[3]}`:text;}
  return text;
}
// 제안 목록 → 자료별 묶음. 자료 순서는 docs(목록) 순서를 따르고, 목록에 없는 자료의 제안은 버린다.
// 반환: [{id,name,items:[{field,label,from,to}]}] (from·to는 이미 화면 문구, escape는 그리는 쪽이 한다)
export function groupTidyProposals(proposals,docs,{categoryName}={}){
  const byId=new Map();
  for(const p of proposals||[]){if(!byId.has(p.document_id))byId.set(p.document_id,[]);byId.get(p.document_id).push(p);}
  const rows=[];
  for(const doc of docs||[]){
    const list=byId.get(doc.id);
    if(!list?.length)continue;
    rows.push({id:doc.id,name:String(doc.file_name||doc.title||''),items:list.map(p=>({field:p.field,label:TIDY_FIELD_LABEL[p.field]||p.field,from:tidyValueText(p.field,p.from,doc,{categoryName}),to:tidyValueText(p.field,p.to,doc,{categoryName})}))});
  }
  return rows;
}
// 이어서 찾기 상태: ids = 대상 자료 전체, pending = 아직 못 본 것, proposals = 지금까지 받은 제안(유지).
export function startTidyState(ids){
  const list=[...new Set((ids||[]).filter(id=>typeof id==='string'&&UUID.test(id)))];
  return {total:list.length,pending:list,proposals:[],error:null};
}
export function mergeTidyResult(state,result){
  const seen=new Set(state.proposals.map(p=>`${p.document_id}|${p.field}`));
  const added=(result.proposals||[]).filter(p=>!seen.has(`${p.document_id}|${p.field}`));
  return {total:state.total,pending:[...(result.remaining||[])],proposals:[...state.proposals,...added],error:result.failed?.length?(result.stop||result.failed.at(-1).code):null};
}
export const TIDY_ERROR_TEXT=Object.freeze({
  daily_limit:'오늘 쓸 수 있는 횟수를 다 썼어요. 내일 이어서 찾을 수 있어요.',
  monthly_limit:'이번 달 쓸 수 있는 양을 다 썼어요.',
  not_ready:'아직 쓸 수 없어요.',unsupported_kind:'아직 쓸 수 없어요.',library_not_ready:'아직 쓸 수 없어요.',ai_not_configured:'아직 쓸 수 없어요.',library_unavailable:'아직 쓸 수 없어요.',
  offline:'인터넷 연결을 확인해 주세요.',session_required:'다시 로그인해 주세요.',auth_unavailable:'다시 로그인해 주세요.',
  ai_busy:'지금 많이 바빠요. 잠시 뒤 이어서 찾아 주세요.',ai_timeout:'시간이 오래 걸려 멈췄어요. 이어서 찾아 주세요.',
});
export const tidyErrorText=code=>TIDY_ERROR_TEXT[code]||'찾지 못했어요. 이어서 찾아 주세요.';
// 다시 시도해도 소용없는 이유(버튼을 숨긴다): 아직 못 쓰는 기능, 하루·달 한도.
export const tidyRetryable=code=>!['daily_limit','monthly_limit','not_ready','unsupported_kind','library_not_ready','ai_not_configured','library_unavailable'].includes(code);
