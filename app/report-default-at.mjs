// MTG-보고창기본일시: 사업 보고 새 입력 창의 [일시] 기본값을 정하는 유일한 곳(순수 규칙, 네트워크·브라우저 없음).
// 새 창을 여는 모든 길이 team.js openMeetingModal 하나로 들어오므로, 길마다 따로 채우지 않고 여기서만 정한다.
// 저장된 보고를 고치는 창(meeting-round-detail.js)은 원래 일시를 그대로 쓰므로 이 규칙을 쓰지 않는다.
import {seoulDateKey} from './meeting-time.js';

export const DEFAULT_REPORT_TIME='10:00';
const DATE=/^\d{4}-\d{2}-\d{2}$/, DATETIME=/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;

// at: 날짜와 시간이 다 있는 값('2026-10-27T14:30', 구글 일정). date: 날짜만 있는 값('2026-10-27', 달력 빈칸·종일 일정).
// 아무것도 없거나 읽을 수 없으면 오늘(한국 날짜) 10:00. now는 시험용.
export function defaultReportAt({at='',date='',now=new Date()}={}){
  const full=DATETIME.exec(String(at||''));
  if(full)return `${full[1]}T${full[2]}`;
  const day=DATE.test(String(date||''))?String(date):DATE.test(String(at||''))?String(at):'';
  return `${day||seoulDateKey(now)}T${DEFAULT_REPORT_TIME}`;
}
