// S51-27 UI-PC우클릭: 달력 우클릭 메뉴에 들어갈 항목 목록(DOM 없음). 항목은 달력이 이미 가진 기능만 부른다.
// 일정: 수정 창과 같은 길(calendar-interactions-v2.js KPTUCalendarEvents.act — edit·orgs·report·delete). 삭제는 맨 아래 한 줄(빨강 — S51-31, 묻기는 수정 창의 삭제와 같음).
// 쓰기 권한이 없는 캘린더는 [열기]만(수정 창의 규칙 canDrag) — '보고할 일정' 표시는 Web2 서버에만 적으므로 거기에도 둔다.
// 날짜 칸: [이날 일정 등록] = 빈 칸 누름과 같은 일정 등록 창, [이날 할 일] = 같은 창의 할 일 쪽, [이날 하루 보기] = 날짜 숫자 누름과 같은 그날 창.
// S57-20 BIZ-보고할일정(시안 docs/design/mockups/biz-report-plan-link.html ②): plan = {on}이면 [수정] 바로 아래 [보고할 일정] 한 줄 — 켜져 있으면 끝에 ✓.
// 누르면 그 자리에서 켜고 끈다(Google 일정은 그대로라 쓰기 권한이 없는 캘린더의 일정에도 둔다). plan이 없으면(서버 준비 전·아직 못 읽음) 항목 없이 지금 그대로.
const PLAN_ICON = 'M3.5 3.5h9v9h-9z'; // 표시 기호 □
export const planMenuItem = plan => (plan ? {id: 'plan', label: plan.on ? '보고할 일정 ✓' : '보고할 일정', icon: PLAN_ICON} : null);
export function eventMenuItems(writable, plan = null) {
  const item = planMenuItem(plan), mark = item ? [item] : [];
  if (!writable) return [{id: 'edit', label: '열기'}, ...mark];
  return [{id: 'edit', label: '수정'}, ...mark, {id: 'orgs', label: '담당조직 연결'}, {id: 'report', label: '결과 남기기'}, {id: 'delete', label: '삭제', last: true}];
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
