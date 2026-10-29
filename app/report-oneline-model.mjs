// MTG-한줄업데이트(요청함 10/29 08:59, 명진 09:01 '추천대로'): 사업 보고 [+] 메뉴 맨 위 [한 줄 업데이트]의 규칙 한 곳(순수 함수, 시험 대상).
// 한 줄 업데이트 = 사업 보고 표(app_meetings)의 한 건: 칸 'oneline'(20261029160000), 사업영역 꼬리표(business_area_id) 필수, 날짜, 한 줄, 다음 할 일(선택).
// 기록은 사업 보고 한 곳에만(10/28 18:47 원칙). 주간보고 ② 사업 요약 표의 그 사업영역 '진행' 칸에 명진이 쓴 문장 그대로 들어가고(AI 요약 없음),
// ③ 회의·활동 결과에는 넣지 않는다(겹침 방지). 그 꼬리표 사업영역에 '연결'도 하나 만들어 사업영역 관리(프로젝트 상세)의 사업 보고 목록에 보인다.
import {ONELINE_KIND} from './report-kinds.mjs';
import {nextPlanValue} from './business-area-model.mjs';

export const ONELINE_MAX = 500;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// 한 줄: 줄바꿈·겹친 공백은 한 칸으로, 앞뒤 공백 없이. 비면 '', 한도를 넘으면 오류.
export function onelineText(text) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (value.length > ONELINE_MAX) throw Object.assign(new Error(`한 줄은 ${ONELINE_MAX}자까지 쓸 수 있어요.`), {code:'too_long'});
  return value;
}
// 날짜(서울 'YYYY-MM-DD') → 그날 서울 0시. 0시는 '시각 없음'으로 보이므로(meeting-when.js) 목록·주간보고에 시각이 붙지 않는다.
export function onelineAt(day) {
  if (!DAY.test(String(day || ''))) return '';
  const t = Date.parse(`${day}T00:00:00+09:00`);
  return Number.isFinite(t) ? new Date(t).toISOString() : '';
}
// 저장 확인: 빠진 칸이 있으면 화면 글자, 없으면 ''.
export function onelineMissing({areaId, day, text}) {
  if (!areaId) return '사업영역을 골라 주세요.';
  if (!onelineAt(day)) return '날짜를 골라 주세요.';
  if (!onelineText(text)) return '한 줄을 써 주세요.';
  return '';
}
// app_meetings POST 몸통. 다른 칸의 사업 보고와 같은 칸만 쓴다(제목 = 회의명 칸 = 한 줄, 원문·특이사항 빈 글).
export function onelineBody({workspaceId, userId, areaId, day, text, plan, now = new Date()}) {
  const line = onelineText(text);
  return {
    workspace_id:workspaceId, activity_kind:ONELINE_KIND, project_id:null, business_area_id:String(areaId),
    next_plan:nextPlanValue(plan), title:line, series_name:line, round_no:null, meeting_at:onelineAt(day),
    notes:'', transcript_text:'', result_status:'final', finalized_at:now.toISOString(), created_by:userId,
  };
}
