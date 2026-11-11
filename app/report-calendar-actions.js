// S57-8 BIZ-달력우클릭끌기 PR-2: 사업 보고 [달력]에서 보고를 끌어 다른 날 칸에 놓기(PC 마우스만, 폰은 끌기 없음 — 보고를 열어 [수정]으로 날짜 변경).
// 끌기 손맛은 일정 달력 끌기(calendar-drag.js)와 같다: 4px 넘게 움직여야 끌기, 끄는 줄의 반투명 복제 조각(.cal-drag-ghost)이 커서를 따라가고,
// 놓을 칸은 옅은 바탕+선(.rv-drop)으로 보이며, Esc·창 밖으로 나가면 취소, 끌기 뒤(취소한 뒤 손을 뗄 때도) 따라오는 클릭 한 번은 막는다. 놓으면 날짜만 바뀌고 시각은 그대로,
// 저장은 보고 수정 창(meeting-round-detail.js mrdSaveEdit)과 같은 길(app_meetings meeting_at PATCH, 내 작업공간·지금 일시 그대로인 한 줄만)이고
// 놓은 뒤 "옮겼어요 · 되돌리기"(offerUndoNotice)가 뜬다. 회차 번호·Google 일정·사진·자료는 건드리지 않는다(사진·자료는 meeting_id로 따라간다).
// 이 모듈은 끌기 입력과 저장 호출만 갖고, 그리기는 team.js renderMeetings 하나다(상태 없음 — 부르는 쪽이 reportDay를 맞춘다).
// BIZ-달력그날창: '+n' 그날 창에 줄을 넣는 showReportDayWindow도 여기 있다. 부르는 길은 team.js showReportDay 하나이고(달력을 다시 그릴 때도 그 길),
// 여기에 화면 상태는 두지 않는다(열려 있는 날은 창에서 읽고, dayDeps는 부르는 쪽 길을 잇는 연결일 뿐).
import {offerUndoNotice} from './basket-record-delete.js';
import {openRowMenu} from './row-menu.js';
import {moveReportAt, dayKeyOf, dayHeading, REPORT_DAY_MENU_ITEMS, reportsByDay, dayWindowTitle} from './report-views-model.mjs';
import {dayWindowHtml} from './report-views.js';

const SLOP = 4;
// 빈 칸 우클릭 메뉴(일정 달력 날짜 칸 메뉴와 같은 공용 줄 메뉴 부품 row-menu.js). add(day, cell) = 새 보고 창에 그 날짜, show(day) = 그날 고르기.
export function openReportDayMenu(cell, at, {add, show}) {
  const day = cell?.dataset?.rvCell;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return false;
  return openRowMenu(cell, {key: 'rvday:' + day, title: dayHeading(day), items: REPORT_DAY_MENU_ITEMS, at,
    run: id => { if (id === 'add') add(day, cell); else if (id === 'day') show(day); }});
}
const iso = at => new Date(at).toISOString();

// BIZ-달력그날창: '+n' → 그 칸 자리에 그날 보고 전부. 창은 일정 달력의 그날 창과 같은 부품(calendar-day-overflow.js KPTUCalendarDayOverflow.show —
// 머리 날짜·✕, 바깥 누르기·✕·Esc로 닫고 닫으면 '+n'으로 초점)이고, 여기서는 사업 보고 줄을 넣고 줄 누름·우클릭·[+ 이날 사업 보고 추가]를 잇는다.
// 줄을 누르면 일정 달력 그날 창처럼 창이 먼저 닫히고(초점은 '+n') 그 보고가 열린다. 우클릭은 칸 안 제목과 같은 보고 메뉴(창은 그대로, 보고 창은 안 엶), 끌기는 아래 installReportDrag가 같이 받는다.
// 창이 열려 있는지·어느 날인지는 창 자신이 안다(따로 상태를 두지 않는다). 닫기는 ✕와 같은 길 하나.
const DAY_MODAL = '#calendarDayModal[data-day-kind="report"]:not(.hidden)';
export const reportDayWindowDay = () => document.querySelector(`${DAY_MODAL} [data-rv-pop]`)?.dataset.rvPop || '';
export function closeReportDayWindow() {
  const button = document.querySelector(`${DAY_MODAL} [data-close="calendarDayModal"]`);
  if (!button) return false;
  button.click();
  return true;
}
let dayDeps = null, dayBound = false;
function bindDayWindow(list) {
  if (dayBound) return;
  dayBound = true;
  const mine = e => !!list.closest('[data-day-kind="report"]') && e.target instanceof Element;
  list.addEventListener('click', e => {
    if (!mine(e)) return;
    const add = e.target.closest('[data-rv-pop-add]');
    if (add) { const day = add.dataset.rvPopAdd; closeReportDayWindow(); dayDeps?.add(day); return; }
    // S58-10: 보고할 일정 줄의 [보고 쓰기] = 창을 닫고 쓰기 창(보고 줄을 눌렀을 때와 같은 순서), [보고할까요?] = 창은 그대로 두고 표시만 저장(다시 그릴 때 이 창도 again 길로 다시 채워진다).
    const write = e.target.closest('[data-rv-plan-write]');
    if (write) { const id = write.dataset.rvPlanWrite; closeReportDayWindow(); dayDeps?.plan?.('write', id); return; }
    const ask = e.target.closest('[data-rv-plan-ask]');
    if (ask) { dayDeps?.plan?.('ask', ask.dataset.rvPlanAsk); return; }
    const row = e.target.closest('[data-mrd-meeting]');
    if (row) { const id = String(row.dataset.mrdMeeting); closeReportDayWindow(); dayDeps?.open(id); }
  });
  list.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && mine(e) && e.target.matches('[data-mrd-meeting]')) { e.preventDefault(); e.target.click(); } });
  // 우클릭·메뉴 키: 부르는 쪽(team.js reportViewMenu)이 칸 안 제목과 같은 보고 메뉴를 연다 — 메뉴만, 보고 창은 열지 않는다(S58-16 BIZ-달력우클릭창뜸).
  // 그날 창은 메뉴 뒤에 그대로 두고(메뉴는 이 창 안에 뜸), [수정]을 고르면 줄을 왼쪽으로 누를 때처럼 이 창을 먼저 닫고 수정 창을 연다(before).
  // [종류 바꾸기]·[삭제] 뒤에는 달력을 다시 그릴 때 이 창도 again 길로 다시 채워진다.
  list.addEventListener('contextmenu', e => { if (mine(e) && e.target.closest('[data-mrd-meeting]')) dayDeps?.menu(e, {before: closeReportDayWindow}); });
}
// rows = 지금 달력에 보이는 사업 보고(칸 칩이 걸린 것), anchor() = 그날 칸, trigger() = 그 칸의 '+n'. again = 달력을 다시 그린 뒤 열려 있는 창을 다시 채우기(초점 줄 유지).
// 그날 '+n'이 없어졌으면(보고가 줄었거나 다른 달·다른 보기) 창을 닫는다. open(id)·add(day)·menu(event, {before})는 부르는 쪽 길.
// S58-10: plans = 그날의 보고할 일정 항목(report-calendar-plan.mjs), planColorOf(item), plan(kind, eventId) = [보고 쓰기]('write')·[보고할까요?]('ask')를 받는 부르는 쪽 길.
export async function showReportDayWindow({day, rows, colorOf, nameOf, anchor, trigger, again = false, open, add, menu, plans = [], planColorOf, plan}) {
  await import('./calendar-day-overflow.js');
  const win = window.KPTUCalendarDayOverflow, list = reportsByDay(rows).get(day) || [], items = Array.isArray(plans) ? plans : [], from = trigger();
  if (!win?.show || !from || (!list.length && !items.length)) { closeReportDayWindow(); return false; }
  const active = again ? document.activeElement?.closest?.('#calendarDayList') && document.activeElement : null;
  const kept = active?.closest?.('[data-mrd-meeting]')?.dataset.mrdMeeting || '', keptPlan = active?.closest?.('[data-rv-plan]')?.dataset.rvPlan || '';
  // 머리 옆 작은 글자: 보고만 있으면 전과 같이 '사업 보고 n', 보고할 일정·보고할까요?가 있으면 뒤에 '일정 n'(작은 창 머리 한 줄에 들어가게 짧게 — 종류는 줄의 표시가 말한다).
  const note = [list.length ? `사업 보고 ${list.length}` : '', items.length ? `일정 ${items.length}` : ''].filter(Boolean).join(' · ');
  dayDeps = {open, add, menu, plan};
  win.show({title: dayWindowTitle(day), note, kind: 'report', anchor, trigger: from,
    initialFocus: kept && list.some(m => String(m.id) === kept) ? `#calendarDayList [data-mrd-meeting="${CSS.escape(kept)}"]`
      : keptPlan && items.some(i => i.eventId === keptPlan) ? `#calendarDayList [data-rv-plan="${CSS.escape(keptPlan)}"] button`
      : '#calendarDayList :is([data-mrd-meeting],button)',
    fill: el => { el.innerHTML = dayWindowHtml({day, list, colorOf, nameOf, plans: items, planColorOf}); bindDayWindow(el); }});
  return true;
}

// 저장 한 길. deps = {api(path, {method, body, prefer}), workspaceId(), meetingOf(id), reload(), setDay(day), toast(text)}.
export function createReportDayMover(deps) {
  const busy = new Set();
  const patch = async (wid, id, fromAt, toAt) => {
    const rows = await deps.api(`/rest/v1/app_meetings?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(wid)}&meeting_at=eq.${encodeURIComponent(iso(fromAt))}&select=id,meeting_at`,
      {method: 'PATCH', body: {meeting_at: iso(toAt), updated_at: new Date().toISOString()}, prefer: 'return=representation'});
    return Array.isArray(rows) && rows.length === 1 && String(rows[0].id) === String(id) && new Date(rows[0].meeting_at).getTime() === new Date(toAt).getTime();
  };
  return async function move(id, toDay) {
    const wid = deps.workspaceId(), meeting = deps.meetingOf(id);
    if (!wid || !meeting || busy.has(String(id))) return {status: 'skip'};
    const from = meeting.meeting_at, to = moveReportAt(from, toDay), fromDay = dayKeyOf(meeting);
    if (!to) return {status: 'same'};
    busy.add(String(id));
    try {
      let saved = false;
      try { saved = await patch(wid, id, from, to); } catch { deps.toast('옮기지 못했어요. 잠시 뒤 다시 해 주세요.'); return {status: 'failed'}; }
      if (!saved) { deps.toast('그 사이 바뀐 보고예요. 새로 불러왔어요.'); await deps.reload(); return {status: 'changed'}; }
      deps.setDay(toDay); await deps.reload();
      offerUndoNotice({text: `옮겼어요 · ${dayHeading(toDay)}`, onUndo: async () => {
        if (deps.workspaceId() !== wid) return {status: 'stale'};
        let back = false;
        try { back = await patch(wid, id, to, from); } catch { back = false; }
        if (!back) return {status: 'failed', message: '되돌리지 못했어요. 그 사이 바뀌었는지 확인해 주세요.'};
        deps.setDay(fromDay); await deps.reload();
        return {status: 'restored', message: '원래 날짜로 되돌렸어요.'};
      }});
      return {status: 'saved'};
    } finally { busy.delete(String(id)); }
  };
}

// 끌기 입력. move(id, day)는 createReportDayMover의 move. 한 번만 설치한다(문서 단위 듣기, 달력이 다시 그려져도 그대로).
let installed = false;
export function installReportDrag({move, pc = window.matchMedia('(min-width:761px)')}) {
  if (installed) return;
  installed = true;
  let g = null, swallow = false, swallowUp = false;
  // 끌기를 마치거나 취소한 뒤 손을 뗄 때 따라오는 클릭(보고 열기)을 막는다. 취소(Esc·창 밖)는 손을 떼기 전이라 swallowUp으로 다음 손 뗌에 이어 막는다(일정 달력 끌기와 같음).
  const swallowNext = () => { swallow = true; setTimeout(() => { swallow = false; }, 0); };
  // BIZ-달력그날창: '+n' 그날 창 안의 줄도 같은 끌기. 끌기가 시작되면 창을 닫아(✕와 같은 길) 놓을 달력 칸이 보이게 한다. 원래 날은 줄의 data-rv-from.
  const ROWS = '#meetingList .rv-cal [data-mrd-meeting], #calendarDayList [data-rv-from][data-mrd-meeting]';
  const cells = () => document.querySelectorAll('#meetingList .rv-cell[data-rv-cell]');
  const cellAt = (x, y) => { for (const c of cells()) { const r = c.getBoundingClientRect(); if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return c; } return null; };
  const mark = cell => { cells().forEach(c => c.classList.toggle('rv-drop', c === cell)); };
  const end = () => { const was = g; g = null; was?.ghost?.remove(); document.documentElement.classList.remove('cal-drag-on'); cells().forEach(c => c.classList.remove('rv-drop')); return was; };
  function ghostStart(e) {
    const r = g.el.getBoundingClientRect(), c = g.el.cloneNode(true);
    [c, ...c.querySelectorAll('*')].forEach(n => { for (const a of [...n.attributes]) if (a.name === 'id' || a.name === 'tabindex' || a.name === 'title' || a.name === 'role' || a.name.startsWith('data-') || a.name.startsWith('aria-')) n.removeAttribute(a.name); });
    c.classList.add('cal-drag-ghost', 'rv-ghost'); c.setAttribute('aria-hidden', 'true'); c.setAttribute('inert', '');
    Object.assign(c.style, {position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', margin: '0', zIndex: '10000', opacity: '.7', pointerEvents: 'none', transition: 'none', background: 'var(--kptu-surface)'});
    (g.el.closest('.rv-cal') || document.body).append(c);
    document.documentElement.classList.add('cal-drag-on');
    g.ghost = c; g.ox = g.x0 - r.left; g.oy = g.y0 - r.top;
  }
  document.addEventListener('pointerdown', e => {
    swallowUp = false;
    if (g || e.button !== 0 || e.pointerType !== 'mouse' || !pc.matches || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const el = e.target.closest?.(ROWS);
    if (!el || e.target.closest('button,a,input,select,textarea')) return;
    const from = el.closest('.rv-cell[data-rv-cell]')?.dataset.rvCell || el.dataset.rvFrom || document.querySelector('#meetingList .rv-cal .rv-sel[data-rv-cell]')?.dataset.rvCell || '';
    if (!from) return;
    g = {el, id: String(el.dataset.mrdMeeting), from, pointer: e.pointerId, x0: e.clientX, y0: e.clientY, started: false, ghost: null};
  }, true);
  document.addEventListener('pointermove', e => {
    if (!g || e.pointerId !== g.pointer) return;
    if (!g.started) {
      if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < SLOP) return;
      g.started = true; try { g.el.setPointerCapture(e.pointerId); } catch { /* 잡지 못해도 끌기는 된다 */ }
      window.getSelection?.()?.removeAllRanges?.(); ghostStart(e);
      if (g.el.closest('#calendarDayList')) closeReportDayWindow();
    }
    e.preventDefault();
    g.ghost.style.transform = `translate3d(${e.clientX - g.x0}px,${e.clientY - g.y0}px,0)`;
    const cell = cellAt(e.clientX, e.clientY);
    mark(cell && cell.dataset.rvCell !== g.from ? cell : null);
  }, {capture: true, passive: false});
  document.addEventListener('pointerup', e => {
    if (!g && swallowUp) { swallowUp = false; swallowNext(); return; }
    if (!g || e.pointerId !== g.pointer) return;
    if (!g.started) { g = null; return; }
    swallowNext();
    const cell = cellAt(e.clientX, e.clientY), drop = end();
    if (cell && drop && cell.dataset.rvCell !== drop.from) void move(drop.id, cell.dataset.rvCell);
  }, true);
  document.addEventListener('pointercancel', e => { swallowUp = false; if (g && e.pointerId === g.pointer) { if (g.started) swallowNext(); end(); } }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && g?.started) { e.preventDefault(); e.stopPropagation(); swallowUp = true; swallowNext(); end(); } }, true);
  // 끌기 뒤 클릭은 보고 열기(#meetingList 줄 누름)보다 먼저(window capture) 막는다.
  window.addEventListener('click', e => { if (swallow) { swallow = false; e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  // 끄는 동안 글자 선택을 막고, 창 밖으로 나가거나 창이 포커스를 잃으면 끌기를 취소한다(조각도 지움).
  document.addEventListener('selectstart', e => { if (g?.started) e.preventDefault(); }, true);
  document.addEventListener('dragstart', e => { if (g && e.target?.closest?.(ROWS)) e.preventDefault(); }, true);
  document.documentElement.addEventListener('mouseleave', e => { if (g?.started && !e.relatedTarget) { swallowUp = true; swallowNext(); end(); } });
  window.addEventListener('blur', () => { if (g?.started) { swallowUp = true; end(); } });
}
