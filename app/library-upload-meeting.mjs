// MEET-파일AI분류: 사업 보고 상세·새 사업 보고가 자료실 올리기(library-upload.js)를 쓸 때 대상 사업 보고를 다듬는 작은 부품(순수 함수).
// 올라온 자료는 library-files의 meeting_id 칸으로 그 사업 보고에 붙는다. 서버(Edge·DB) 변경은 없다.
export function normalizeUploadMeeting(value){
  const id=typeof value?.id==='string'?value.id.trim():'';
  if(!id)return null;
  const projectId=typeof value?.project_id==='string'&&value.project_id.trim()?value.project_id.trim():(typeof value?.projectId==='string'&&value.projectId.trim()?value.projectId.trim():'');
  return {id,name:String(value?.name||'').trim(),projectId};
}
export function uploadMeetingLabel(meeting){
  return meeting?`사업 보고 ‘${meeting.name||'이름 없음'}’ 자료로 바로 연결돼요`:'';
}
