// ORG-자료올리기: 담당조직 상세의 자료 [+]가 자료실 올리기(library-upload.js)를 그대로 쓰도록 하는 작은 부품.
// 파일 올리기·AI 분류는 프로젝트 상세와 같은 자료실 흐름이 하고, 여기서는 올라온 자료 행을 이 조직에 붙이는 일만 한다.
// 붙이기는 자료실 [정보 수정]·바구니 연결(basket-file-docs.js)과 같은 app_documents.organization_id 수정(소유자 RLS)이다.
// 서버(Edge·DB) 변경은 없다.
export function normalizeUploadOrganization(value){
  const id=typeof value?.id==='string'?value.id.trim():'';
  return id?{id,name:String(value?.name||'').trim()}:null;
}
export function uploadOrganizationLabel(org){
  return org?`담당조직 ‘${org.name||'이름 없음'}’ 자료로 바로 연결돼요`:'';
}
// 올라온 자료 한 건을 조직에 붙인다. 결과를 확인하지 못하면 false(자료는 자료실에 이미 있다).
export async function linkUploadedDocument(rt,{documentId,workspaceId,organizationId}){
  if(!documentId||!workspaceId||!organizationId)return false;
  try{
    const rows=await rt.api(`/rest/v1/app_documents?id=eq.${encodeURIComponent(documentId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,organization_id`,{method:'PATCH',body:{organization_id:organizationId,updated_at:new Date().toISOString()},prefer:'return=representation'});
    return Array.isArray(rows)&&rows.length===1&&rows[0]?.id===documentId&&rows[0]?.organization_id===organizationId;
  }catch{return false}
}
