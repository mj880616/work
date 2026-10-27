// LIB-여러개삭제: 자료실 여러 개 고르기·차례로 지우기의 순수 부분(화면·네트워크 없음).
// 지우기 자체는 하나씩 삭제와 같은 서버 경로(document-delete.js)를 부르는 deleteOne이 한다.

// 노드(폴더·묶음) 아래 모든 자료 id(하위 토글 포함, 중복 없음).
export function nodeDocumentIds(node){
  const out=new Set();
  // 사업 보고 사진 묶음 줄(photoset)은 고를 수 없다(ACT-사진 4단계).
  const walk=n=>{for(const d of n?.files||[])if(!d.photoset)out.add(d.id);for(const c of n?.children||[])walk(c)};
  walk(node);
  return [...out];
}
// 켜 있으면 모두 끄고, 아니면 모두 켠다(칩 하나로 선택·해제). ids는 지금 화면에 보이는 자료.
export function toggleAll(selected,ids){
  const all=ids.length>0&&ids.every(id=>selected.has(id));
  const next=new Set(selected);
  for(const id of ids){if(all)next.delete(id);else next.add(id)}
  return next;
}
export const allSelected=(selected,ids)=>ids.length>0&&ids.every(id=>selected.has(id));
export const someSelected=(selected,ids)=>ids.some(id=>selected.has(id))&&!allSelected(selected,ids);
// 폴더 한 줄의 칸: 그 안 자료가 모두 골라져 있으면 해제, 아니면 모두 선택.
export const toggleGroup=toggleAll;
// 화면에서 사라진 자료는 고른 목록에서 뺀다.
export function pruneSelected(selected,visibleIds){const keep=new Set(visibleIds);return new Set([...selected].filter(id=>keep.has(id)))}

// 차례로(한 번에 하나) 지운다. deleteOne(id)는 {ok:true} 또는 {ok:false,stop?:true}를 돌려준다.
// stop(로그인·Drive 연결 문제)이면 남은 것은 요청하지 않고 멈춘다. 반환: {done:[], failed:[], skipped:[]}.
export async function deleteSequentially(ids,deleteOne,{isCurrent=()=>true,onProgress=null}={}){
  const done=[],failed=[],skipped=[];
  for(let i=0;i<ids.length;i++){
    if(!isCurrent()){skipped.push(...ids.slice(i));break}
    let r;
    try{r=await deleteOne(ids[i])}catch{r={ok:false}}
    if(r?.ok)done.push(ids[i]);else failed.push(ids[i]);
    onProgress?.({index:i+1,total:ids.length});
    if(!r?.ok&&r?.stop){skipped.push(...ids.slice(i+1));break}
  }
  return {done,failed,skipped};
}
export const confirmText=n=>`${n}개를 지울까요?\nDrive 파일은 휴지통으로 이동해요(30일 뒤 사라짐).`;
export function resultText({done,failed,skipped}){
  if(!failed.length&&!skipped.length)return `${done.length}개를 지웠어요.`;
  const left=failed.length+skipped.length;
  return `${done.length}개를 지웠고 ${left}개는 지우지 못했어요. 남은 ${left}개는 그대로 골라 두었어요. 자료 목록과 Drive 원본 상태를 확인한 뒤 다시 시도해 주세요.`;
}
