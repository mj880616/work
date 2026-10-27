// LIB-줄안이름바꾸기: 자료실 줄 안에서 제목만 바꿀 때 서버에 보낼 값(순수 함수, 화면·네트워크 없음).
// 저장은 [수정] 창과 같은 서버 길(app_documents PATCH, 소유자 RLS)이고, 제목 칸은 사용자 값('user')으로 기록해
// AI 자동 정리(ai-assist library_fill/tidy)가 다시 바꾸지 않게 한다. Drive 원본 파일 이름은 건드리지 않는다.
import {originAfterEdit} from './library-ai-fill.js';

export const RENAME_NOTE='사용자 수정';

// 새 제목 저장 값. [수정] 창 저장(luSaveEdit)과 같은 표시: auto_classified=false, classification_note, field_origin.title='user'.
export function renameBody(doc,title,now=new Date().toISOString()){
  const body={title,updated_at:now,auto_classified:false,classification_note:RENAME_NOTE};
  const origin=originAfterEdit(doc,['title']);
  if(origin)body.field_origin=origin;
  return body;
}

// 되돌리기용: 바꾸기 전 값. 제목이 비어 있던 자료는 파일 이름으로 돌린다(제목은 목록에 늘 보이는 값).
export function undoSnapshot(doc){
  return {
    title:doc.title||doc.file_name||'',
    auto_classified:doc.auto_classified??false,
    classification_note:doc.classification_note??null,
    ...(Object.hasOwn(doc,'field_origin')?{field_origin:doc.field_origin}:{}),
  };
}
export function undoBody(snapshot,now=new Date().toISOString()){return {...snapshot,updated_at:now}}

// 저장 응답이 보낸 값과 같은지(updated_at은 서버가 정함).
export function rowMatches(row,body){
  return Object.entries(body).every(([key,value])=>key==='updated_at'||value===undefined||JSON.stringify(row?.[key])===JSON.stringify(value));
}
