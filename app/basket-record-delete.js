// 바구니 연결 해제와 메모 원문 삭제는 조직·프로젝트 상세와 바구니 목록·읽기 화면이 이 모듈 하나로 처리한다.
// 연결 해제는 기존 owner RLS(record_links_owner_all)로 1행만 지운다. 해제 뒤 5초 [되돌리기]는 새 저장 경로 없이
// 기존 연결 만들기(app_basket_confirm_links)로 같은 곳·같은 요약을 다시 잇는다(BUG-바구니연결해제). 메모를 지우면
// app_record_links.note_id의 on delete cascade로 그 메모의 연결도 함께 지워진다.
// 첨부가 있는 메모는 basket-files의 note-delete가 첨부를 Drive 휴지통으로 옮긴 뒤 로그인 사용자 JWT로
// 메모를 지운다. 서버가 아직 이 동작을 모르면(배포 전 구버전 응답) 지금처럼 REST DELETE로 메모만 지운다.
import {confirmLinks} from './basket-classification.js';

const PAGE_SIZE=100;
const contextFor=rt=>typeof rt.context?.read==='function'?(rt.context.read()||{}):(globalThis.window?.__KPTU_BOOT_CONTEXT__||{});
const scope=rt=>{const c=contextFor(rt);return `${c?.user?.id||''}:${c?.workspace?.id||''}`;};
const encode=encodeURIComponent;
const pending=new Set();

// One confirmation for every screen: the place's name, and that the note stays.
export const disconnectConfirmText=name=>`${String(name||'').trim()||'이'} 연결을 해제할까요? 업데이트는 남아요`;
export const disconnectLabel=name=>`${String(name||'').trim()||'이'} 연결 해제`;
export const UNDO_MS=5000;
export const RECORD_DELETE_TEXT=Object.freeze({
  DISCONNECT_FAILED:'연결을 해제하지 못했어요. 다시 시도해 주세요.',
  DISCONNECT_MISSING:'이미 해제된 연결이에요. 목록을 다시 불러왔어요.',
  NOTE_FAILED:'업데이트를 지우지 못했어요. 다시 시도해 주세요.',
  NOTE_MISSING:'업데이트를 찾을 수 없어요. 이미 지워졌을 수 있어요.',
  NOTE_READ_FAILED:'업데이트 정보를 확인하지 못했어요. 다시 시도해 주세요.',
  NOTE_DELETED:'업데이트를 지웠어요. 첨부 파일은 Drive에 남아 있어요.',
  NOTE_DELETED_PLAIN:'업데이트를 지웠어요.',
  NOTE_TRASHED:'업데이트를 지우고 첨부를 Drive 휴지통으로 옮겼어요.',
  NOTE_CHANGED:'업데이트가 바뀌었어요. 다시 불러온 뒤 확인해 주세요.',
  RESULT_UNKNOWN:'결과를 확인하지 못했어요. 목록을 다시 불러와 실제 상태를 확인해 주세요.',
  BUSY:'처리 중이에요. 잠시 기다려 주세요.',
  DISCONNECTED:'연결을 해제했어요.',
  RESTORED:'연결을 되돌렸어요.',
  RESTORE_FAILED:'연결을 되돌리지 못했어요. 업데이트에서 [연결하기]로 다시 이어 주세요.',
  RESTORE_NOTE_MISSING:'업데이트를 찾을 수 없어 연결을 되돌리지 못했어요.',
  RESTORE_ARCHIVED:'보관된 업데이트라 연결을 되돌리지 못했어요. 보관을 해제한 뒤 다시 이어 주세요.',
  RESTORE_AI_EXCLUDED:'AI 제외로 표시된 업데이트라 연결을 되돌리지 못했어요.',
  RESTORE_TARGET:'연결했던 곳을 찾거나 고를 수 없어 되돌리지 못했어요.',
});

export function noteDeleteConfirmText({places=0,otherLinks=0,attachments=0}={}){
  return ['업데이트 원문을 지웁니다.',
    `연결된 조직·프로젝트 ${places}곳에서도 사라집니다.`,
    otherLinks?`회의·자료실 연결 ${otherLinks}곳도 함께 사라집니다.`:'',
    attachments?`첨부 파일 ${attachments}개는 Drive 휴지통으로 옮깁니다(30일 안에 복구 가능).`:''].filter(Boolean).join(' ');
}
// NOTE-파일붙이기 (2026-10-22 사용자 결정): deleting a note (kind=note) removes the note and its links only; its files stay in
// Drive as they are (no trash, no move), so the note path never calls the server's trash step.
export function noteDocDeleteConfirmText({places=0,otherLinks=0,attachments=0}={}){
  return ['노트 원문을 지웁니다.',
    `연결된 조직·프로젝트 ${places}곳에서도 사라집니다.`,
    otherLinks?`회의·자료실 연결 ${otherLinks}곳도 함께 사라집니다.`:'',
    attachments?`첨부 파일 ${attachments}개는 노트에서만 빠지고 Drive에는 그대로 남아요.`:''].filter(Boolean).join(' ');
}
export const NOTE_DOC_DELETED=Object.freeze({plain:'노트를 지웠어요.',files:'노트를 지웠어요. 첨부 파일은 Drive에 그대로 남아 있어요.'});
// Trash counts from the server. Unknown PATCH outcomes are named separately, never as success.
export function noteDeleteResultText({failed=0,unknown=0}={}){
  if(!failed&&!unknown)return RECORD_DELETE_TEXT.NOTE_TRASHED;
  return ['업데이트를 지웠어요.',failed?`첨부 ${failed}개는 Drive에 남았어요.`:'',
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

export function disconnectRecordLink(linkId,{name='',rt=window.KPTURuntime,isCurrent=()=>true}={}){
  return remove('link',linkId,{rt,isCurrent,confirmText:async()=>({text:disconnectConfirmText(name)})});
}

// Undo re-links the same place with the same summary through the existing confirm-links RPC (owner RLS, INVOKER).
// The note's current version is read first; one call only, and an unclear result is re-read by the screens' lists.
const RESTORE_ERROR={NOTE_MISSING:'RESTORE_NOTE_MISSING',NOTE_WORKSPACE:'RESTORE_NOTE_MISSING',NOTE_ARCHIVED:'RESTORE_ARCHIVED',AI_EXCLUDED:'RESTORE_AI_EXCLUDED',
  TARGET_MISSING:'RESTORE_TARGET',TARGET_WORKSPACE:'RESTORE_TARGET',TARGET_UNSELECTABLE:'RESTORE_TARGET'};
export async function restoreRecordLink({noteId,kind,targetId,summary=null},{rt=window.KPTURuntime}={}){
  const key=`restore:${noteId}:${kind}:${targetId}`;
  if(pending.has(key))return {status:'busy',message:RECORD_DELETE_TEXT.BUSY};
  if(!noteId||!targetId||!['organization','project'].includes(kind))return {status:'failed',message:RECORD_DELETE_TEXT.RESTORE_FAILED};
  pending.add(key);
  const owner=scope(rt),notify=()=>{if(owner===scope(rt))window.dispatchEvent(new Event('kptu:basket-links-changed'));};
  try{
    let workspaceId;try{workspaceId=workspaceOf(rt);}catch{return {status:'stale'};}
    const expectedSessionEpoch=sessionEpoch(rt);
    let note;
    try{
      const rows=await rt.api(`/rest/v1/app_notes?id=eq.${encode(noteId)}&workspace_id=eq.${encode(workspaceId)}&select=id,updated_at`,{expectedSessionEpoch});
      if(!Array.isArray(rows))throw Error('unexpected');note=rows.find(row=>row.id===noteId);
    }catch{return {status:'failed',message:RECORD_DELETE_TEXT.RESTORE_FAILED};}
    if(owner!==scope(rt))return {status:'stale'};
    if(!note)return {status:'failed',message:RECORD_DELETE_TEXT.RESTORE_NOTE_MISSING};
    let result;
    try{result=await confirmLinks(noteId,note.updated_at,[{kind,target_id:targetId,reason:'직접 연결',...(summary===null||summary===undefined?{}:{summary})}],rt);}
    catch{notify();return owner===scope(rt)?{status:'unknown',message:RECORD_DELETE_TEXT.RESULT_UNKNOWN}:{status:'stale'};}
    if(result?.ok===true){notify();return owner===scope(rt)?{status:'restored',message:RECORD_DELETE_TEXT.RESTORED}:{status:'stale'};}
    if(owner!==scope(rt))return {status:'stale'};
    if(!result||typeof result!=='object'){notify();return {status:'unknown',message:RECORD_DELETE_TEXT.RESULT_UNKNOWN};}
    return {status:'failed',message:RECORD_DELETE_TEXT[RESTORE_ERROR[result.error]]||RECORD_DELETE_TEXT.RESTORE_FAILED};
  }finally{pending.delete(key);}
}

// One undo notice at a time, for 5 seconds. It sits inside the open dialog (if any) so the
// dialog's focus loop reaches [되돌리기]; the result is said in the same notice.
let undoBox=null,undoTimer=0;
export function closeUndoNotice(){clearTimeout(undoTimer);undoTimer=0;undoBox?.remove();undoBox=null;}
globalThis.window?.addEventListener?.('kptu:session-changed',closeUndoNotice);
export function offerUndoNotice({text=RECORD_DELETE_TEXT.DISCONNECTED,onUndo,ms=UNDO_MS,doc=globalThis.document}={}){
  closeUndoNotice();if(!doc||typeof onUndo!=='function')return null;
  const host=[...doc.querySelectorAll('.modal:not(.hidden)')].at(-1)||doc.body;
  const box=doc.createElement('div');box.className='kptu-undo-notice';box.dataset.undoNotice='';
  box.innerHTML='<span role="status" aria-live="polite" data-undo-text></span><button type="button" data-undo-action>되돌리기</button>';
  const line=box.querySelector('[data-undo-text]'),button=box.querySelector('[data-undo-action]');line.textContent=text;
  const finish=message=>{if(undoBox!==box)return;button.remove();line.textContent=message;clearTimeout(undoTimer);undoTimer=setTimeout(()=>{if(undoBox===box)closeUndoNotice();},2400);};
  button.addEventListener('click',async()=>{
    if(undoBox!==box||button.disabled)return;
    clearTimeout(undoTimer);button.disabled=true;line.textContent='되돌리는 중…';
    let result;try{result=await onUndo();}catch{result={status:'unknown',message:RECORD_DELETE_TEXT.RESULT_UNKNOWN};}
    if(result?.status==='stale'){if(undoBox===box)closeUndoNotice();return;}
    finish(result?.message||RECORD_DELETE_TEXT.RESULT_UNKNOWN);
  });
  host.append(box);undoBox=box;undoTimer=setTimeout(()=>{if(undoBox===box)closeUndoNotice();},ms);
  return box;
}

// The four screens' disconnect: one confirmation, one row delete, then 5 seconds to undo.
// link = {id,note_id,organization_id|project_id,summary}; name = the place's name.
export async function disconnectWithUndo(link,{name='',rt=window.KPTURuntime,isCurrent=()=>true,onRestored=()=>{}}={}){
  const result=await disconnectRecordLink(link.id,{name,rt,isCurrent});
  if(result.status==='deleted'){
    const owner=scope(rt),kind=link.organization_id?'organization':'project';
    offerUndoNotice({text:`${String(name||'').trim()||'이'} 연결을 해제했어요. 업데이트는 남아요.`,onUndo:async()=>{
      if(owner!==scope(rt))return {status:'stale'};
      const restored=await restoreRecordLink({noteId:link.note_id,kind,targetId:link[kind+'_id'],summary:link.summary??null},{rt});
      if(restored.status==='restored')onRestored(restored);
      return restored;
    }});
  }
  return result;
}

// describe: the confirmation text for a row that is not a basket memo (JOURNAL-일기: "…일기를 지웁니다").
// keepFiles (a note): the owner-RLS REST delete only; the files stay in Drive (NOTE-파일붙이기).
export function deleteNoteOriginal(noteId,{rt=window.KPTURuntime,isCurrent=()=>true,fetcher=globalThis.fetch,waitMs,describe=noteDeleteConfirmText,keepFiles=false}={}){
  return remove('note',noteId,{rt,isCurrent,confirmText:async()=>{
    let info;try{info=await readNoteDeleteInfo(noteId,rt);}catch{return {status:'failed',message:RECORD_DELETE_TEXT.NOTE_READ_FAILED};}
    if(!info)return {status:'missing',message:RECORD_DELETE_TEXT.NOTE_MISSING};
    return {text:describe(info),info};
  },write:async({message:{info},expectedSessionEpoch,path})=>{
    if(keepFiles)return {status:'rest',message:info.attachments?NOTE_DOC_DELETED.files:NOTE_DOC_DELETED.plain};
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
      :{status:'deleted',message:'업데이트를 지웠어요. 첨부의 휴지통 이동 결과는 Drive에서 확인해 주세요.'};
  }catch{return {status:'unknown',message:RECORD_DELETE_TEXT.RESULT_UNKNOWN};}
}
