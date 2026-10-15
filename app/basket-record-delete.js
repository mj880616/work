// 바구니 연결 해제와 메모 원문 삭제는 조직·프로젝트 상세와 바구니 읽기 화면이 이 모듈 하나로 처리한다.
// 연결 해제는 기존 owner RLS(record_links_owner_all)로 1행만 지운다. 메모를 지우면
// app_record_links.note_id의 on delete cascade로 그 메모의 연결도 함께 지워진다.
// 첨부가 있는 메모는 basket-files의 note-delete가 첨부를 Drive 휴지통으로 옮긴 뒤 로그인 사용자 JWT로
// 메모를 지운다. 서버가 아직 이 동작을 모르면(배포 전 구버전 응답) 지금처럼 REST DELETE로 메모만 지운다.
const PAGE_SIZE=100;
const contextFor=rt=>typeof rt.context?.read==='function'?(rt.context.read()||{}):(globalThis.window?.__KPTU_BOOT_CONTEXT__||{});
const scope=rt=>{const c=contextFor(rt);return `${c?.user?.id||''}:${c?.workspace?.id||''}`;};
const encode=encodeURIComponent;
const pending=new Set();

export const DISCONNECT_CONFIRM_TEXT=Object.freeze({
  organization:'이 조직에서만 빠집니다. 메모는 바구니에 남고, 이 연결에 적은 요약은 사라집니다.',
  project:'이 프로젝트에서만 빠집니다. 메모는 바구니에 남고, 이 연결에 적은 요약은 사라집니다.',
});
export const RECORD_DELETE_TEXT=Object.freeze({
  DISCONNECT_FAILED:'연결을 해제하지 못했어요. 다시 시도해 주세요.',
  DISCONNECT_MISSING:'이미 해제된 연결이에요. 목록을 다시 불러왔어요.',
  NOTE_FAILED:'메모를 지우지 못했어요. 다시 시도해 주세요.',
  NOTE_MISSING:'메모를 찾을 수 없어요. 이미 지워졌을 수 있어요.',
  NOTE_READ_FAILED:'메모 정보를 확인하지 못했어요. 다시 시도해 주세요.',
  NOTE_DELETED:'메모를 지웠어요. 첨부 파일은 Drive에 남아 있어요.',
  NOTE_DELETED_PLAIN:'메모를 지웠어요.',
  NOTE_TRASHED:'메모를 지우고 첨부를 Drive 휴지통으로 옮겼어요.',
  NOTE_CHANGED:'메모가 바뀌었어요. 다시 불러온 뒤 확인해 주세요.',
  RESULT_UNKNOWN:'결과를 확인하지 못했어요. 목록을 다시 불러와 실제 상태를 확인해 주세요.',
  BUSY:'처리 중이에요. 잠시 기다려 주세요.',
});

export function noteDeleteConfirmText({places=0,otherLinks=0,attachments=0}={}){
  return ['메모 원문을 지웁니다.',
    `연결된 조직·프로젝트 ${places}곳에서도 사라집니다.`,
    otherLinks?`회의·자료실 연결 ${otherLinks}곳도 함께 사라집니다.`:'',
    attachments?`첨부 파일 ${attachments}개는 Drive 휴지통으로 옮깁니다(30일 안에 복구 가능).`:''].filter(Boolean).join(' ');
}
// Trash counts from the server. Unknown PATCH outcomes are named separately, never as success.
export function noteDeleteResultText({failed=0,unknown=0}={}){
  if(!failed&&!unknown)return RECORD_DELETE_TEXT.NOTE_TRASHED;
  return ['메모를 지웠어요.',failed?`첨부 ${failed}개는 Drive에 남았어요.`:'',
    unknown?`첨부 ${unknown}개는 휴지통 이동 결과를 확인하지 못했어요. Drive에서 확인해 주세요.`:''].filter(Boolean).join(' ');
}

function workspaceOf(rt){
  const c=contextFor(rt),id=c?.workspace?.id;
  if(!c?.user?.id||!id)throw Error('업무 공간이나 로그인이 바뀌었어요. 다시 확인해 주세요.');
  return id;
}
const sessionEpoch=rt=>typeof rt.session?.epoch==='function'?rt.session.epoch():null;

// One row only: the exact id inside the signed-in workspace. RLS still decides access.
export function recordLinkDeletePath(linkId,workspaceId){return `/rest/v1/app_record_links?id=eq.${encode(linkId)}&workspace_id=eq.${encode(workspaceId)}&select=id`;}
export function noteDeletePath(noteId,workspaceId){return `/rest/v1/app_notes?id=eq.${encode(noteId)}&workspace_id=eq.${encode(workspaceId)}&select=id`;}

async function exists(path,rt,expectedSessionEpoch){
  const rows=await rt.api(path,{expectedSessionEpoch});
  if(!Array.isArray(rows))throw Error('unexpected');
  return rows.length>0;
}
export async function readNoteDeleteInfo(noteId,rt=window.KPTURuntime){
  const workspaceId=workspaceOf(rt),expectedSessionEpoch=sessionEpoch(rt);
  const notes=await rt.api(`/rest/v1/app_notes?id=eq.${encode(noteId)}&workspace_id=eq.${encode(workspaceId)}&select=id,updated_at,attachments`,{expectedSessionEpoch});
  if(!Array.isArray(notes))throw Error('unexpected');
  const note=notes.find(row=>row.id===noteId);if(!note)return null;
  const links=[];
  for(let offset=0;;offset+=PAGE_SIZE){
    const page=await rt.api(`/rest/v1/app_record_links?workspace_id=eq.${encode(workspaceId)}&note_id=eq.${encode(noteId)}&status=eq.confirmed&select=id,organization_id,project_id&order=id.asc&limit=${PAGE_SIZE}&offset=${offset}`,{expectedSessionEpoch});
    if(!Array.isArray(page))throw Error('unexpected');
    links.push(...page);if(page.length<PAGE_SIZE)break;
  }
  const places=links.filter(link=>link.organization_id||link.project_id).length;
  return {places,otherLinks:links.length-places,attachments:Array.isArray(note.attachments)?note.attachments.length:0,updatedAt:note.updated_at};
}

const SERVER_RESPONSE_BYTES=16384,SERVER_WAIT_MS=90000;
const count=value=>Number.isSafeInteger(value)&&value>=0&&value<=20;
// One POST, never replayed. Returns {data,status} or throws {code:'NOT_SENT'|'UNKNOWN'}.
// The deadline only stops waiting; it never aborts or resends the request.
export async function requestServerNoteDelete(noteId,updatedAt,{rt,fetcher=globalThis.fetch,waitMs=SERVER_WAIT_MS,expectedSessionEpoch=null}={}){
  const fail=code=>Object.assign(Error(code),{code});
  const owner=contextFor(rt)?.user?.id;
  if(typeof rt.session?.ensure==='function'&&!await rt.session.ensure())throw fail('NOT_SENT');
  const session=rt.session?.read?.();
  if(!owner||!session?.access_token||session?.user?.id!==owner||sessionEpoch(rt)!==expectedSessionEpoch)throw fail('NOT_SENT');
  let timer,finished=false;
  const request=(async()=>{
    const response=await fetcher(rt.config.url+'/functions/v1/basket-files?action=note-delete',{method:'POST',cache:'no-store',
      headers:{apikey:rt.config.key,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},
      body:JSON.stringify({action:'note-delete',note_id:noteId,note_updated_at:updatedAt})});
    const reader=response.body?.getReader();if(!reader)throw fail('UNKNOWN');
    const parts=[];let size=0;
    try{
      while(!finished){
        const chunk=await reader.read();if(chunk.done)break;
        size+=chunk.value.byteLength;if(size>SERVER_RESPONSE_BYTES)throw fail('UNKNOWN');parts.push(chunk.value);
      }
    }finally{try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}}
    const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
    let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw fail('UNKNOWN');}
    if(!data||typeof data!=='object'||Array.isArray(data))throw fail('UNKNOWN');
    return {data,status:response.status};
  })();
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail('UNKNOWN')),waitMs);});
  try{return await Promise.race([request,deadline]);}
  catch{throw fail('UNKNOWN');}
  finally{finished=true;clearTimeout(timer);request.catch(()=>{});}
}
// Deployed before note-delete existed, basket-files sends JSON POSTs to OCR, which
// refuses an unknown action before any DB or Drive access. Only that exact refusal
// is treated as "server does not know this action yet".
export const isLegacyNoteDeleteReply=({data,status})=>status===400&&data?.code==='OCR_REQUEST_INVALID'&&!Object.hasOwn(data,'action');

// Shared outcome shape: deleted | missing | failed | unknown | cancelled | busy | stale.
// A thrown write is never guessed: the row is read again to report the real state.
async function remove(kind,id,{rt,isCurrent,confirmText,write}){
  const key=`${kind}:${id}`;
  if(pending.has(key))return {status:'busy',message:RECORD_DELETE_TEXT.BUSY};
  pending.add(key);
  const owner=scope(rt),current=()=>owner===scope(rt)&&isCurrent();
  const notify=()=>{if(owner===scope(rt))window.dispatchEvent(new Event('kptu:basket-links-changed'));};
  const text=kind==='note'?{failed:RECORD_DELETE_TEXT.NOTE_FAILED,missing:RECORD_DELETE_TEXT.NOTE_MISSING,deleted:RECORD_DELETE_TEXT.NOTE_DELETED}:{failed:RECORD_DELETE_TEXT.DISCONNECT_FAILED,missing:RECORD_DELETE_TEXT.DISCONNECT_MISSING,deleted:''};
  try{
    let workspaceId;try{workspaceId=workspaceOf(rt);}catch{return {status:'stale'};}
    const expectedSessionEpoch=sessionEpoch(rt),path=kind==='note'?noteDeletePath(id,workspaceId):recordLinkDeletePath(id,workspaceId);
    const message=await confirmText();
    if(!current())return {status:'stale'};
    if(message.status){if(message.status==='missing')notify();return message;}
    if(!globalThis.confirm(message.text)||!current())return {status:'cancelled'};
    let status,result;
    if(write){
      result=await write({message,expectedSessionEpoch,path});
      if(result.status!=='rest'){
        if(result.status!=='failed')notify();
        return current()?result:{status:'stale'};
      }
      if(!current())return {status:'stale'};
    }
    try{
      const rows=await rt.api(path,{method:'DELETE',prefer:'return=representation',expectedSessionEpoch});
      status=Array.isArray(rows)&&rows.some(row=>row?.id===id)?'deleted':Array.isArray(rows)&&!rows.length?'missing':'unknown';
    }catch{
      try{status=await exists(path,rt,expectedSessionEpoch)?'failed':'deleted';}catch{status='unknown';}
    }
    if(status!=='failed')notify();
    if(!current())return {status:'stale'};
    return {status,message:status==='deleted'&&result?.message?result.message:text[status]??RECORD_DELETE_TEXT.RESULT_UNKNOWN};
  }finally{pending.delete(key);}
}

export function disconnectRecordLink(linkId,{kind='organization',rt=window.KPTURuntime,isCurrent=()=>true}={}){
  return remove('link',linkId,{rt,isCurrent,confirmText:async()=>({text:DISCONNECT_CONFIRM_TEXT[kind]||DISCONNECT_CONFIRM_TEXT.organization})});
}

export function deleteNoteOriginal(noteId,{rt=window.KPTURuntime,isCurrent=()=>true,fetcher=globalThis.fetch,waitMs}={}){
  return remove('note',noteId,{rt,isCurrent,confirmText:async()=>{
    let info;try{info=await readNoteDeleteInfo(noteId,rt);}catch{return {status:'failed',message:RECORD_DELETE_TEXT.NOTE_READ_FAILED};}
    if(!info)return {status:'missing',message:RECORD_DELETE_TEXT.NOTE_MISSING};
    return {text:noteDeleteConfirmText(info),info};
  },write:async({message:{info},expectedSessionEpoch,path})=>{
    // No attachment: nothing to trash, the owner-RLS REST delete is enough.
    if(!info.attachments)return {status:'rest',message:RECORD_DELETE_TEXT.NOTE_DELETED_PLAIN};
    let reply;
    try{reply=await requestServerNoteDelete(noteId,info.updatedAt,{rt,fetcher,waitMs,expectedSessionEpoch});}
    catch(error){
      if(error?.code==='NOT_SENT')return {status:'failed',message:RECORD_DELETE_TEXT.NOTE_FAILED};
      return await readBack(path,rt,expectedSessionEpoch);
    }
    if(isLegacyNoteDeleteReply(reply))return {status:'rest',message:RECORD_DELETE_TEXT.NOTE_DELETED};
    const data=reply.data;
    if(data.action!=='note-delete'||![data.trashed,data.failed,data.unknown].every(count))return await readBack(path,rt,expectedSessionEpoch);
    if(data.note_deleted===true)return {status:'deleted',message:noteDeleteResultText(data)};
    if(data.code==='note_not_found')return {status:'missing',message:RECORD_DELETE_TEXT.NOTE_MISSING};
    const trashed=data.trashed?` 첨부 ${data.trashed}개는 이미 Drive 휴지통으로 옮겼어요(30일 안에 복구 가능).`:'';
    if(data.code==='note_changed')return {status:'failed',message:RECORD_DELETE_TEXT.NOTE_CHANGED+trashed};
    if(data.code==='note_delete_result_unknown')return await readBack(path,rt,expectedSessionEpoch);
    return {status:'failed',message:RECORD_DELETE_TEXT.NOTE_FAILED+trashed};
  }});
}
// After an unclear server outcome, the note row itself is read again. Trash counts stay unknown.
async function readBack(path,rt,expectedSessionEpoch){
  try{
    return await exists(path,rt,expectedSessionEpoch)
      ?{status:'failed',message:RECORD_DELETE_TEXT.NOTE_FAILED}
      :{status:'deleted',message:'메모를 지웠어요. 첨부의 휴지통 이동 결과는 Drive에서 확인해 주세요.'};
  }catch{return {status:'unknown',message:RECORD_DELETE_TEXT.RESULT_UNKNOWN};}
}
