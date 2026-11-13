// MULTI-노조사용자 ②-3(D5) → MULTI-다른담당자맞춤 ②: 내 프로필 '주간보고 일정 캘린더' 칸의 값 검사(view-prefs.js report_calendar).
// 묶음·제외 글자 칸은 없앴다(조직 보고 화면에서 바로 — org-order-edit.mjs).
import {reportCalendarOk} from './view-prefs.js';

export function parseCalendar(text) {
  const name = String(text ?? '').trim();
  if (!name) return {ok:true, value:null};
  return reportCalendarOk(name) ? {ok:true, value:name} : {ok:false, error:'주간보고 일정 캘린더 이름은 1~60자예요.'};
}
