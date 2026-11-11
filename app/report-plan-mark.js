// S58-4 BIZ-보고할일정 PR B(설계 docs/design/biz-report-plan-link.md 4-1 · 6절 B): 일정 줄 앞 ✓(보고 씀)·□(보고할 일정) 표시 한 개.
// 일정 달력(월·주·목록·그날 창)과 홈 그날 일정 줄이 그 줄을 그리는 자리에서 planMarkOf·planMarkEl 을 불러 함께 그린다(뒤에서 덧그리지 않는다).
// 규칙은 report-plan-model.mjs, 읽는 길은 report-plan-data.js 그대로다. 여기는 표시 마디와 누름만 맡고, 아무것도 저장하지 않는다.
// - 읽어 둔 값이 없으면(아직 안 읽음·새 표가 없는 서버) 표시 없이 지금 그대로. 처음 그릴 때 한 번 읽기를 부탁하고, 읽은 값이 표시를
//   바꿀 때만(kptu:report-marks-changed) 각 화면의 주인이 자기 줄을 다시 그린다(달력 = __KPTU_RENDER_CALENDAR__, 홈 = 그날 일정 칸).
//   표가 비어 있으면(그릴 표시가 없으면) 아무도 다시 그리지 않는다 — 이 기능을 쓰지 않는 화면의 그리는 순서는 예전 그대로다.
// - '보고할까요?'(점선 □)는 사업 보고 달력에서만 쓴다(설계 4-1의 4번). 일정 달력·홈에서는 그리지 않는다.
// - 누르면: ✓ = 그 보고 열기(가장 나중에 쓴 것 — report-open.js), □ = 그 일정으로 사업 보고 쓰기 창(일정 메뉴 [결과 남기기]와 같은 길 — event-open.js).
// - 할 일의 □(굵은 글자·배경 없음)와 헷갈리지 않게 일정의 □는 일정 색 막대(줄) 안에서 그 글자색으로만 그린다(ui-standard.css .rp-mark).
import {eventPlan, reportPlanData, loadReportPlans, REPORT_PLANS_CHANGED} from './report-plan-data.js';
import {reportsOfEvent, STATUS_DONE, STATUS_TODO} from './report-plan-model.mjs';
import {openReport} from './report-open.js';
import {leaveEventReport} from './event-open.js';
import {notify} from './small-notice.js';

export const MARK_LABEL = {[STATUS_DONE]: '보고 씀', [STATUS_TODO]: '보고할 일정'};

export const REPORT_MARKS_CHANGED = 'kptu:report-marks-changed';

// 아직 읽어 둔 값이 없으면 한 번 읽기를 부탁한다(표가 없는 서버면 '없음'으로 끝나 다시 묻지 않는다 — report-plan-data.js 가 기억).
// 읽기가 실패하면(서버 오류·끊김) 그릴 때마다 다시 부르지 않고 잠시 뒤 다음 그리기 때 한 번 더 부탁한다.
const RETRY_MS = 30000;
let asking = null, retryAt = 0;
function ask() {
  if (asking || Date.now() < retryAt) return;
  const failed = () => { retryAt = Date.now() + RETRY_MS; };
  asking = loadReportPlans().then(loaded => { if (!loaded) failed(); }, failed).finally(() => { asking = null; });
}

// 일정 하나(Google 일정 모양: id·calendarId·title·start·allDay)의 표시. 없으면 null.
// {status:'done'|'todo', label, eventId, calendarId, reportId('done'일 때 가장 나중 보고)}
export function planMarkOf(event) {
  if (!event?.id) return null;
  const data = reportPlanData();
  if (!data) { ask(); return null; }
  const status = eventPlan(event)?.status;
  if (status !== STATUS_DONE && status !== STATUS_TODO) return null;
  const reportId = status === STATUS_DONE ? String(reportsOfEvent(event.id, data.reports)[0]?.id ?? '') : '';
  if (status === STATUS_DONE && !reportId) return null;
  return {status, label: MARK_LABEL[status], eventId: String(event.id), calendarId: String(event.calendarId || 'primary'), reportId};
}

// 표시 마디. 일정 줄(button) 안 제목 앞에 넣는다. 줄 자체의 누름(일정 창 열기)보다 먼저 아래 누름 처리가 받는다.
export function planMarkEl(mark, doc = document) {
  if (!mark) return null;
  const el = doc.createElement('span');
  el.className = `rp-mark rp-mark-${mark.status}`;
  el.dataset.reportMark = mark.status;
  el.dataset.reportEvent = mark.eventId;
  el.dataset.reportCalendar = mark.calendarId;
  if (mark.reportId) el.dataset.reportId = mark.reportId;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', mark.label);
  el.title = mark.label;
  return el; // 글자는 넣지 않는다(모양은 CSS) — 줄의 제목 글자(말풍선·읽기 이름·시험)가 그대로 남는다.
}
// 읽기 이름(aria-label)에 붙일 말: ', 보고 씀' | ', 보고할 일정' | ''.
export const planMarkSuffix = mark => (mark ? `, ${mark.label}` : '');

// 그날 창 안의 ✓: 그 창의 다른 줄과 같이 그날 창을 먼저 닫고 연다(calendar-interactions-v2.js ciCloseDay 와 같은 순서 — □ 쪽은 그 길이 닫는다).
const closeDay = () => new Promise(resolve => {
  const modal = document.querySelector('#calendarDayModal');
  if (!modal || modal.classList.contains('hidden')) return resolve();
  if (window.KPTUMobileModalHistory) return window.KPTUMobileModalHistory.closeThen(modal, resolve);
  modal.classList.add('hidden'); modal.setAttribute('aria-hidden', 'true'); window.KPTUA11y?.dialog.deactivate?.(modal, {restoreFocus: false}); resolve();
});

let busy = false;
async function act(el) {
  if (busy) return;
  busy = true;
  const done = el.dataset.reportMark === STATUS_DONE;
  try {
    if (done) { await closeDay(); await openReport(el.dataset.reportId); }
    else await leaveEventReport(el.dataset.reportEvent, el.dataset.reportCalendar);
  } catch (error) {
    console.warn('report plan mark', error?.message || error);
    notify(done ? '사업 보고를 열지 못했어요. 다시 시도해 주세요.' : '사업 보고 입력 창을 열지 못했어요. 다시 시도해 주세요.', {error: true, record: false});
  } finally { busy = false; }
}

if (!window.__KPTU_REPORT_PLAN_MARK__) {
  window.__KPTU_REPORT_PLAN_MARK__ = true;
  // 표시는 일정 줄(button) 안에 있다. 줄의 누름(calendar-interactions-v2.js·journal.js: 일정 창 열기)보다 먼저 받아야 하므로 문서 capture 단계에 건다
  // — 이 모듈은 그 화면들의 그리는 모듈이 먼저 불러오므로 그 처리들보다 앞에 등록된다. 끌어 옮기기·꾹 누르기 뒤의 누름은 window capture 가 이미 삼킨다.
  document.addEventListener('click', event => {
    const el = event.target?.closest?.('[data-report-mark]');
    if (!el) return;
    // 폰 월 보기에서 옆으로 민 뒤 따라오는 누름은 달력이 막는다(같은 규칙).
    if (el.closest('#calendarGrid') && window.KPTUCalendarMonthView?.suppressClick?.()) return;
    event.preventDefault(); event.stopImmediatePropagation();
    void act(el);
  }, true);
  // 표시에 쓰이는 값(결정 줄·일정에 이어진 보고)이 달라졌을 때만 화면의 주인에게 다시 그려 달라고 한다.
  // 달력은 그리는 함수가 하나다(team.js renderCalendar → __KPTU_RENDER_CALENDAR__). 홈은 kptu:report-marks-changed 를 듣고 그날 일정 칸을 다시 그린다.
  const signature = () => {
    const data = reportPlanData();
    return JSON.stringify(data ? [data.plans.map(p => [p.google_event_id, p.state, p.decided_by, p.decided_at, p.title]), data.reports.map(r => [r.id, r.google_event_id, r.series_name, r.title, r.created_at])] : [[], []]);
  };
  let shown = signature();
  window.addEventListener(REPORT_PLANS_CHANGED, () => {
    const now = signature();
    if (now === shown) return;
    shown = now;
    window.__KPTU_RENDER_CALENDAR__?.();
    try { window.dispatchEvent(new CustomEvent(REPORT_MARKS_CHANGED)); } catch {}
  });
  window.addEventListener('kptu:session-changed', () => { retryAt = 0; });
}
