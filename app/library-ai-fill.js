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
export async function buildTidyProposals(ids,{rt=globalThis.window?.KPTURuntime,call=callAiAssist,readFirst=true}={}){
  const list=[...new Set((ids||[]).filter(id=>typeof id==='string'&&UUID.test(id)))];
  const proposals=[],failed=[];
  for(let i=0;i<list.length;i+=10){
    const batch=list.slice(i,i+10);
    if(readFirst)for(const id of batch)await readText(id,rt);
    const r=await call({kind:'library_fill',mode:'propose',document_ids:batch},{rt},CODES);
    if(!r.ok){failed.push({ids:batch,code:r.code});if(['monthly_limit','daily_limit','ai_not_configured','library_not_ready','session_required'].includes(r.code))break;continue;}
    for(const p of Array.isArray(r.data?.proposals)?r.data.proposals:[]){
      if(batch.includes(p?.document_id)&&LIBRARY_AI_FIELDS.includes(p?.field)&&typeof p?.to==='string')proposals.push({document_id:p.document_id,field:p.field,from:p.from??null,to:p.to});
    }
  }
  return {proposals,failed};
}
