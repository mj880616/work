// 바구니 연결 해제와 메모 원문 삭제는 조직·프로젝트 상세와 바구니 읽기 화면이 이 모듈 하나로 처리한다.
// 기존 owner RLS(notes_owner_all·record_links_owner_all)만 사용한다. 메모를 지우면
// app_record_links.note_id의 on delete cascade로 그 메모의 연결도 함께 지워진다.
// 첨부 파일은 Drive에 남는다(Drive 휴지통 이동은 서버 함수 변경이 필요해 이 모듈 범위 밖).
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
  RESULT_UNKNOWN:'결과를 확인하지 못했어요. 목록을 다시 불러와 실제 상태를 확인해 주세요.',
  BUSY:'처리 중이에요. 잠시 기다려 주세요.',
});

export function noteDeleteConfirmText({places=0,otherLinks=0,attachments=0}={}){
  return ['메모 원문을 지웁니다.',
    `연결된 조직·프로젝트 ${places}곳에서도 사라집니다.`,
    otherLinks?`회의·자료실 연결 ${otherLinks}곳도 함께 사라집니다.`:'',
    `첨부 파일 ${attachments}개는 Drive에 남습니다.`,
    '되돌릴 수 없습니다.'].filter(Boolean).join(' ');
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
  const notes=await rt.api(`/rest/v1/app_notes?id=eq.${encode(noteId)}&workspace_id=eq.${encode(workspaceId)}&select=id,attachments`,{expectedSessionEpoch});
  if(!Array.isArray(notes))throw Error('unexpected');
  const note=notes.find(row=>row.id===noteId);if(!note)return null;
  const links=[];
  for(let offset=0;;offset+=PAGE_SIZE){
    const page=await rt.api(`/rest/v1/app_record_links?workspace_id=eq.${encode(workspaceId)}&note_id=eq.${encode(noteId)}&status=eq.confirmed&select=id,organization_id,project_id&order=id.asc&limit=${PAGE_SIZE}&offset=${offset}`,{expectedSessionEpoch});
    if(!Array.isArray(page))throw Error('unexpected');
    links.push(...page);if(page.length<PAGE_SIZE)break;
  }
  const places=links.filter(link=>link.organization_id||link.project_id).length;
  return {places,otherLinks:links.length-places,attachments:Array.isArray(note.attachments)?note.attachments.length:0};
}

// Shared outcome shape: deleted | missing | failed | unknown | cancelled | busy | stale.
// A thrown write is never guessed: the row is read again to report the real state.
async function remove(kind,id,{rt,isCurrent,confirmText}){
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
    let status;
    try{
      const rows=await rt.api(path,{method:'DELETE',prefer:'return=representation',expectedSessionEpoch});
      status=Array.isArray(rows)&&rows.some(row=>row?.id===id)?'deleted':Array.isArray(rows)&&!rows.length?'missing':'unknown';
    }catch{
      try{status=await exists(path,rt,expectedSessionEpoch)?'failed':'deleted';}catch{status='unknown';}
    }
    if(status!=='failed')notify();
    if(!current())return {status:'stale'};
    return {status,message:text[status]??RECORD_DELETE_TEXT.RESULT_UNKNOWN};
  }finally{pending.delete(key);}
}

export function disconnectRecordLink(linkId,{kind='organization',rt=window.KPTURuntime,isCurrent=()=>true}={}){
  return remove('link',linkId,{rt,isCurrent,confirmText:async()=>({text:DISCONNECT_CONFIRM_TEXT[kind]||DISCONNECT_CONFIRM_TEXT.organization})});
}

export function deleteNoteOriginal(noteId,{rt=window.KPTURuntime,isCurrent=()=>true}={}){
  return remove('note',noteId,{rt,isCurrent,confirmText:async()=>{
    let info;try{info=await readNoteDeleteInfo(noteId,rt);}catch{return {status:'failed',message:RECORD_DELETE_TEXT.NOTE_READ_FAILED};}
    if(!info)return {status:'missing',message:RECORD_DELETE_TEXT.NOTE_MISSING};
    return {text:noteDeleteConfirmText(info)};
  }});
}
