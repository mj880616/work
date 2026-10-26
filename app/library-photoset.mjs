// ACT-사진 4단계(결정 A): 자료실에서 사업 보고에 붙은 사진을 사업 보고마다 한 줄로 묶는 순수 규칙(DOM·네트워크 없음, 단위 시험 대상).
// 저장은 늘지 않는다. 사진 자료 행(app_documents)은 그대로 있고, 목록을 계산할 때만 한 줄(가짜 자료 한 건)로 접는다.
// 그림 판단·묶음·앞 3장 규칙은 담당조직·프로젝트 상세(5단계)와 같은 report-photos-model.mjs 를 쓴다.
import {groupReportPhotos,reportIdChunks,stripPlan} from './report-photos-model.mjs';
import {reportTitle} from './report-links-model.mjs';

export const PHOTOSET_PREFIX='photoset:';
export const isPhotoSet=d=>!!d?.photoset;

// 사업 보고에 붙은 그림 자료(Drive 파일이 있는 것)의 사업 보고 번호를 100개씩 묶는다(읽을 사업 보고를 정할 때 쓴다).
export function photoMeetingChunks(docs){
  const ids=[...new Set((Array.isArray(docs)?docs:[]).filter(d=>d?.meeting_id&&d.file_id).map(d=>d.meeting_id))];
  return reportIdChunks(ids.map(id=>({id})));
}
// 사업 보고 일시 → 사업 보고를 쓴 사람의 화면 날짜(YYYY-MM-DD).
export function localDay(iso){
  const t=new Date(iso||'');if(Number.isNaN(t.getTime()))return '';
  return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
}
const firstOf=(list,key)=>list.find(d=>d?.[key])?.[key]||null;

// docs: 자료실 자료 전체. meetings: Map(사업 보고 번호 → 사업 보고 행). 물어봤는데 없던 번호(휴지통)는 값이 null, 묻지 않은 번호는 키가 없다. 읽지 못했으면 null.
// 반환: 사업 보고에 붙은 그림은 사업 보고마다 한 건({photoset:true,…})으로 바꾼 자료 목록. 나머지(직접 올린 그림·그림 아닌 자료)는 그대로.
// - meetings 가 null(읽기 실패)이면 아무것도 접지 않는다(자료가 사라져 보이는 것보다 낫다).
// - 사업 보고가 휴지통이라 값이 null 이면 그 사진은 목록에서 빠진다(사업 보고와 함께 숨음). 자료실에 직접 올린 그림에는 영향 없음.
// - 묻지 않은 사업 보고(방금 자료를 다른 사업 보고에 옮긴 경우 등)의 사진은 건드리지 않고 한 장 한 줄로 둔다.
export function foldPhotoSets(docs,meetings){
  const list=Array.isArray(docs)?docs:[];
  if(!(meetings instanceof Map))return list;
  const attached=list.filter(d=>d?.meeting_id&&d.file_id&&meetings.has(d.meeting_id));
  const byMeeting=groupReportPhotos(attached);
  if(!byMeeting.size)return list;
  const photoIds=new Set([...byMeeting.values()].flat().map(p=>p.id));
  const rows=new Map();
  for(const d of attached)if(photoIds.has(d.id)){const r=rows.get(d.meeting_id)||[];r.push(d);rows.set(d.meeting_id,r)}
  const out=list.filter(d=>!photoIds.has(d?.id));
  for(const [meetingId,photos] of byMeeting){
    const m=meetings.get(meetingId);if(!m)continue; // null = 휴지통 사업 보고
    const mine=rows.get(meetingId)||[];
    out.push({
      id:PHOTOSET_PREFIX+meetingId,photoset:true,meeting_id:meetingId,
      photos:photos,plan:stripPlan(photos),count:photos.length,
      title:`사진 ${photos.length} · ${reportTitle(m)}`,
      // 목록 묶기·검색이 쓰는 칸은 사진 자료에서 가져온다. 검색은 사진 이름도 본다.
      file_name:photos[0].name,mime_type:'image/jpeg',tags:photos.map(p=>p.name),
      category:firstOf(mine,'category'),project_id:firstOf(mine,'project_id'),organization_id:firstOf(mine,'organization_id'),
      document_date:localDay(m.meeting_at)||firstOf(mine,'document_date'),created_at:m.meeting_at||firstOf(mine,'created_at')
    });
  }
  return out;
}
