// S51-27 UI-PC우클릭: 달력 우클릭 메뉴에 들어갈 항목 목록(DOM 없음). 항목은 달력이 이미 가진 기능만 부른다.
// 일정: 수정 창과 같은 길(calendar-interactions-v2.js KPTUCalendarEvents.act — edit·orgs·report·delete). 삭제는 맨 아래 한 줄(빨강 없음, 묻기는 수정 창의 삭제와 같음).
// 쓰기 권한이 없는 캘린더는 [열기]만(수정 창의 규칙 canDrag).
// 날짜 칸: [이날 일정 등록] = 빈 칸 누름과 같은 일정 등록 창, [이날 할 일] = 같은 창의 할 일 쪽, [이날 하루 보기] = 날짜 숫자 누름과 같은 그날 창.
export function eventMenuItems(writable) {
  if (!writable) return [{id: 'edit', label: '열기'}];
  return [{id: 'edit', label: '수정'}, {id: 'orgs', label: '담당조직 연결'}, {id: 'report', label: '결과 남기기'}, {id: 'delete', label: '삭제', last: true}];
}
export const DAY_MENU_ITEMS = Object.freeze([{id: 'event', label: '이날 일정 등록'}, {id: 'task', label: '이날 할 일'}, {id: 'day', label: '이날 하루 보기'}]);
// 'YYYY-MM-DD' → 메뉴 머리 '11월 10일 (화)'. 날짜가 아니면 ''.
export function dayMenuTitle(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCDate() !== +m[3]) return '';
  return `${+m[2]}월 ${+m[3]}일 (${'일월화수목금토'[d.getUTCDay()]})`;
}
