// 자료실과 회의 상세는 같은 확인·요청·오류 안내를 사용한다.
export function luDeleteErrorMessage(e){if(e?.code==='session_required'||e?.status===401)return '로그인 세션이 만료됐습니다. 다시 로그인한 뒤 삭제해 주세요.';if(/token has been expired or revoked|invalid_grant/i.test(String(e?.message||'')))return 'Google Drive 연결이 만료됐습니다. 관리자에게 Drive 재연결을 요청해 주세요. 자료 기록은 삭제되지 않았습니다.';return '자료를 삭제하지 못했습니다. 관리자에게 오류 확인을 요청해 주세요.'}

async function maybeReconnectDrive(e,api,role){
  if(!(e?.status===424||/token has been expired or revoked|invalid_grant|Google Drive 토큰 갱신/i.test(String(e?.message||'')))||!['owner','admin'].includes(role))return false;
  if(!confirm('Google Drive 연결이 만료됐습니다. 지금 관리자 계정을 다시 연결할까요?\n재연결 후 같은 작업을 다시 실행하면 됩니다.'))return false;
  try{const d=await api('/functions/v1/public-policy-drive',{method:'POST',body:{action:'drive-start'}});const url=d?.url||d?.auth_url;if(!url)throw new Error('Google Drive 연결 주소를 받지 못했습니다.');location.href=url;return true}catch(err){alert(err.message||String(err));return false}
}

export async function deleteDocument(d,{api,role,maybeReconnect}={}){
  if(!d||!confirm(`“${d.file_name||d.title}” 파일을 삭제할까요?\nDrive 휴지통으로 이동합니다. Drive 휴지통에서 30일 안에 복구할 수 있습니다.`))return false;
  try{
    const data=await api('/functions/v1/document-actions',{method:'POST',body:{action:'delete',document_id:d.id}});
    if(data?.error)throw new Error(data.error||'삭제 실패');
  }catch(e){
    console.error('library document deletion failed',e);
    if(!(await (maybeReconnect?maybeReconnect(e):maybeReconnectDrive(e,api,role))))alert(luDeleteErrorMessage(e));
    return false;
  }
  window.dispatchEvent(new CustomEvent('kptu:documents-changed',{detail:{project_id:d.project_id||null,meeting_id:d.meeting_id||null}}));
  return true;
}
