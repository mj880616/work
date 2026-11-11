// ORG-기록하나로 O-4(설계 docs/design/record-one.md 2-5~2-9·4절): 조직보고 '창' 공용 부품 하나 — 읽기·쓰기·한 조직 칸 그리기. (설계의 'record-window.js'는 이미 있는 큰 창 고치기 부품 이름이라 이 이름으로 둔다.)
// 담당조직 [전체 표] '이번 주 조직보고'(org-overview.js)가 쓰고, 홈 [주간 정리] 4.도 이 부품을 붙인다(상태 주인 하나).
// - 조직 칸 = 지난 3주~앞 2주 창의 조직 기록 줄 + 그 조직과 연결된 구글 캘린더 일정 줄(작은 '일정', 읽어서 보여 주기만, 저장 안 함).
//   규칙은 record-window-model.mjs. 조직당 7줄, 넘친 지난 줄은 '지난 기록 n'에서 [넣기], 뺀 줄은 '뺀 줄 n'에서 [되돌리기].
// - 쓰는 곳은 조직 기록 하나: [+ 쓰기] = app_suborganization_updates에 한 줄(기존 owner RLS 길 quick-save.js, source_kind user).
//   보고에만 다른 것(보고용 글·빼기·넣기)은 app_report_line_marks에 '그 주부터 × 그 줄' 한 행(이어짐 규칙은 모델). 원래 기록·일정은 바꾸지 않는다.
// - 확정 사진(app_report_snapshots)이 있는 주는 사진 줄 그대로(고칠 수 없음) + 흐린 '확정 뒤 추가'. 전환 주 앞은 옛 주별 조직보고 표 읽기 전용.
// - 표를 먼저 그리고 일정은 뒤에 같은 주인이 한 번 다시 그린다. 일정 읽기는 이 화면 세션 메모리에 5분(브라우저 저장소 없음).
// - ORG-줄순서: 표 [⋯] 맨 위 '줄 순서'(오래된 것 위로 ✓ / 최신 위로) = 서버 화면 설정 org_row_order(view-prefs.js). 칸 안 줄·펼친 '지난 기록'·'뺀 줄'이 모두 같은 순서를 따르고,
//   복사·한글 파일 글(lineTexts)은 주간보고 원칙대로 늘 날짜 오름차순이다.
// - ORG-뺀줄지난줄메뉴: 보이는 줄·'지난 기록'·'뺀 줄' 모두 줄 끝 작은 ⋯ 하나. 지난 기록·뺀 줄은 메뉴 맨 위가 [넣기]·[되돌리기], 그 아래는 보이는 줄 메뉴와 같다.
//   조직 기록 줄 ⋯ 맨 아래 [기록 삭제](빨강) = 조직 창과 같은 서버 길(org-row-delete.js) + 한 번 묻기, 지우면 표·조직 창 둘 다에서 사라진다. 일정 줄은 삭제 없이 [일정 열기].
//   PC 우클릭은 공용 context-menu.js가 그 줄의 ⋯를 연다(줄마다 ⋯가 하나라 따로 붙일 것 없음).
// - 다른 화면과는 같은 탭 이벤트 kptu:record-window-changed, 다른 기기와는 화면이 다시 보일 때 다시 읽는다.
import {missingTable} from './feed-model.mjs';
import {seoulDateKey} from './meeting-time.js';
import {chevHtml} from './fold-chevron.mjs';
import {rowMore} from './row-more.js';
import {fitAll} from './auto-grow.js';
import {waitHtml, waitInlineHtml, emptyHtml} from './wait-state.js';
import {readChoice} from './calendar-ref-data.js';
import {askConfirm} from './small-notice.js';
import {deleteOrgUpdate} from './org-row-delete.js';
import {viewPrefs} from './view-prefs.js';
import * as M from './record-window-model.mjs';
import * as DE from './record-day-edit.js';

const UPD = '/rest/v1/app_suborganization_updates';
const MARKS = '/rest/v1/app_report_line_marks';
const SNAPS = '/rest/v1/app_report_snapshots';
const UPD_COLS = 'id,organization_id,raw_text,occurred_at,end_day,source_kind,created_at';

const MARK_COLS = 'id,week_start,section,ref_kind,ref_key,report_body,choice,detail,updated_at';
const EVENT = 'kptu:record-window-changed';
const ORDER_EVENT = 'kptu:record-row-order';
const EVENT_TTL = 5 * 60 * 1000, EVENT_CAP = 250;
const enc = encodeURIComponent;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const dayIso = day => new Date(`${day}T00:00:00+09:00`).toISOString();
export const TEXT = {
  failed: '조직보고를 불러오지 못했어요.', saveFailed: '저장하지 못했어요. 다시 눌러 주세요.', noBody: '내용을 적어 주세요.', badDay: '날짜를 다시 선택해 주세요.',
  badEnd: '끝나는 날은 시작일과 같거나 뒤여야 해요.', saved: '저장했어요.', daySaved: '날짜를 바꿨어요.', added: '기록을 남겼어요.', out: '이번 주부터 보고에서 뺐어요.', back: '보고에 다시 넣었어요.',
  placed: '보고에 넣었어요.', orig: '원래 글로 되돌렸어요.', deleted: '기록을 삭제했어요.', delFailed: '기록을 삭제하지 못했어요. 다시 눌러 주세요.', delAsk: '이 기록을 삭제할까요?', evFailed: '일정을 못 읽었어요', evPartial: '일정 일부만',
};
export const thisWeek = () => M.mondayOf(seoulDateKey(Date.now()));
export {lineText} from './record-window-model.mjs';

// ---- 일정 읽기(기존 google-calendar 로그인 사용자 길, 읽기만). 같은 범위는 5분 동안 다시 쓴다. ----
const evCache = new Map();
const userOf = rt => rt?.context?.read?.()?.user?.id || '';
function readEvents(rt, from, to, cal = '') {
  const key = `${userOf(rt)}|${from}|${to}|${cal}`, hit = evCache.get(key);
  if (hit && Date.now() - hit.at < EVENT_TTL) return hit.flight;
  const flight = rt.api(`/functions/v1/google-calendar?action=events${cal ? `&onlyCalendarId=${enc(cal)}` : ''}&timeMin=${enc(dayIso(from))}&timeMax=${enc(dayIso(to))}`).then(data => {
    if (data?.connected === false || data?.needs_reconnect) return {off: true, events: [], partial: false};
    if (!Array.isArray(data?.events) || data?.authorized === false) throw new Error('calendar');
    const counts = new Map();
    for (const e of data.events) counts.set(e?.calendarId, (counts.get(e?.calendarId) || 0) + 1);
    return {events: data.events, partial: [...counts.values()].some(n => n >= EVENT_CAP)};
  });
  evCache.set(key, {at: Date.now(), flight});
  flight.catch(() => { if (evCache.get(key)?.flight === flight) evCache.delete(key); });
  return flight;
}
// 화면이 이미 읽어 둔 일정(그 범위 전체)을 넘겨주면 같은 범위를 다시 읽지 않는다.
export function seedEvents(rt, from, to, events) {
  if (!Array.isArray(events) || !from || !to) return;
  evCache.set(`${userOf(rt)}|${from}|${to}|`, {at: Date.now(), flight: Promise.resolve({events, partial: false})});
}

let seq = 0;
// host = 칸들이 들어 있는 상자(클릭·키를 여기서 받음), repaint = 그 화면 다시 그리기, say(text, error) = 상태 한 줄.
// openSource({org, record}, trigger) = [기록 열기](그 조직 상세를 열고 그 기록을 밝힘 — 화면 쪽).
// section = 'org'(4. 1) 조직보고, 기본) | 'site'(3. 2) 투쟁 사업장 칸 — 같은 조직 기록, 표시는 section 'site'로 따로, 3~7줄, 일정 줄은 M.SITE_EVENTS일 때만).
export function createRecordWindow({rt, workspaceId, week = thisWeek(), repaint = () => {}, say = () => {}, openSource = null, withEvents = true, section = 'org', getOrder = () => viewPrefs.getOrgRowOrder()} = {}) {
  if (section !== 'org') { section = 'site'; withEvents = withEvents && M.SITE_EVENTS; }
  const ctl = {
    id: `rw${++seq}`, rt, workspaceId, week, openSource, section, status: 'idle', orgs: [], orgIds: [], records: [], marks: [], marksOn: true, snaps: new Map(), legacy: new Map(),
    ev: {status: 'idle', items: [], partial: false, run: 0}, foldOpen: new Set(), outOpen: new Set(), editing: null, draft: null, invalid: '', busy: false, run: 0, host: null, focus: '', cols: {},
  };
  const c = () => ({rt: ctl.rt, ws: ctl.workspaceId});
  const announce = () => window.dispatchEvent(new CustomEvent(EVENT, {detail: {source: ctl.id, week: ctl.week}}));
  const old = () => M.isOldWeek(ctl.week);
  const snap = () => ctl.snaps.get(ctl.week) || null;
  ctl.readOnly = () => ctl.status !== 'ready' || old() || !!snap();
  ctl.disabled = () => ctl.busy || !!ctl.editing;

  // ---- 읽기 ----
  async function readRecords(ids, range) {
    const out = [];
    for (let i = 0; i < ids.length; i += 50) {
      const path = cols => `${UPD}?organization_id=in.(${ids.slice(i, i + 50).map(enc).join(',')})&occurred_at=gte.${enc(dayIso(range.from))}&occurred_at=lt.${enc(dayIso(range.to))}&select=${cols}&order=occurred_at.asc,id.asc&limit=3000`;
      // day_none·one_line은 DB 적용 뒤 생기는 칸 — 적용 전이면 그 칸 없이 다시 읽는다('없음'만 감추고, 한 줄은 임시 한 줄).
      const rows = await DE.readOptional(cols => ctl.rt.api(path(cols), {singleFlight: false}), UPD_COLS, ctl.cols);
      if (!Array.isArray(rows)) throw new Error('records');
      for (const r of rows) { const item = M.recordItem(r); if (item && ids.includes(item.org)) out.push(item); }
    }
    return out;
  }
  async function readMarks() {
    try {
      const rows = await ctl.rt.api(`${MARKS}?workspace_id=eq.${enc(ctl.workspaceId)}&section=eq.${ctl.section}&week_start=lte.${enc(ctl.week)}&select=${MARK_COLS}&order=week_start.asc&limit=5000`, {singleFlight: false});
      return {rows: Array.isArray(rows) ? rows : [], on: true};
    } catch (e) { if (missingTable(e)) return {rows: [], on: false}; throw e; }
  }
  async function readSnaps() {
    const weeks = [ctl.week, M.shiftWeek(ctl.week, -1)].filter(w => !M.isOldWeek(w));
    if (!weeks.length) return new Map();
    try {
      const rows = await ctl.rt.api(`${SNAPS}?workspace_id=eq.${enc(ctl.workspaceId)}&week_start=in.(${weeks.join(',')})&select=week_start,confirmed_at,rows&limit=2`, {singleFlight: false});
      return new Map((Array.isArray(rows) ? rows : []).map(r => [r.week_start, r]));
    } catch { return new Map(); } // 사진을 못 읽으면 창 규칙으로 보인다(작은 '사진 없음' 대신 그대로)
  }
  async function readLegacy() {
    const {readWeekLines} = await import('./weekly-org-lines.js');
    const r = await readWeekLines({rt: ctl.rt, workspaceId: ctl.workspaceId, week: ctl.week, orgIds: ctl.orgIds});
    ctl.legacyMissing = !!r.missing; // 옛 표가 아직 없는(DB 적용 전) 곳: 화면이 그 주 임시저장 칸을 대신 그린다(journal.js)
    const out = new Map();
    for (const id of ctl.orgIds) out.set(id, (r.rows?.get(id) || []).filter(l => l.state === 'in').map(l => ({id: `old:${l.id}`, kind: 'old', key: l.id, day: l.day || '', end_day: l.end_day || null, text: M.reportLine(l.body), full: String(l.body ?? '')})).sort((a, b) => (a.day || '9').localeCompare(b.day || '9')));
    return out;
  }
  // orgs = [{id, name, aliases}] 화면 순서. quiet = 이미 보이는 표를 지우지 않고 다시 읽기.
  ctl.load = async (orgs = ctl.orgs, {quiet = false} = {}) => {
    ctl.orgs = [...orgs]; ctl.orgIds = ctl.orgs.map(o => o.id);
    const run = ++ctl.run;
    if (!quiet || ctl.status !== 'ready') { ctl.status = 'loading'; repaint(); }
    try {
      if (old()) {
        const legacy = await readLegacy();
        if (run !== ctl.run) return;
        ctl.legacy = legacy; ctl.status = 'ready'; repaint(); return;
      }
      const [records, marks, snaps] = await Promise.all([ctl.orgIds.length ? readRecords(ctl.orgIds, M.readRange(ctl.week)) : [], readMarks(), readSnaps()]);
      if (run !== ctl.run) return;
      ctl.records = records; ctl.marks = marks.rows; ctl.marksOn = marks.on; ctl.snaps = snaps; ctl.status = 'ready';
    } catch (e) { if (run !== ctl.run) return; console.warn('record window read failed', e?.message || e); ctl.status = 'error'; }
    repaint();
    if (ctl.status === 'ready' && withEvents) void loadEvents(run);
  };
  // 일정은 표를 그린 뒤에. 창 두 범위 + 조직 참고 캘린더(골랐을 때만). 실패해도 기록 줄은 그대로.
  async function loadEvents(run) {
    const evRun = ++ctl.ev.run, week = ctl.week;
    if (ctl.ev.week !== week) { ctl.ev.items = []; ctl.ev.partial = false; }
    ctl.ev.status = 'loading'; repaint();
    try {
      const ranges = M.eventRanges(week), win = M.orgWindow(week);
      const [choice, ...parts] = await Promise.all([readChoice(ctl.rt).catch(() => ({choice: {}})), ...ranges.map(r => readEvents(ctl.rt, r.from, r.to))]);
      const ref = choice?.choice?.calendar && choice?.choice?.org ? choice.choice : null;
      if (parts.every(p => p.off)) { if (evRun === ctl.ev.run && run === ctl.run) { ctl.ev = {...ctl.ev, status: 'off', items: [], week}; repaint(); } return; }
      const extra = ref ? await readEvents(ctl.rt, win.from, win.to, ref.calendar).catch(() => ({events: []})) : {events: []};
      if (evRun !== ctl.ev.run || run !== ctl.run) return;
      const all = [...parts.flatMap(p => p.events), ...extra.events.map(e => ({...e, calendarId: e.calendarId ?? ref.calendar}))];
      ctl.ev = {...ctl.ev, status: 'ready', items: M.eventItems(all, ctl.orgs, ref), partial: parts.some(p => p.partial) || !!extra.partial, week};
    } catch { if (evRun !== ctl.ev.run || run !== ctl.run) return; ctl.ev = {...ctl.ev, status: 'error', week}; }
    // 쓰는 중에 일정이 와서 다시 그려도 입력 칸 초점은 그대로(글은 draft에 있음).
    const f = document.activeElement;
    if (!ctl.focus && f?.matches?.('[data-rw-field]') && ctl.host?.contains(f)) ctl.focus = `[data-rw-field="${f.dataset.rwField}"]`;
    repaint(); ctl.afterPaint();
  }
  ctl.setWeek = week => { if (!week || week === ctl.week) return; ctl.week = week; ctl.editing = null; ctl.draft = null; ctl.foldOpen.clear(); ctl.outOpen.clear(); void ctl.load(ctl.orgs); };

  // ---- 칸 계산 ----
  const events = () => (ctl.ev.week === ctl.week ? ctl.ev.items : []);
  ctl.order = () => M.rowOrderOf(getOrder());
  ctl.cell = (orgId, order = ctl.order()) => {
    if (old()) return {mode: 'old', lines: M.orderLines(ctl.legacy.get(orgId) || [], order)};
    const base = {org: orgId, week: ctl.week, records: ctl.records, events: events(), marks: ctl.marks, order};
    const s = snap();
    if (s && ctl.section === 'site') return {mode: 'snapshot', lines: M.orderLines(M.snapshotCell(s, orgId, 'site', {marks: ctl.marks, week: ctl.week, records: ctl.records})?.lines || [], order), after: []};
    if (s) { const v = M.snapshotView({...base, snapshot: s}); return {mode: 'snapshot', lines: v.lines, after: v.after}; }
    if (ctl.section === 'site') return {mode: 'window', ...M.siteCell(base)};
    const prevWeek = M.shiftWeek(ctl.week, -1);
    const prevIds = M.isOldWeek(prevWeek) ? new Set() : M.shownIds({...base, week: prevWeek, snapshot: ctl.snaps.get(prevWeek) || null});
    return {mode: 'window', ...M.orgCell({...base, prevIds})};
  };
  // 보고 줄 글('- 11.2. 글') — 복사·한글 파일. 사진 주는 사진 줄, 옛 주는 옛 넣은 줄.
  // 복사·한글 글은 고른 순서와 상관없이 늘 날짜 오름차순(주간보고 원칙).
  ctl.lineTexts = orgId => { const x = ctl.cell(orgId, 'asc'); return (x.mode === 'window' ? x.shown : x.lines).map(M.lineText); };
  // ORG-기록하나로 O-6(설계 2-8): 한글 파일·확정 사진 줄 = 화면에 보이는 그대로(날짜 오름차순). 일정은 다 읽은 뒤에만 '준비됨'(읽는 중이면 파일에 일정 줄이 빠지므로).
  ctl.fileReady = () => ctl.status === 'ready' && (old() || !withEvents || (['ready', 'error', 'off'].includes(ctl.ev.status) && ctl.ev.week === ctl.week));
  ctl.fileLines = orgId => M.fileLines(ctl.cell(orgId, 'asc'));
  ctl.snapshotRows = () => ctl.orgs.map(o => M.snapshotRow({section: ctl.section, org: o.id, label: o.name, lines: ctl.fileLines(o.id), seen: ctl.section === 'org' ? M.seenEvents({org: o.id, week: ctl.week, events: events()}) : []}));
  const findLine = id => { for (const o of ctl.orgIds) { const x = ctl.cell(o); for (const l of [...(x.shown || []), ...(x.folded || []), ...(x.out || []), ...(x.lines || [])]) if (l.id === id) return {org: o, line: l}; } return null; };

  // ---- 그리기 ----
  const moreSlot = spec => `<span class="wl-more-slot" data-wl-more="${esc(JSON.stringify(spec))}"></span>`;
  const tags = l => `${l.kind === 'event' ? '<span class="rw-tag">일정</span>' : ''}${l.last ? '<span class="rw-last">지난주</span>' : ''}`;
  // 표 [⋯](ORG-줄순서): 맨 위 '줄 순서'. 누르면 바로 바뀌고 서버 화면 설정에 남는다(폰·PC 같음).
  ctl.orderMenuHtml = () => {
    const cur = ctl.order();
    return moreSlot({label: '표 메뉴', data: {rwTable: '1'}, items: [
      {text: `${cur === 'asc' ? '✓ ' : ''}오래된 것 위로`, data: {rwOrder: 'asc'}, aria: `줄 순서 오래된 것 위로${cur === 'asc' ? ', 선택됨' : ''}`},
      {text: `${cur === 'desc' ? '✓ ' : ''}최신 위로`, data: {rwOrder: 'desc'}, aria: `줄 순서 최신 위로${cur === 'desc' ? ', 선택됨' : ''}`}]});
  };
  // where: 'shown'(보이는 줄) | 'folded'(지난 기록, 맨 위 [넣기]) | 'out'(뺀 줄, 맨 위 [되돌리기]). 그 아래 항목은 셋 다 같다(이미 보고에 없는 줄에는 [보고에서 빼기]만 없다).
  const lineMore = (l, where = 'shown') => {
    const items = [];
    if (where === 'folded') items.push({text: '넣기', data: {rwIn: l.id}, aria: `보고에 넣기: ${l.text}`});
    if (where === 'out') items.push({text: '되돌리기', data: {rwBack: l.id}, aria: `보고에 되돌리기: ${l.text}`});
    if (ctl.marksOn) {
      items.push({text: '보고용으로 수정', data: {rwEdit: l.id}, aria: `보고용으로 수정: ${l.text}`});
      if (l.edited) items.push({text: '원래 글로', data: {rwOrig: l.id}});
      if (where === 'shown') items.push({text: '보고에서 빼기', data: {rwOut: l.id}, danger: true, aria: `보고에서 빼기: ${l.text}`});
    }
    if (l.kind === 'event') { items.push({text: '기록으로 남기기', data: {rwKeep: l.id}}); items.push({text: '일정 열기', data: {rwEvent: l.id}}); } // 일정 줄 = 삭제 없음(원래 주인은 달력)
    else {
      if (l.kind === 'org_update') items.push({text: '날짜 수정', data: {rwDay: l.id}, aria: `날짜 수정: ${l.text}`}); // ORG-기록날짜고치기: 날짜 누름과 같은 칸
      if (l.full) items.push({text: '원문 보기', data: {rwRaw: l.id}}); // RECORD-한줄: 표는 한 줄, 원문은 작은 창에 그대로
      if (typeof ctl.openSource === 'function') items.push({text: '기록 열기', data: {rwOpen: l.id}});
      if (l.kind === 'org_update') items.push({text: '기록 삭제', data: {rwDel: l.id}, danger: true, aria: `기록 삭제: ${l.text}`}); // 조직 창 [삭제]와 같은 서버 길 + 한 번 묻기
    }
    return items.length ? moreSlot({label: `줄 메뉴: ${l.text}`, data: {rwMore: l.id}, items}) : '';
  };
  const lineHtml = (orgId, l, where = 'shown') => {
    if (ctl.editing?.id === l.id && !ctl.editing.day) return reportForm(l);
    const faint = where !== 'shown' ? ' is-last' : '';
    const ro = ctl.readOnly() || ctl.disabled();
    const dayOpen = ctl.editing?.id === l.id && ctl.editing.day;
    // 날짜: 조직 기록 줄은 눌러서 날짜 수정(시안 org-record-day-edit.html ①). 일정·읽기 전용·다른 칸 쓰는 중이면 글자만.
    const dayLabel = `- ${M.lineDay(l)}`.trimEnd();
    const dayHtml = l.kind === 'org_update' && where !== 'after' && (dayOpen || !ro)
      ? `<button type="button" class="row-act wl-day rw-day-btn${dayOpen ? ' is-on' : ''}" data-rw-day="${esc(l.id)}" aria-label="날짜 수정: ${esc(M.lineDay(l) || '날짜 없음')}" aria-expanded="${dayOpen ? 'true' : 'false'}"${dayOpen ? ' disabled' : ''}>${esc(dayLabel)}</button>`
      : `<span class="wl-day">${esc(dayLabel)}</span>`;
    const act = where === 'shown' || where === 'folded' || where === 'out' ? (ro ? '' : lineMore(l, where))
      : where === 'after' ? '<span class="rw-after-tag">확정 뒤 추가</span>' : '';
    return `<div class="wl-line rw-line${faint}${where === 'after' ? ' rw-after' : ''}" data-rw-line="${esc(l.id)}" data-rw-kind="${esc(l.kind)}">${dayHtml}<span class="wl-body"><span class="wl-text">${esc(l.text)}</span>${where === 'shown' || where === 'after' ? tags(l) : l.kind === 'event' ? '<span class="rw-tag">일정</span>' : ''}</span>${dayOpen ? '' : act}</div>${dayOpen ? dayForm(l) : ''}`;
  };
  // 날짜 수정 칸(시안 ②~④): 줄 바로 아래 [하루|기간|없음] + 달력 + [취소][저장] — 모양은 record-day-edit.js 하나. 없음은 서버에 칸이 있을 때만.
  const dayForm = l => DE.dayFormHtml(ctl.draft || M.dayDraft(l), {prefix: 'rw', id: l.id, noneOn: ctl.cols.day_none === true, busy: ctl.busy, invalid: ctl.invalid});
  const reportForm = l => {
    const dis = ctl.busy ? ' disabled' : '', d = ctl.draft || {};
    return `<div class="wl-form" data-rw-form="${esc(l.id)}"><textarea rows="1" class="wl-f-body" data-rw-field="body" data-autogrow data-enter-field="single" aria-label="보고용 글" maxlength="${M.BODY_MAX}" autocomplete="off"${ctl.invalid === 'body' ? ' aria-invalid="true"' : ''}${dis}>${esc(d.body ?? M.editBase(l))}</textarea>`
      + `<span class="row-act wl-btns btn-row"><button type="button" class="row-act wl-btn" data-rw-cancel${dis}>취소</button><button type="button" class="row-act wl-btn is-main" data-rw-save${dis}>저장</button></span></div>`;
  };
  const recordForm = orgId => {
    const d = ctl.draft || {}, dis = ctl.busy ? ' disabled' : '', inv = f => (ctl.invalid === f ? ' aria-invalid="true"' : '');
    return `<div class="wl-form" data-rw-form="new" data-rw-org="${esc(orgId)}">`
      + `<span class="wl-f-days"><input type="date" data-rw-field="day" aria-label="날짜" value="${esc(d.day || '')}"${inv('day')}${dis}><span aria-hidden="true">~</span><input type="date" data-rw-field="end_day" aria-label="끝나는 날(선택)" value="${esc(d.end_day || '')}"${d.day ? ` min="${esc(d.day)}"` : ''}${inv('end_day')}${dis}></span>`
      + `<textarea rows="1" class="wl-f-body" data-rw-field="body" data-autogrow data-enter-field="single" aria-label="조직 기록" maxlength="${M.RECORD_MAX}" autocomplete="off"${inv('body')}${dis}>${esc(d.body || '')}</textarea>`
      + `<span class="row-act wl-btns btn-row"><button type="button" class="row-act wl-btn" data-rw-cancel${dis}>취소</button><button type="button" class="row-act wl-btn is-main" data-rw-save${dis}>저장</button></span></div>`;
  };
  const fold = (orgId, kind, list, label) => {
    if (!list.length) return {btn: '', box: ''};
    const set = kind === 'out' ? ctl.outOpen : ctl.foldOpen, open = set.has(orgId);
    return {btn: `<button type="button" class="row-act wl-more" data-rw-fold="${kind}" data-rw-org="${esc(orgId)}" aria-expanded="${open}">${label} ${list.length} ${chevHtml(open)}</button>`,
      box: open ? `<div class="rw-fold" data-rw-fold-box="${kind}">${list.map(l => lineHtml(orgId, l, kind)).join('')}</div>` : ''};
  };
  ctl.cellHtml = orgId => {
    const x = ctl.cell(orgId), adding = ctl.editing?.id === 'new' && ctl.editing.orgId === orgId;
    let html = '';
    if (x.mode === 'old' || x.mode === 'snapshot') {
      html += x.lines.map(l => `<div class="wl-line rw-line" data-rw-line="${esc(l.id)}"><span class="wl-day">${esc(`- ${M.lineDay(l)}`.trimEnd())}</span><span class="wl-body"><span class="wl-text">${esc(l.text)}</span></span></div>`).join('');
      if (x.mode === 'snapshot') html += x.after.map(l => lineHtml(orgId, l, 'after')).join('');
      if (!html) html = '<span class="wl-empty">—</span>';
      return `<div class="wl-cell" data-wl-cell="${esc(orgId)}">${html}</div>`;
    }
    html += x.shown.map(l => lineHtml(orgId, l)).join('');
    if (!x.shown.length && !adding) html += '<span class="wl-empty">—</span>';
    if (adding) html += recordForm(orgId);
    // 칸 아래 한 줄: [지난 기록 n] [뺀 줄 n] [+ 쓰기] — 펼친 줄은 그 아래.
    const f1 = fold(orgId, 'folded', x.folded, '지난 기록'), f2 = fold(orgId, 'out', x.out, '뺀 줄');
    const add = adding ? '' : `<button type="button" class="row-act wl-add" data-rw-add="${esc(orgId)}"${ctl.disabled() ? ' disabled' : ''}>+ 쓰기</button>`;
    if (f1.btn || f2.btn || add) html += `<div class="rw-foot btn-row">${f1.btn}${f2.btn}${add}</div>`;
    html += f1.box + f2.box;
    return `<div class="wl-cell" data-wl-cell="${esc(orgId)}">${html}</div>`;
  };
  // 표 위 작은 한 줄: 옛 보고·개인 확정본 날짜·일정 읽기 상태.
  ctl.noteHtml = () => {
    if (ctl.status !== 'ready') return '';
    const bits = [];
    if (old()) bits.push(esc('옛 보고'));
    const s = snap();
    if (s) { const at = seoulDateKey(s.confirmed_at); bits.push(esc(`개인 확정본 ${M.dayText(at)}`)); }
    if (!old() && !s) {
      if (ctl.ev.status === 'loading') bits.push(`일정 ${waitInlineHtml()}`); // 일정 읽기 기다림(공용 부품)
      else if (ctl.ev.status === 'error') bits.push(esc(TEXT.evFailed));
      else if (ctl.ev.status === 'ready' && ctl.ev.partial) bits.push(esc(TEXT.evPartial));
    }
    return bits.length ? `<p class="wl-note rw-note" data-rw-note>${bits.join(' · ')}</p>` : '';
  };
  ctl.afterPaint = () => {
    for (const slot of ctl.host?.querySelectorAll('[data-wl-more]') ?? []) {
      let spec = null; try { spec = JSON.parse(slot.dataset.wlMore); } catch { /* 깨진 자리표는 ⋯ 없이 */ }
      if (spec) slot.replaceWith(rowMore(document, spec)); else slot.remove();
    }
    fitAll(ctl.host);
    if (!ctl.host || !ctl.focus) return;
    const el = ctl.host.querySelector(ctl.focus);
    el?.focus({preventScroll: true});
    if (el?.matches('input, textarea')) el.scrollIntoView({block: 'nearest'});
    ctl.focus = '';
  };
  const redraw = () => { repaint(); ctl.afterPaint(); };
  // 줄 순서: 서버 화면 설정에 저장(적용 전 서버가 거절하면 view-prefs가 되돌리고 알린다 — 표도 되돌아간 순서로 다시 그린다). 같은 탭의 다른 표도 같이 다시 그린다.
  ctl.setOrder = value => {
    const next = M.rowOrderOf(value);
    if (next === ctl.order()) return;
    viewPrefs.setOrgRowOrder(next);
    window.dispatchEvent(new CustomEvent(ORDER_EVENT));
  };
  const orderRedraw = () => { if (ctl.status === 'ready' && ctl.host?.isConnected) redraw(); };
  window.addEventListener(ORDER_EVENT, orderRedraw);
  window.addEventListener('kptu:view-prefs-rejected', e => { if ((e.detail?.paths || []).includes('org_row_order')) orderRedraw(); });

  // ---- 쓰기 ----
  const work = async (fn, done, failed = TEXT.saveFailed) => {
    if (ctl.busy) return false;
    ctl.busy = true; say('저장하는 중…'); repaint();
    let ok = true;
    try { await fn(); } catch (e) { ok = false; console.warn('record window write failed', e?.message || e); }
    ctl.busy = false;
    if (ok) { ctl.editing = null; ctl.draft = null; ctl.invalid = ''; }
    say(ok ? done : failed, !ok);
    redraw();
    if (ok) announce();
    return ok;
  };
  // 그 주 표시 바꾸기(모델 nextMark가 넣기·고치기·지우기 중 하나를 정함).
  const mark = (l, change, done) => work(async () => {
    const p = M.nextMark(ctl.marks, {section: ctl.section, kind: l.kind, key: l.key, week: ctl.week}, change);
    if (p.op === 'insert') {
      const rows = await ctl.rt.api(`${MARKS}?select=${MARK_COLS}`, {method: 'POST', prefer: 'return=representation', singleFlight: false, body: {workspace_id: ctl.workspaceId, ...p.row}});
      if (!Array.isArray(rows) || !rows[0]) throw new Error('mark');
      ctl.marks = [...ctl.marks, rows[0]];
    } else if (p.op === 'update') {
      const rows = await ctl.rt.api(`${MARKS}?id=eq.${enc(p.id)}&workspace_id=eq.${enc(ctl.workspaceId)}&select=${MARK_COLS}`, {method: 'PATCH', prefer: 'return=representation', singleFlight: false, body: p.row});
      if (!Array.isArray(rows) || !rows[0]) throw new Error('mark');
      ctl.marks = ctl.marks.map(m => (m.id === p.id ? rows[0] : m));
    } else if (p.op === 'delete') {
      await ctl.rt.api(`${MARKS}?id=eq.${enc(p.id)}&workspace_id=eq.${enc(ctl.workspaceId)}`, {method: 'DELETE', singleFlight: false});
      ctl.marks = ctl.marks.filter(m => m.id !== p.id);
    }
  }, done);
  ctl.save = async () => {
    const e = ctl.editing; if (!e || ctl.busy) return;
    if (e.id === 'new') {
      const v = M.checkRecord(ctl.draft);
      if (!v.ok) { ctl.invalid = v.field; say(v.field === 'body' ? TEXT.noBody : v.field === 'end_day' ? TEXT.badEnd : TEXT.badDay, true); ctl.focus = `[data-rw-field="${v.field}"]`; redraw(); return; }
      const user = userOf(ctl.rt);
      await work(async () => {
        const {saveOrganizationUpdate} = await import('./quick-save.js');
        const rows = await saveOrganizationUpdate({organization_id: e.orgId, raw_text: v.value.body, created_by: user, occurred_at: M.occurredAt(v.value.day), end_day: v.value.end_day, source_kind: 'user'}, ctl.rt);
        const item = Array.isArray(rows) ? M.recordItem({created_at: new Date().toISOString(), ...rows[0]}) : null;
        if (item) ctl.records = [...ctl.records, item];
      }, TEXT.added);
      return;
    }
    const hit = findLine(e.id); if (!hit) return;
    if (e.day) { await saveDay(hit.line); return; }
    const v = M.reportChange(hit.line, ctl.draft?.body);
    if (!v.ok) { ctl.invalid = 'body'; say(TEXT.noBody, true); ctl.focus = '[data-rw-field="body"]'; redraw(); return; }
    await mark(hit.line, {report_body: v.value}, TEXT.saved);
  };
  // 날짜 수정 저장: 원래 조직 기록의 occurred_at(서울 시각 그대로 날짜만)·end_day·day_none만 고친다(기존 owner RLS 길, 글은 그대로).
  // 보고용 글·빼기 표시는 줄 열쇠(기록 id)에 붙어 있어 그대로 따라간다. 그 주 창 밖으로 가면 그 주에서 빠진다(창 규칙).
  async function saveDay(l) {
    const v = M.checkDayEdit(l, ctl.draft || M.dayDraft(l), {noneOn: ctl.cols.day_none === true, today: seoulDateKey(Date.now())});
    if (!v.ok) { ctl.invalid = v.field; say(v.field === 'end_day' ? TEXT.badEnd : TEXT.badDay, true); ctl.focus = `[data-rw-form="${CSS.escape(l.id)}"] [data-rw-field="${v.field === 'mode' ? 'day' : v.field}"]`; redraw(); return; }
    if (!v.value) { ctl.cancel(); return; }
    await work(async () => {
      const row = await DE.patchRecordDay(ctl.rt, {id: l.key, org: l.org, value: v.value, cols: DE.colsOf(UPD_COLS, ctl.cols)});
      const item = M.recordItem(row);
      ctl.records = ctl.records.filter(r => !(r.kind === 'org_update' && r.key === l.key)).concat(item ? [item] : []);
    }, TEXT.daySaved);
  }
  // 조직 기록 줄 삭제(조직 창 wdDelRow와 같은 서버 길, org-row-delete.js): 한 번 묻고 → 그 조직의 그 기록 한 행 DELETE(owner RLS) → 표에서 빼고 다른 화면(조직 창 등)은 같은 탭 알림으로 다시 읽는다.
  // 보고용 표시(app_report_line_marks)는 줄 열쇠만 붙어 있어 기록이 없어지면 저절로 쓰이지 않는다(조직 창 삭제도 마찬가지, 새로 지우는 길을 만들지 않는다).
  async function deleteLine({org, line: l}, anchor) {
    const week = ctl.week;
    const yes = await askConfirm(anchor, {text: TEXT.delAsk, ok: '삭제', danger: true});
    if (!yes || week !== ctl.week || ctl.busy || ctl.editing || !findLine(l.id)) return;
    await work(async () => {
      await deleteOrgUpdate((path, opts) => ctl.rt.api(path, opts), l.key, org);
      ctl.records = ctl.records.filter(r => !(r.kind === 'org_update' && r.key === l.key));
      ctl.focus = `[data-rw-add="${CSS.escape(org)}"]`; // 줄이 없어졌으니 초점은 그 칸의 [+ 쓰기]로
    }, TEXT.deleted, TEXT.delFailed);
  }
  const openDay = (orgId, l) => { ctl.editing = {orgId, id: l.id, day: true}; ctl.draft = M.dayDraft(l); ctl.invalid = ''; ctl.focus = `[data-rw-form="${CSS.escape(l.id)}"] [aria-pressed="true"]`; say(''); redraw(); };
  ctl.cancel = () => { const e = ctl.editing; ctl.editing = null; ctl.draft = null; ctl.invalid = ''; ctl.focus = e ? (e.id === 'new' ? `[data-rw-add="${e.orgId}"]` : e.day ? `[data-rw-day="${CSS.escape(e.id)}"]` : '') : ''; say(''); redraw(); };
  const openAdd = (orgId, d = null) => {
    const today = seoulDateKey(Date.now());
    ctl.editing = {orgId, id: 'new'}; ctl.draft = d || {day: today, end_day: '', body: ''}; ctl.invalid = ''; ctl.focus = '[data-rw-field="body"]'; say(''); redraw();
  };

  // ---- 입력 받기(화면 상자 하나에 한 번) ----
  ctl.bind = host => {
    if (ctl.host === host) return;
    ctl.host = host;
    host.addEventListener('input', e => { const t = e.target; if (!t.matches?.('[data-rw-field]')) return; ctl.draft = {...(ctl.draft || {}), [t.dataset.rwField]: t.value}; if (ctl.invalid === t.dataset.rwField) { ctl.invalid = ''; t.removeAttribute('aria-invalid'); } });
    host.addEventListener('change', e => { const t = e.target; if (!t.matches?.('[data-rw-field]')) return; ctl.draft = {...(ctl.draft || {}), [t.dataset.rwField]: t.value}; if (t.dataset.rwField === 'day') t.closest('.wl-form')?.querySelector('[data-rw-field="end_day"]')?.setAttribute('min', t.value); });
    host.addEventListener('keydown', e => {
      if (!e.target.matches?.('[data-rw-field]')) return;
      if (e.key === 'Enter' && !e.isComposing && (e.ctrlKey || e.metaKey || e.target.dataset.rwField === 'body')) { e.preventDefault(); void ctl.save(); }
      else if (e.key === 'Escape' && ctl.editing) { e.preventDefault(); ctl.cancel(); }
    });
    host.addEventListener('click', e => {
      const b = e.target.closest?.('button'); if (!b || b.disabled || !host.contains(b)) return;
      const d = b.dataset;
      if (d.rwOrder) { ctl.setOrder(d.rwOrder); return; }
      if (d.rwAdd) { if (!ctl.disabled() && !ctl.readOnly()) openAdd(d.rwAdd); return; }
      if ('rwCancel' in d) { ctl.cancel(); return; }
      if ('rwSave' in d) { void ctl.save(); return; }
      if (d.rwMode && ctl.editing?.day) { const hit = findLine(ctl.editing.id); ctl.draft = DE.withMode(ctl.draft || (hit ? M.dayDraft(hit.line) : {}), d.rwMode); ctl.invalid = ''; ctl.focus = `[data-rw-mode="${d.rwMode}"]`; redraw(); return; }
      if (d.rwFold) { const set = d.rwFold === 'out' ? ctl.outOpen : ctl.foldOpen, org = d.rwOrg; if (set.has(org)) set.delete(org); else set.add(org); ctl.focus = `[data-rw-fold="${d.rwFold}"][data-rw-org="${CSS.escape(org)}"]`; redraw(); return; }
      const id = d.rwEdit || d.rwOrig || d.rwOut || d.rwIn || d.rwBack || d.rwOpen || d.rwKeep || d.rwEvent || d.rwRaw || d.rwDay || d.rwDel;
      if (!id || ctl.disabled()) return;
      const hit = findLine(id); if (!hit) return;
      const l = hit.line;
      const box = b.closest('details'); if (box) box.open = false; // 줄 메뉴는 여기서 닫는다
      // [기록 열기]: 메뉴 항목 누름(작은 메뉴 겹 닫기 → 다시 누름, details-menu-back.js) 처리가 다 끝난 다음 차례에 연다.
      // 같은 누름 안에서 열면 폰에서 막 연 조직 상세가 그 누름의 뒷정리와 겹쳐 열리지 않는다(E2E 412px로 확인).
      if (d.rwOpen) { if (typeof ctl.openSource === 'function' && l.kind === 'org_update') setTimeout(() => ctl.openSource({org: hit.org, record: `up:${l.key}`}, b), 0); return; }
      // [원문 보기]: 기록 열기와 같은 까닭으로 다음 차례에 연다. 닫으면 초점은 그 줄 ⋯로.
      if (d.rwRaw) {
        const back = box?.querySelector('summary') || b, place = ctl.orgs.find(o => String(o.id) === hit.org)?.name || '';
        setTimeout(() => void import('./record-raw-view.js').then(m => m.openRawRecord({text: l.full, day: M.lineDay(l), line: l.text, place, trigger: back})).catch(() => say('원문을 열지 못했어요.', true)), 0);
        return;
      }
      if (d.rwEvent) { void import('./event-open.js').then(m => m.openGoogleEvent(l.key, l.cal)).catch(() => say('일정을 열지 못했어요.', true)); return; }
      if (ctl.readOnly()) return;
      if (d.rwDel) { if (l.kind === 'org_update') void deleteLine(hit, box?.querySelector('summary') || b); return; }
      if (d.rwKeep) { openAdd(hit.org, {day: l.day, end_day: l.end_day || '', body: l.full || l.orig || l.text}); return; }
      if (d.rwDay) { if (l.kind === 'org_update') openDay(hit.org, l); return; }
      if (d.rwEdit) { ctl.editing = {orgId: hit.org, id}; ctl.draft = {body: M.editBase(l)}; ctl.invalid = ''; ctl.focus = '[data-rw-field="body"]'; say(''); redraw(); return; }
      if (d.rwOrig) void mark(l, {report_body: null}, TEXT.orig);
      else if (d.rwOut) void mark(l, {choice: 'out'}, TEXT.out);
      else if (d.rwIn) void mark(l, {choice: 'in'}, TEXT.placed);
      else if (d.rwBack) void mark(l, {choice: null}, TEXT.back);
    });
  };
  // 다른 화면(같은 탭)이 바꾸면 다시 읽기, 화면이 다시 보이면 다시 읽기(캐시 지우기가 아니라 다시 읽기).
  const quiet = () => { if (ctl.status === 'ready' && !ctl.busy && !ctl.editing && ctl.host?.isConnected) void ctl.load(ctl.orgs, {quiet: true}); };
  window.addEventListener(EVENT, e => { if (e.detail?.source !== ctl.id) quiet(); });
  window.addEventListener('kptu:api-saved', e => { if (!ctl.busy && String(e.detail?.path || '').includes('/app_suborganization_updates')) quiet(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') quiet(); });
  return ctl;
}
export const RECORD_WINDOW_EVENT = EVENT;

// 조직보고 표(조직 | 조직현황) — 담당조직 [전체 표]·홈 [주간 정리] 4.·업무일지가 이 함수 하나로 그린다.
// orgs = [{id, name}] 보고 순서. orgHtml(o) 조직 칸 안쪽, stageOf(o) 조직 이름 밑 작은 글(쟁의 단계).
// orderMenu = 표 위 오른쪽 [⋯](줄 순서)를 이 함수가 그릴지(false면 화면이 ctl.orderMenuHtml()을 자기 위쪽 줄에 둔다).
// cellHtml(o) = 그 조직 칸을 화면이 따로 그릴 때(예: 홈 [주간 정리] 4.의 '투쟁 사업장 보고 참고' 한 줄), null이면 창 칸.
export function windowTableHtml(ctl, orgs, {msg = '', error = false, orgHtml = null, stageOf = null, headOrg = '조직', headRows = '조직현황', tableClass = '', cellHtml = null, orderMenu = true} = {}) {
  if (ctl.status === 'error') return `<p class="wl-note" role="alert">${TEXT.failed}</p>`;
  if (ctl.status !== 'ready') return waitHtml({rows: 2});
  if (!orgs.length) return emptyHtml('담당조직 없음');
  const rows = orgs.map(o => { const stage = stageOf ? stageOf(o) : ''; return `<tr data-wl-org-row="${esc(o.id)}"><th scope="row" class="wl-c-org"><div class="wl-org-line">${orgHtml ? orgHtml(o) : `<span class="wl-org" title="${esc(o.name)}">${esc(o.name)}</span>`}</div>${stage ? `<span class="wl-stage">${esc(stage)}</span>` : ''}</th><td class="wl-c-rows">${(cellHtml && cellHtml(o)) || ctl.cellHtml(o.id)}</td></tr>`; }).join('');
  const tools = orderMenu ? `<div class="wl-tools">${ctl.orderMenuHtml()}</div>` : '';
  return `${tools}${ctl.noteHtml()}<table class="wl-table${tableClass ? ` ${tableClass}` : ''}" data-wl-table data-rw-table><thead><tr><th scope="col" class="wl-c-org">${headOrg}</th><th scope="col">${esc(headRows)}</th></tr></thead><tbody>${rows}</tbody></table>`
    + `<p class="wl-status${error ? ' is-error' : ''}" role="status" aria-live="polite" data-wl-status>${esc(msg)}</p>`;
}
