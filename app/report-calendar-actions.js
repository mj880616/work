// S57-8 BIZ-달력우클릭끌기 PR-2: 사업 보고 [달력]에서 보고를 끌어 다른 날 칸에 놓기(PC 마우스만, 폰은 끌기 없음 — 보고를 열어 [수정]으로 날짜 변경).
// 끌기 손맛은 일정 달력 끌기(calendar-drag.js)와 같다: 4px 넘게 움직여야 끌기, 끄는 줄의 반투명 복제 조각(.cal-drag-ghost)이 커서를 따라가고,
// 놓을 칸은 옅은 바탕+선(.rv-drop)으로 보이며, Esc·창 밖으로 나가면 취소, 끌기 뒤 따라오는 클릭 한 번은 막는다. 놓으면 날짜만 바뀌고 시각은 그대로,
// 저장은 보고 수정 창(meeting-round-detail.js mrdSaveEdit)과 같은 길(app_meetings meeting_at PATCH, 내 작업공간·지금 일시 그대로인 한 줄만)이고
// 놓은 뒤 "옮겼어요 · 되돌리기"(offerUndoNotice)가 뜬다. 회차 번호·Google 일정·사진·자료는 건드리지 않는다(사진·자료는 meeting_id로 따라간다).
// 이 모듈은 끌기 입력과 저장 호출만 갖고, 그리기는 team.js renderMeetings 하나다(상태 없음 — 부르는 쪽이 reportDay를 맞춘다).
import {offerUndoNotice} from './basket-record-delete.js';
import {openRowMenu} from './row-menu.js';
import {moveReportAt, dayKeyOf, dayHeading, REPORT_DAY_MENU_ITEMS} from './report-views-model.mjs';

const SLOP = 4;
// 빈 칸 우클릭 메뉴(일정 달력 날짜 칸 메뉴와 같은 공용 줄 메뉴 부품 row-menu.js). add(day, cell) = 새 보고 창에 그 날짜, show(day) = 그날 고르기.
export function openReportDayMenu(cell, at, {add, show}) {
  const day = cell?.dataset?.rvCell;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return false;
  return openRowMenu(cell, {key: 'rvday:' + day, title: dayHeading(day), items: REPORT_DAY_MENU_ITEMS, at,
    run: id => { if (id === 'add') add(day, cell); else if (id === 'day') show(day); }});
}
const iso = at => new Date(at).toISOString();

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
  let g = null, swallow = false;
  const swallowNext = () => { swallow = true; setTimeout(() => { swallow = false; }, 0); };
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
    if (g || e.button !== 0 || e.pointerType !== 'mouse' || !pc.matches || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const el = e.target.closest?.('#meetingList .rv-cal [data-mrd-meeting]');
    if (!el || e.target.closest('button,a,input,select,textarea')) return;
    const from = el.closest('.rv-cell[data-rv-cell]')?.dataset.rvCell || document.querySelector('#meetingList .rv-cal .rv-sel[data-rv-cell]')?.dataset.rvCell || '';
    if (!from) return;
    g = {el, id: String(el.dataset.mrdMeeting), from, pointer: e.pointerId, x0: e.clientX, y0: e.clientY, started: false, ghost: null};
  }, true);
  document.addEventListener('pointermove', e => {
    if (!g || e.pointerId !== g.pointer) return;
    if (!g.started) {
      if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < SLOP) return;
      g.started = true; try { g.el.setPointerCapture(e.pointerId); } catch { /* 잡지 못해도 끌기는 된다 */ }
      window.getSelection?.()?.removeAllRanges?.(); ghostStart(e);
    }
    e.preventDefault();
    g.ghost.style.transform = `translate3d(${e.clientX - g.x0}px,${e.clientY - g.y0}px,0)`;
    const cell = cellAt(e.clientX, e.clientY);
    mark(cell && cell.dataset.rvCell !== g.from ? cell : null);
  }, {capture: true, passive: false});
  document.addEventListener('pointerup', e => {
    if (!g || e.pointerId !== g.pointer) return;
    if (!g.started) { g = null; return; }
    swallowNext();
    const cell = cellAt(e.clientX, e.clientY), drop = end();
    if (cell && drop && cell.dataset.rvCell !== drop.from) void move(drop.id, cell.dataset.rvCell);
  }, true);
  document.addEventListener('pointercancel', e => { if (g && e.pointerId === g.pointer) { if (g.started) swallowNext(); end(); } }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && g?.started) { e.preventDefault(); e.stopPropagation(); swallowNext(); end(); } }, true);
  document.addEventListener('click', e => { if (swallow) { swallow = false; e.preventDefault(); e.stopImmediatePropagation(); } }, true);
}
