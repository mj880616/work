// BASKET-4b-1 C: send a basket note attachment to the library as a second
// reference to the same Drive file (server: document-actions
// register-basket-attachment). Nothing is copied and nothing is retried here.
// A 400-class refusal changed nothing; any other failure (timeout, 5xx, lost
// response) is an unknown result that the person checks in the library.
const OLD_SERVER=new Set(['document_id가 필요합니다.','Unknown action']);
export const LIBRARY_SEND_TEXT={
  created:'자료실로 보냈어요. 정리함과 같은 Drive 원본을 씁니다.',
  exists:'이미 자료실에 있어요.',
  unknown:'자료실로 보냈는지 확인하지 못했어요. 다시 보내지 말고 자료실 목록에서 먼저 확인해 주세요.',
  notReady:'자료실 보내기가 아직 준비되지 않았어요. 아무것도 바뀌지 않았어요.',
  session:'로그인을 확인하지 못했어요. 다시 로그인한 뒤 보내 주세요. 아무것도 바뀌지 않았어요.',
  refused:'자료실로 보내지 못했어요. 아무것도 바뀌지 않았어요.',
};
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function librarySendOutcome({data,error}){
  if(error){
    const status=Number(error.status)||0;
    if(status===401||error.code==='session_required')return {kind:'session',message:LIBRARY_SEND_TEXT.session};
    if(status===400){
      const reason=String(error.message||'');
      if(OLD_SERVER.has(reason))return {kind:'refused',message:LIBRARY_SEND_TEXT.notReady};
      return {kind:'refused',message:[LIBRARY_SEND_TEXT.refused,reason].filter(Boolean).join(' ')};
    }
    // The gateway refuses these before the function runs.
    if([403,404,405].includes(status))return {kind:'refused',message:LIBRARY_SEND_TEXT.notReady};
    return {kind:'unknown',message:LIBRARY_SEND_TEXT.unknown};
  }
  if(plain(data)&&data.ok===true&&['created','exists'].includes(data.result)&&plain(data.document)&&typeof data.document.id==='string'&&data.document.id)
    return {kind:data.result,message:LIBRARY_SEND_TEXT[data.result],document:{id:data.document.id,title:String(data.document.title??'')}};
  return {kind:'unknown',message:LIBRARY_SEND_TEXT.unknown};
}
export async function sendAttachmentToLibrary(noteId,fileId,{rt=window.KPTURuntime,expectedSessionEpoch=null}={}){
  try{
    // refreshSession:false: a 401 is reported, never followed by a second send.
    const data=await rt.api('/functions/v1/document-actions',{method:'POST',body:{action:'register-basket-attachment',note_id:noteId,drive_file_id:fileId},refreshSession:false,singleFlight:false,...(expectedSessionEpoch==null?{}:{expectedSessionEpoch})});
    return librarySendOutcome({data});
  }catch(error){return librarySendOutcome({error});}
}
// One-shot in-app hand-off to the library view: the library shows this
// document's row once it has loaded. Bound to the signed-in user and
// workspace and expires quickly, like the basket and task hand-offs.
const REVEAL_MS=60*1000;
let revealRequest=null;
const revealScope=rt=>{const c=rt?.context?.read?.();return c?.user?.id&&c?.workspace?.id?`${c.user.id}:${c.workspace.id}`:'';};
export function requestLibraryDocument(id,rt=window.KPTURuntime){const scope=revealScope(rt);revealRequest=typeof id==='string'&&id&&scope?{id,scope,at:Date.now()}:null;}
export function takeLibraryDocumentRequest(rt=window.KPTURuntime){const value=revealRequest;revealRequest=null;return value&&value.scope===revealScope(rt)&&Date.now()-value.at<REVEAL_MS?value.id:null;}
export const libraryHref='./?view=library';
