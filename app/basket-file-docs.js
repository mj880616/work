import {sendAttachmentToLibrary} from './basket-library-send.js';

// UI-바구니첨부메모 ⑦⑧: 바구니 첨부를 프로젝트 "자료로 넣기". 파일은 Drive에 하나뿐이다.
// 자료실 등록은 기존 [자료실로 보내기](document-actions register-basket-attachment, 같은 파일은 다시 만들지 않음)를,
// 프로젝트에 붙이기는 자료실 [정보 수정]과 같은 app_documents.project_id 수정(owner RLS)을 그대로 쓴다.
// 자료 하나는 프로젝트 하나에만 붙으므로 다른 프로젝트에 있던 자료는 옮겨진다(2026-10-18 사용자 수용).
const DRIVE_ID=/^[A-Za-z0-9_-]{1,255}$/;
export const FILE_DOCS_TEXT=Object.freeze({
  unknown:'자료로 넣었는지 확인하지 못했어요. 자료실에서 먼저 확인해 주세요.',
  refused:'자료로 넣지 못했어요.',
});
const workspaceOf=rt=>rt?.context?.read?.()?.workspace?.id||'';

// 이 첨부들이 이미 자료실에 있는지(같은 Drive 파일로 등록된 자료). 같은 파일이 여러 번 있으면 먼저 등록된 것.
export async function readAttachmentDocuments(files,{rt=window.KPTURuntime}={}){
  const ids=[...new Set((files||[]).map(file=>String(file?.drive_file_id||'')).filter(id=>DRIVE_ID.test(id)))];
  const workspace=workspaceOf(rt),found=new Map();
  if(!ids.length||!workspace)return found;
  const rows=await rt.api(`/rest/v1/app_documents?workspace_id=eq.${encodeURIComponent(workspace)}&file_id=in.(${ids.join(',')})&select=id,title,project_id,file_id,category&order=created_at.asc`);
  for(const row of Array.isArray(rows)?rows:[])if(ids.includes(row?.file_id)&&!found.has(row.file_id))found.set(row.file_id,{id:row.id,title:row.title,project_id:row.project_id||null});
  return found;
}

// 파일마다: 자료실에 없으면 등록 → 그 자료의 프로젝트를 projectId로. 결과를 모르면 거기서 멈추고 다시 보내지 않는다.
export async function putFilesIntoProject({noteId,files,projectId,known=new Map(),rt=window.KPTURuntime,expectedSessionEpoch=null,isCurrent=()=>true}){
  const workspace=workspaceOf(rt),docs=new Map();let placed=0,changed=false;
  const announce=()=>{if(changed)window.dispatchEvent(new CustomEvent('kptu:documents-changed',{detail:{project_id:projectId}}));};
  const stop=(kind,message)=>{if(kind!=='stale')announce();return {ok:false,kind,message,placed,docs};};
  for(const file of files||[]){
    const fileId=String(file?.drive_file_id||'');if(!DRIVE_ID.test(fileId))continue;
    let doc=known.get(fileId)||null;
    if(!doc){
      const sent=await sendAttachmentToLibrary(noteId,fileId,{rt,expectedSessionEpoch});
      if(!isCurrent())return stop('stale','');
      if(sent.kind==='unknown')return stop('unknown',FILE_DOCS_TEXT.unknown);
      if(!['created','exists'].includes(sent.kind))return stop('refused',sent.message||FILE_DOCS_TEXT.refused);
      doc={id:sent.document.id,title:sent.document.title,project_id:undefined};
      if(sent.kind==='created')window.dispatchEvent(new CustomEvent('kptu:documents-changed',{detail:{project_id:null,meeting_id:null}}));
    }
    if(doc.project_id!==projectId){
      let rows;
      try{
        rows=await rt.api(`/rest/v1/app_documents?id=eq.${encodeURIComponent(doc.id)}&workspace_id=eq.${encodeURIComponent(workspace)}&select=id,project_id,file_id`,{method:'PATCH',body:{project_id:projectId,updated_at:new Date().toISOString()},prefer:'return=representation',...(expectedSessionEpoch==null?{}:{expectedSessionEpoch})});
      }catch(error){
        if(!isCurrent())return stop('stale','');
        const status=Number(error?.status)||0;
        return status>=400&&status<500?stop('refused',FILE_DOCS_TEXT.refused):stop('unknown',FILE_DOCS_TEXT.unknown);
      }
      if(!isCurrent())return stop('stale','');
      if(!Array.isArray(rows)||rows.length!==1||rows[0]?.id!==doc.id||rows[0]?.project_id!==projectId)return stop('unknown',FILE_DOCS_TEXT.unknown);
      changed=true;
    }
    docs.set(fileId,{...doc,project_id:projectId});placed++;
  }
  announce();
  return {ok:true,kind:'done',message:'',placed,docs};
}
