// ACT-사진 5단계: 담당조직·프로젝트 상세의 사업 보고 줄에 붙일 작은 그림의 순수 규칙(DOM·네트워크 없음, 단위 시험 대상).
// 사진은 사업 보고 첨부(app_documents.meeting_id)다. 그림인지는 자료실 '그림' 판단(library-tree.js fileKindOf)과 같은 함수 하나로 가른다.
import {fileKindOf} from './library-tree.js';

export const STRIP_LIMIT=3; // 결정 C: 작은 그림 3장 + '외 n장'
export const IDS_PER_READ=100; // 한 번에 묻는 사업 보고 수(주소 길이 한도 안). 보통 한 번으로 끝난다.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 사업 보고 줄들 → 묻는 번호 묶음(중복·잘못된 번호 제외, IDS_PER_READ개씩).
export function reportIdChunks(reports,size=IDS_PER_READ){
  const ids=[...new Set((Array.isArray(reports)?reports:[]).map(r=>r?.id).filter(id=>typeof id==='string'&&UUID.test(id)))];
  const out=[];for(let i=0;i<ids.length;i+=size)out.push(ids.slice(i,i+size));
  return out;
}
// 자료 줄들 → {사업 보고 번호: [그림 자료…]}. 그림만, 올린 순서(created_at, 같으면 받은 순서) 그대로.
export function groupReportPhotos(docs){
  const map=new Map();
  (Array.isArray(docs)?docs:[]).map((d,i)=>({d,i})).filter(({d})=>d?.id&&d.meeting_id&&fileKindOf(d.file_name,d.mime_type)==='그림')
    .sort((a,b)=>String(a.d.created_at||'').localeCompare(String(b.d.created_at||''))||a.i-b.i)
    .forEach(({d})=>{const list=map.get(d.meeting_id)||[];list.push({id:d.id,name:d.file_name||d.title||'',mime:d.mime_type||''});map.set(d.meeting_id,list)});
  return map;
}
// 한 줄에 보일 것: 앞 3장 + 나머지 수. 그림이 없으면 null(줄은 지금 그대로).
export function stripPlan(list){
  const photos=Array.isArray(list)?list:[];
  return photos.length?{shown:photos.slice(0,STRIP_LIMIT),more:Math.max(0,photos.length-STRIP_LIMIT),total:photos.length}:null;
}
export const moreLabel=plan=>plan&&plan.more>0?`외 ${plan.more}장`:'';
