// 자료실과 회의 상세는 같은 확인·요청·오류 안내를 사용한다.
const unknownDeleteMessage='삭제 결과를 확인하지 못했습니다. 다시 삭제하지 말고 자료실 목록 또는 사업 보고 자료를 다시 열어 확인해 주세요. Drive 원본 상태도 직접 확인해 주세요.';
const pendingDeletes=new Map();
const modernFields=['drive_result','drive_preserved','reason'];
const deletePhases=['token_delete_result','document_delete_result'];
const hasField=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);

function unconfirmedOutcome(e){
  return ['RESULT_UNKNOWN','DOCUMENT_CHANGED','BASKET_ORIGIN_UNKNOWN'].includes(e?.code)||
    ['unknown','partial'].includes(e?.drive_result)||
    deletePhases.some(key=>e&&hasField(e,key)&&e[key]!=='confirmed');
}
function sessionError(e){return e?.code==='session_required'||e?.status===401}
function driveAuthError(e){return e?.status===424||/token has been expired or revoked|invalid_grant|Google Drive 토큰 갱신/i.test(String(e?.message||''))}

export function luDeleteErrorMessage(e){
  // HTTP errors from the runtime do not carry the server's deletion phases.
  if(unconfirmedOutcome(e))return unknownDeleteMessage;
  if(sessionError(e))return '로그인 세션을 확인하지 못했습니다. 다시 로그인한 뒤 자료 목록과 원본 상태를 먼저 확인해 주세요.';
  if(driveAuthError(e))return 'Google Drive 연결을 확인해 주세요. 다시 삭제하기 전에 자료 목록과 원본 상태를 먼저 확인해 주세요.';
  return unknownDeleteMessage;
}

export function luDeleteSuccessMessage(data){
  if(!data||typeof data!=='object'||Array.isArray(data)||data.ok!==true||data.error||unconfirmedOutcome(data))return null;
  if(modernFields.every(key=>!hasField(data,key)))return '자료 등록을 삭제했습니다. Drive 파일 처리 결과는 확인하지 못했습니다. 원본 상태를 직접 확인해 주세요.';
  if(!modernFields.every(key=>hasField(data,key)))return null;
  if(data.drive_result==='preserved'&&data.drive_preserved===true&&['note_reference','private_basket_original'].includes(data.reason))return '자료 등록을 삭제했습니다. 정리함 원본 파일은 Drive에 보존했습니다.';
  if(data.drive_preserved!==false||data.reason!=='ordinary_library')return null;
  switch(data.drive_result){
    case 'trashed':return '자료 등록을 삭제하고 파일을 Drive 휴지통으로 이동했습니다. 파일은 Drive 휴지통에서 확인해 주세요.';
    case 'already_trashed':return '자료 등록을 삭제했습니다. 파일은 이미 Drive 휴지통에 있었습니다.';
    case 'missing':return '자료 등록을 삭제했습니다. 연결된 Drive 파일은 찾을 수 없었습니다.';
    case 'no_file':return '자료 등록을 삭제했습니다. 이 자료에 연결된 Drive 파일 ID는 없었습니다.';
    default:return null;
  }
}

async function maybeReconnectDrive(e,api,role,{isCurrent,expectedSessionEpoch}){
  if(!isCurrent()||!driveAuthError(e)||!['owner','admin'].includes(role))return false;
  if(!confirm('Google Drive 연결이 만료됐습니다. 지금 관리자 계정을 다시 연결할까요?\n재연결 후 자료 목록과 원본 상태를 먼저 확인해 주세요.')||!isCurrent())return false;
  try{
    const d=await api('/functions/v1/public-policy-drive',{method:'POST',body:{action:'drive-start'},expectedSessionEpoch});
    if(!isCurrent())return false;
    const url=d?.url||d?.auth_url;
    if(!url)throw new Error('Google Drive 연결 주소를 받지 못했습니다.');
    location.href=url;
    return true;
  }catch(err){if(isCurrent())alert(luDeleteErrorMessage(err));return false}
}

// bulk에 {}를 넘기면(LIB-여러개삭제) 확인·안내 창 없이 같은 서버 요청만 보내고, 결과를 bulk.ok / bulk.stop(로그인·Drive 문제로 멈춰야 함)에 적는다.
export async function deleteDocument(d,{api,role,maybeReconnect,expectedSessionEpoch=null,isCurrent=()=>true,bulk=null}={}){
  if(!d||!isCurrent())return false;
  const {id,project_id,meeting_id}=d;
  // Only concurrent calls share this lock; it is neither a retry record nor
  // proof of idempotency. An attempt may release only its own pending token.
  let documents=pendingDeletes.get(expectedSessionEpoch);
  if(documents?.has(id))return false;
  if(!documents){documents=new Map();pendingDeletes.set(expectedSessionEpoch,documents)}
  const token={};
  documents.set(id,token);
  try{
    if(!isCurrent()||(!bulk&&!confirm(`“${d.file_name||d.title}” 자료 등록을 삭제할까요?\n파일도 Drive 휴지통으로 이동할 수 있습니다. 삭제 결과에서 원본 보존 여부를 확인해 주세요.`))||!isCurrent())return false;
    let data;
    try{
      data=await api('/functions/v1/document-actions',{method:'POST',body:{action:'delete',document_id:id},refreshSession:false,expectedSessionEpoch});
      if(!isCurrent())return false;
      if(data?.error){
        const error=new Error(String(data.error));
        // Preserve safe received fields only. Real HTTP400 RuntimeErrors do
        // not contain these fields, so their absence never certifies no writes.
        for(const key of ['status','code','drive_result',...deletePhases])if(hasField(data,key))error[key]=data[key];
        throw error;
      }
    }catch(e){
      if(!isCurrent())return false;
      if(bulk){bulk.stop=sessionError(e)||driveAuthError(e);return false}
      alert(luDeleteErrorMessage(e));
      if(!isCurrent())return false;
      if(!unconfirmedOutcome(e)&&!sessionError(e)&&driveAuthError(e)){
        const scope={isCurrent,expectedSessionEpoch};
        try{await (maybeReconnect?maybeReconnect(e,scope):maybeReconnectDrive(e,api,role,scope))}
        catch(err){if(isCurrent())alert(luDeleteErrorMessage(err))}
        if(!isCurrent())return false;
      }
      return false;
    }
    const message=luDeleteSuccessMessage(data);
    if(!isCurrent())return false;
    if(bulk){if(!message)return false;bulk.ok=true;return true}
    alert(message||unknownDeleteMessage);
    if(!message||!isCurrent())return false;
    window.dispatchEvent(new CustomEvent('kptu:documents-changed',{detail:{project_id:project_id||null,meeting_id:meeting_id||null}}));
    return isCurrent();
  }finally{
    if(documents.get(id)===token)documents.delete(id);
    if(!documents.size&&pendingDeletes.get(expectedSessionEpoch)===documents)pendingDeletes.delete(expectedSessionEpoch);
  }
}
