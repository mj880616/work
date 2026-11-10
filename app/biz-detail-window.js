// BIZ-기록하나로 B-4 ②(설계 docs/design/record-one.md 2-7 '2. 2) 주요 사업·회의결과'·4절 표 '홈 [주간 정리] 2. 2)'·'사업 보고'): 2. 2) 주요 사업 창 부품 하나.
// 홈 [주간 정리] 2. 2)와 사업 보고 '이번 주 주간보고' 2)가 같은 부품을 쓴다(상자마다 이 부품 하나가 상태 주인이고 그리는 곳 — AGENTS.md 5절).
// - 줄 = 그 주 사업 기록 + 그 주 사업 보고를 사업별로 묶음(규칙은 biz-detail-model.mjs). 사업 보고 결과 본문이 있으면 기본 '상세 포함'(줄 아래 본문).
// - 줄 ⋯ = [보고용으로 수정](작은 ✓)·[원래 글로]·[이번 보고에서 빼기]·[한 줄만 ↔ 상세 포함](본문 있는 사업 보고만)·[기록 열기](+ 홈에서는 [이 종류 늘 빼기]).
//   보고에만 다른 것은 app_report_line_marks(section 'biz_detail', '그 주부터' 이어짐)에 한 행. 원래 사업 기록·사업 보고는 바꾸지 않는다.
// - 묶음 아래 [뺀 줄 n](펼쳐 [되돌리기])·[+ 쓰기](그 사업 사업 기록 한 줄, business-now-data.js saveBusinessRecord), 맨 아래 [+ 쓰기](사업 고르기).
// - 사업 기록·지금 상황이 다른 화면에서 바뀌면(kptu:business-now-changed) 다시 읽고, 다른 상자가 표시를 바꾸면(kptu:biz-detail-changed) 다시 읽는다.
// 기기에 아무것도 저장하지 않는다. 글은 로그에 쓰지 않는다.
import {missingTable} from './feed-model.mjs';
import {seoulDateKey} from './meeting-time.js';
import {chevHtml} from './fold-chevron.mjs';
import {rowMore} from './row-more.js';
import {fitAll} from './auto-grow.js';
import {waitHtml, emptyHtml} from './wait-state.js';
import {reportsMeeting, meetingKindKey, meetingKindName, validKindKey} from './journal-meeting-kinds.js';
import * as D from './biz-detail-model.mjs';
import * as NM from './business-now-model.mjs';
import * as ND from './business-now-data.js';
import {meetingLine} from './journal-data.js';

const MARKS = '/rest/v1/app_report_line_marks';
const MARK_COLS = 'id,week_start,section,ref_kind,ref_key,report_body,choice,detail,updated_at';
const EVENT = 'kptu:biz-detail-changed';
const enc = encodeURIComponent;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export const TEXT = {
  failed: '주요 사업을 불러오지 못했어요.', saveFailed: '저장하지 못했어요. 다시 눌러 주세요.', noBody: '내용을 적어 주세요.', badDay: '날짜를 다시 선택해 주세요.',
  noSpace: '사업을 선택해 주세요.', saved: '저장했어요.', added: '기록을 남겼어요.', out: '이번 보고에서 뺐어요.', back: '보고에 다시 넣었어요.',
  orig: '원래 글로 되돌렸어요.', full: '상세 포함으로 바꿨어요.', one: '한 줄만 보이게 바꿨어요.', marksOff: '보고용 표시 칸이 아직 준비되지 않았어요.',
};
let seq = 0;

// kinds = true면 줄 ⋯에 [이 종류 늘 빼기](홈 [주간 정리] 화면이 data-journal-kind-toggle을 받아 처리).
export function createBizDetailBox({rt = window.KPTURuntime, kinds = false} = {}) {
  const el = document.createElement('div'); el.className = 'bd-box'; el.dataset.bizDetailBox = '';
  const ctl = {id: `bd${++seq}`, week: '', meetings: [], tree: null, hidden: null, lineOfMeeting: m => meetingLine({...m, meeting_at: null}), records: [], marks: [], marksOn: true, status: 'idle', recStatus: 'idle',
    run: 0, editing: null, draft: null, invalid: '', busy: false, outOpen: new Set(), msg: '', error: false, focus: '', stale: false};
  const wsOf = () => rt?.context?.read?.()?.workspace?.id || '';
  const announce = () => window.dispatchEvent(new CustomEvent(EVENT, {detail: {source: ctl.id, week: ctl.week}}));
  let writing = false;

  // ---- 읽기 ----
  async function readMarks(week) {
    try {
      const rows = await rt.api(`${MARKS}?workspace_id=eq.${enc(wsOf())}&section=eq.${D.SECTION}&week_start=lte.${enc(week)}&select=${MARK_COLS}&order=week_start.asc&limit=5000`, {singleFlight: false});
      return {rows: Array.isArray(rows) ? rows : [], on: true};
    } catch (e) { if (missingTable(e)) return {rows: [], on: false}; throw e; }
  }
  async function load({quiet = false} = {}) {
    const run = ++ctl.run, week = ctl.week;
    if (!quiet || ctl.status !== 'ready') { ctl.status = 'loading'; render(); }
    try {
      const [recs, marks] = await Promise.all([ND.readWeekRecords(rt, week).catch(() => ({missing: false, items: [], failed: true})), readMarks(week)]);
      if (run !== ctl.run) return;
      ctl.records = recs.items || []; ctl.recStatus = recs.failed ? 'error' : recs.missing ? 'missing' : 'ready';
      ctl.marks = marks.rows; ctl.marksOn = marks.on; ctl.status = 'ready'; ctl.stale = false;
    } catch (e) { if (run !== ctl.run) return; console.warn('biz detail read failed', e?.message || e); ctl.status = 'error'; }
    render();
  }

  // ---- 묶음 계산 ----
  const meetingsShown = () => ctl.meetings.filter(m => reportsMeeting(m, ctl.hidden));
  ctl.groups = () => D.detailGroups({week: ctl.week, records: ctl.records, meetings: meetingsShown(), tree: ctl.tree, marks: ctl.marks, lineOfMeeting: ctl.lineOfMeeting});
  const findLine = id => { for (const g of ctl.groups()) for (const l of [...g.shown, ...g.out]) if (l.id === id) return {group: g, line: l}; return null; };
  const meetingOf = key => ctl.meetings.find(m => String(m?.id) === String(key)) || null;
  const spaceRows = () => [...D.treeRows(ctl.tree).entries()].map(([id, r]) => ({id, label: r.label}));

  // ---- 그리기 ----
  const moreSlot = spec => `<span class="wl-more-slot" data-wl-more="${esc(JSON.stringify(spec))}"></span>`;
  const lineMore = l => {
    const items = [];
    if (ctl.marksOn) {
      items.push({text: '보고용으로 수정', data: {bdEdit: l.id}, aria: `보고용으로 수정: ${l.text}`});
      if (l.edited) items.push({text: '원래 글로', data: {bdOrig: l.id}});
      if (l.canFull) items.push({text: l.detail === 'full' ? '한 줄만' : '상세 포함', data: {bdDetail: l.id}, aria: `${l.detail === 'full' ? '한 줄만' : '상세 포함'}: ${l.text}`});
      items.push({text: '이번 보고에서 빼기', data: {bdOut: l.id}, danger: true, aria: `이번 보고에서 빼기: ${l.text}`});
    }
    items.push({text: '기록 열기', data: {bdOpen: l.id}, aria: `기록 열기: ${l.text}`});
    if (kinds && l.kind === 'meeting') {
      const m = meetingOf(l.key), name = meetingKindName(m), key = meetingKindKey(name);
      if (validKindKey(key)) items.push({text: '이 종류 늘 빼기', data: {journalKindToggle: key, journalKindHide: '1', journalKindName: name}, aria: `${name} 종류를 주간보고에서 늘 빼기`});
    }
    return moreSlot({label: `줄 메뉴: ${l.text}`, data: {bdMore: l.id}, items});
  };
  const bodyHtml = l => {
    if (l.detail !== 'full') return '';
    const lines = l.body.slice(0, D.BODY_LINES_MAX), more = l.body.length - lines.length;
    return `<div class="bd-body" data-bd-body="${esc(l.id)}">${lines.map(t => `<p>${esc(t)}</p>`).join('')}${more > 0 ? `<p class="bd-body-more">… ${more}줄 더(기록 열기)</p>` : ''}</div>`;
  };
  const lineHtml = (l, where = 'shown') => {
    if (ctl.editing?.id === l.id) return reportForm(l);
    const ro = ctl.busy || !!ctl.editing;
    const act = where === 'shown' ? lineMore(l) : `<span class="row-act wl-btns btn-row"><button type="button" class="row-act wl-btn" data-bd-back="${esc(l.id)}"${ro ? ' disabled' : ''}>되돌리기</button></span>`;
    const tags = `${l.edited ? '<span class="rw-ok" title="보고용으로 수정함" aria-label="보고용으로 수정함">✓</span>' : ''}${l.kind === 'meeting' && l.canFull && l.detail !== 'full' && where === 'shown' ? '<span class="rw-tag">한 줄만</span>' : ''}`;
    return `<div class="wl-line rw-line bd-line${where === 'out' ? ' is-last' : ''}" data-bd-line="${esc(l.id)}" data-bd-kind="${esc(l.kind)}"><span class="wl-day">- ${esc(D.dayText(l.day, l.end_day))}</span><span class="wl-text">${esc(l.text)}</span>${tags}${act}</div>${where === 'shown' ? bodyHtml(l) : ''}`;
  };
  const reportForm = l => {
    const dis = ctl.busy ? ' disabled' : '', d = ctl.draft || {};
    return `<div class="wl-form" data-bd-form="${esc(l.id)}"><textarea rows="1" class="wl-f-body" data-bd-field="body" data-autogrow aria-label="보고용 글" maxlength="1000" autocomplete="off"${ctl.invalid === 'body' ? ' aria-invalid="true"' : ''}${dis}>${esc(d.body ?? l.text)}</textarea>`
      + `<span class="row-act wl-btns btn-row"><button type="button" class="row-act wl-btn" data-bd-cancel${dis}>취소</button><button type="button" class="row-act wl-btn is-main" data-bd-save${dis}>저장</button></span></div>`;
  };
  const recordForm = space => {
    const d = ctl.draft || {}, dis = ctl.busy ? ' disabled' : '', inv = f => (ctl.invalid === f ? ' aria-invalid="true"' : '');
    const pick = space ? '' : `<select data-bd-field="space" aria-label="사업"${inv('space')}${dis}><option value="">사업 선택</option>${spaceRows().map(r => `<option value="${esc(r.id)}"${d.space === r.id ? ' selected' : ''}>${esc(r.label)}</option>`).join('')}</select>`;
    const sun = NM.sundayOf(ctl.week);
    return `<div class="wl-form" data-bd-form="new" data-bd-space="${esc(space || '')}">${pick}`
      + `<span class="wl-f-days"><input type="date" data-bd-field="day" aria-label="날짜" value="${esc(d.day || '')}" min="${esc(ctl.week)}" max="${esc(sun)}"${inv('day')}${dis}></span>`
      + `<textarea rows="1" class="wl-f-body" data-bd-field="body" data-autogrow aria-label="사업 기록" maxlength="${NM.RECORD_BODY_MAX}" autocomplete="off"${inv('body')}${dis}>${esc(d.body || '')}</textarea>`
      + `<span class="row-act wl-btns btn-row"><button type="button" class="row-act wl-btn" data-bd-cancel${dis}>취소</button><button type="button" class="row-act wl-btn is-main" data-bd-save${dis}>저장</button></span></div>`;
  };
  const groupHtml = g => {
    const adding = ctl.editing?.id === 'new' && ctl.editing.space === g.space;
    const open = ctl.outOpen.has(g.space), dis = ctl.busy || !!ctl.editing ? ' disabled' : '';
    const outBtn = g.out.length ? `<button type="button" class="row-act wl-more" data-bd-fold="${esc(g.space)}" aria-expanded="${open}">뺀 줄 ${g.out.length} ${chevHtml(open)}</button>` : '';
    const add = g.known && !adding ? `<button type="button" class="row-act wl-add" data-bd-add="${esc(g.space)}" aria-label="${esc(`${g.label} 사업 기록 쓰기`)}"${dis}>+ 쓰기</button>` : '';
    return `<div class="bd-group" data-bd-group="${esc(g.space)}"><p class="bd-label">${esc(g.label)}</p>`
      + `${g.shown.map(l => lineHtml(l)).join('')}${!g.shown.length && !adding ? '<span class="wl-empty">—</span>' : ''}${adding ? recordForm(g.space) : ''}`
      + `${outBtn || add ? `<div class="rw-foot btn-row">${outBtn}${add}</div>` : ''}${open && g.out.length ? `<div class="rw-fold">${g.out.map(l => lineHtml(l, 'out')).join('')}</div>` : ''}</div>`;
  };
  function html() {
    if (!ctl.week) return waitHtml({rows: 2});
    if (ctl.status === 'error') return `<p class="wl-note" role="alert">${TEXT.failed}</p>`;
    if (ctl.status !== 'ready') return waitHtml({rows: 2});
    const groups = ctl.groups(), addingFree = ctl.editing?.id === 'new' && !ctl.editing.space;
    const dis = ctl.busy || !!ctl.editing ? ' disabled' : '';
    const notes = [ctl.recStatus === 'error' ? '사업 기록을 불러오지 못했어요.' : '', !ctl.marksOn ? TEXT.marksOff : ''].filter(Boolean);
    return `${notes.length ? `<p class="wl-note">${esc(notes.join(' '))}</p>` : ''}`
      + `${groups.length ? groups.map(groupHtml).join('') : addingFree ? '' : emptyHtml('없음')}`
      + `${addingFree ? recordForm('') : ctl.recStatus === 'ready' && spaceRows().length ? `<div class="rw-foot btn-row bd-foot"><button type="button" class="row-act wl-add" data-bd-add=""${dis}>+ 쓰기</button></div>` : ''}`
      + `<p class="wl-status${ctl.error ? ' is-error' : ''}" role="status" aria-live="polite" data-bd-status>${esc(ctl.msg)}</p>`;
  }
  function render() {
    el.innerHTML = html();
    for (const slot of el.querySelectorAll('[data-wl-more]')) {
      let spec = null; try { spec = JSON.parse(slot.dataset.wlMore); } catch { /* 깨진 자리표는 ⋯ 없이 */ }
      if (spec) slot.replaceWith(rowMore(document, spec)); else slot.remove();
    }
    fitAll(el);
    if (ctl.focus) { const f = el.querySelector(ctl.focus); f?.focus({preventScroll: true}); if (f?.matches('input, textarea, select')) f.scrollIntoView({block: 'nearest'}); ctl.focus = ''; }
  }
  const say = (text, error = false) => { ctl.msg = text || ''; ctl.error = !!error; const s = el.querySelector('[data-bd-status]'); if (s) { s.textContent = ctl.msg; s.classList.toggle('is-error', ctl.error); } };

  // ---- 쓰기 ----
  const work = async (fn, done) => {
    if (ctl.busy) return false;
    ctl.busy = true; say('저장하는 중…'); render();
    let ok = true;
    try { await fn(); } catch (e) { ok = false; console.warn('biz detail write failed', e?.message || e); }
    ctl.busy = false;
    if (ok) { ctl.editing = null; ctl.draft = null; ctl.invalid = ''; }
    render(); say(ok ? done : TEXT.saveFailed, !ok);
    if (ok) announce();
    return ok;
  };
  const mark = (l, change, done) => work(async () => {
    const p = D.nextMark(ctl.marks, {section: D.SECTION, kind: l.kind, key: l.key, week: ctl.week}, change);
    if (p.op === 'insert') {
      const rows = await rt.api(`${MARKS}?select=${MARK_COLS}`, {method: 'POST', prefer: 'return=representation', singleFlight: false, body: {workspace_id: wsOf(), ...p.row}});
      if (!Array.isArray(rows) || !rows[0]) throw new Error('mark');
      ctl.marks = [...ctl.marks, rows[0]];
    } else if (p.op === 'update') {
      const rows = await rt.api(`${MARKS}?id=eq.${enc(p.id)}&workspace_id=eq.${enc(wsOf())}&select=${MARK_COLS}`, {method: 'PATCH', prefer: 'return=representation', singleFlight: false, body: p.row});
      if (!Array.isArray(rows) || !rows[0]) throw new Error('mark');
      ctl.marks = ctl.marks.map(m => (m.id === p.id ? rows[0] : m));
    } else if (p.op === 'delete') {
      await rt.api(`${MARKS}?id=eq.${enc(p.id)}&workspace_id=eq.${enc(wsOf())}`, {method: 'DELETE', singleFlight: false});
      ctl.marks = ctl.marks.filter(m => m.id !== p.id);
    }
  }, done);
  async function save() {
    const e = ctl.editing; if (!e || ctl.busy) return;
    if (e.id === 'new') {
      const d = ctl.draft || {}, space = e.space || d.space || '', body = NM.recordBody(d.body), day = NM.recordDay(d.day);
      const bad = !space ? 'space' : !day || day < ctl.week || day > NM.sundayOf(ctl.week) ? 'day' : !body ? 'body' : '';
      if (bad) { ctl.invalid = bad; render(); say(bad === 'space' ? TEXT.noSpace : bad === 'day' ? TEXT.badDay : TEXT.noBody, true); ctl.focus = `[data-bd-field="${bad}"]`; render(); return; }
      writing = true;
      try {
        await work(async () => {
          const rows = await ND.saveBusinessRecord({space_id: space, day, body, source_kind: 'user'}, rt, wsOf());
          const item = Array.isArray(rows) && rows[0] ? NM.bizRecordItem(rows[0]) : null;
          if (item) ctl.records = [...ctl.records, item];
        }, TEXT.added);
      } finally { writing = false; }
      return;
    }
    const hit = findLine(e.id); if (!hit) return;
    const v = D.checkReportBody(ctl.draft?.body ?? hit.line.text);
    if (!v.ok) { ctl.invalid = 'body'; render(); say(TEXT.noBody, true); ctl.focus = '[data-bd-field="body"]'; render(); return; }
    await mark(hit.line, {report_body: v.value === hit.line.orig ? null : v.value}, TEXT.saved);
  }
  function cancel() { const e = ctl.editing; ctl.editing = null; ctl.draft = null; ctl.invalid = ''; ctl.focus = e?.id === 'new' ? `[data-bd-add="${CSS.escape(e.space || '')}"]` : e ? `[data-bd-more="${CSS.escape(e.id)}"] > summary` : ''; render(); say(''); }
  function openAdd(space) {
    const today = seoulDateKey(Date.now()), day = today >= ctl.week && today <= NM.sundayOf(ctl.week) ? today : ctl.week;
    ctl.editing = {id: 'new', space}; ctl.draft = {day, body: '', space: ''}; ctl.invalid = ''; ctl.focus = space ? '[data-bd-field="body"]' : '[data-bd-field="space"]'; render(); say('');
  }

  // ---- 입력 받기 ----
  el.addEventListener('input', e => { const t = e.target; if (!t.matches?.('[data-bd-field]')) return; ctl.draft = {...(ctl.draft || {}), [t.dataset.bdField]: t.value}; if (ctl.invalid === t.dataset.bdField) { ctl.invalid = ''; t.removeAttribute('aria-invalid'); } });
  el.addEventListener('change', e => { const t = e.target; if (!t.matches?.('[data-bd-field]')) return; ctl.draft = {...(ctl.draft || {}), [t.dataset.bdField]: t.value}; });
  el.addEventListener('keydown', e => {
    if (!e.target.matches?.('[data-bd-field]')) return;
    if (e.key === 'Enter' && !e.isComposing && e.target.tagName === 'TEXTAREA') { e.preventDefault(); void save(); }
    else if (e.key === 'Escape' && ctl.editing) { e.preventDefault(); e.stopPropagation(); cancel(); }
  });
  el.addEventListener('click', e => {
    const b = e.target.closest?.('button'); if (!b || b.disabled || !el.contains(b)) return;
    const d = b.dataset;
    if ('bdAdd' in d) { if (!ctl.busy && !ctl.editing) openAdd(d.bdAdd); return; }
    if ('bdCancel' in d) { cancel(); return; }
    if ('bdSave' in d) { void save(); return; }
    if ('bdFold' in d) { const s = d.bdFold; if (ctl.outOpen.has(s)) ctl.outOpen.delete(s); else ctl.outOpen.add(s); ctl.focus = `[data-bd-fold="${CSS.escape(s)}"]`; render(); return; }
    const id = d.bdEdit || d.bdOrig || d.bdOut || d.bdBack || d.bdOpen || d.bdDetail;
    if (!id || ctl.busy || ctl.editing) return;
    const hit = findLine(id); if (!hit) return;
    const l = hit.line, menu = b.closest('details'); if (menu) menu.open = false;
    // [기록 열기]: 메뉴 누름 뒷정리가 끝난 다음 차례에 연다(조직보고 창과 같은 까닭 — 폰에서 막 연 창이 그 누름과 겹치지 않게).
    if (d.bdOpen) {
      const back = menu?.querySelector('summary') || b;
      setTimeout(() => {
        if (l.kind === 'meeting') void import('./report-open.js').then(m => m.openReport(l.key)).catch(() => say('기록을 열지 못했어요.', true));
        else void import('./record-raw-view.js').then(m => m.openRawRecord({text: l.full || l.orig, day: D.dayText(l.day, l.end_day), line: l.text, place: hit.group.label, trigger: back})).catch(() => say('기록을 열지 못했어요.', true));
      }, 0);
      return;
    }
    if (d.bdEdit) { ctl.editing = {id}; ctl.draft = {body: l.text}; ctl.invalid = ''; ctl.focus = '[data-bd-field="body"]'; render(); say(''); return; }
    if (d.bdOrig) void mark(l, {report_body: null}, TEXT.orig);
    else if (d.bdOut) void mark(l, {choice: 'out'}, TEXT.out);
    else if (d.bdBack) void mark(l, {choice: null}, TEXT.back);
    else if (d.bdDetail) { const next = D.toggledDetail(l); void mark(l, {detail: next}, (next ?? l.base) === 'full' ? TEXT.full : TEXT.one); }
  });
  // 다른 화면이 사업 기록을 더하거나 다른 상자가 표시를 바꾸면 다시 읽는다(쓰는 중이면 다음 붙일 때). 화면이 다시 보이면 다시 읽는다.
  const quiet = () => { if (ctl.status !== 'ready' || !ctl.week) return; if (ctl.busy || ctl.editing || !el.isConnected) { ctl.stale = true; return; } void load({quiet: true}); };
  window.addEventListener(ND.BIZ_NOW_EVENT, e => { if (!writing && e.detail?.records) quiet(); });
  window.addEventListener(EVENT, e => { if (e.detail?.source !== ctl.id) quiet(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') quiet(); });

  // update({week, meetings, hidden, tree, lineOf}): meetings() = 그 화면이 이미 읽은 사업 보고(따로 읽지 않음), hidden = 늘 빼는 종류 목록(못 읽었으면 null),
  // tree() = 활성 사업 나무([{project, depth}], 없으면 null), lineOf(meeting) = 보고 한 줄. 같은 주면 사업 기록·표시를 다시 읽지 않고 다시 그리기만.
  function update({week, meetings = () => [], hidden = null, tree = () => null, lineOf} = {}) {
    ctl.meetings = Array.isArray(meetings()) ? meetings() : [];
    ctl.hidden = Array.isArray(hidden) ? hidden : null;
    ctl.tree = typeof tree === 'function' ? tree() : tree;
    if (lineOf) ctl.lineOfMeeting = lineOf;
    if (week && week !== ctl.week) { ctl.week = week; ctl.editing = null; ctl.draft = null; ctl.outOpen.clear(); ctl.msg = ''; void load(); return; }
    if (ctl.stale && !ctl.busy && !ctl.editing) { void load({quiet: true}); return; }
    if (!ctl.editing) render();
  }
  // 그 주를 다 읽었나(한글 파일·사진이 이 상자 결과를 쓸 때, B-4 ③·④).
  const ready = week => ctl.status === 'ready' && ctl.week === week && !ctl.stale;
  return {el, update, ready, groups: () => ctl.groups(), ctl};
}
export const BIZ_DETAIL_EVENT = EVENT;
