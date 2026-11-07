// WEEKLY-메뉴짝짓기 P3(docs/design/weekly-menu-pairing.md 3·4·5절): 주별 조직보고 표(app_weekly_org_lines) 공용 부품 하나 — 읽기·쓰기·한 조직 칸 그리기.
// 담당조직 '이번 주 조직보고'(org-overview.js)와 홈 [주간 정리] 4. 조직보고(P6)가 같은 부품으로 같은 줄을 읽고 쓴다(결정 B: 어디서 고쳐도 저장 자리 하나).
// - 줄 하나 = 행 하나. 고치기는 읽은 updated_at 조건 쓰기 → 0행이면 그사이 다른 화면이 고친 것: 그 줄만 다시 읽고 그 자리에
//   "다른 화면에서 먼저 고쳤어요: '…'" + [그대로 두기] [내 글로 바꾸기]. 다른 줄은 영향 없음. 줄 더하기는 충돌이 아니다(새 행).
// - 흐린 제안 줄(state suggested)은 [✓ 넣기]·[고치기]·[×](빼기 = state dropped, 지우지 않음 — 같은 기록으로 다시 제안하지 않음). 주간보고에는 넣은 줄만.
// - 기록·업데이트에서 온 줄은 글 끝 작은 [↗] = 원래 기록 열기(S50-25 ⑨, 그 조직 상세를 열고 그 기록을 밝힘 — 화면 쪽 openSource).
// - 지난주 줄: 담당조직(desk)에서는 접힌 '지난주 n줄 ▸', 주간 정리(weekly)에서는 넣은 줄 1줄 이하 조직만 펼쳐 [가져오기]·[지난주 모두 가져오기].
//   처음 쓰는 주(지난주 표가 빈 조직)는 조직 상세 [현황 표] 최근 3줄을 그 자리에 보여 준다(옮기는 migration 없음, 원래 자료 그대로).
// - 다른 화면과는 같은 탭 이벤트 kptu:weekly-org-lines-changed, 다른 탭·기기와는 화면이 다시 보일 때(visibilitychange) 그 주 줄을 다시 읽는다.
// - 브라우저 저장소에 아무것도 두지 않는다. 표가 없으면(DB 적용 전) missing.
import {missingTable} from './feed-model.mjs';
import {readStatusRows} from './org-status-table.js';
import {splitRows} from './org-status-model.mjs';
import {cellParts, sortLines, dayText, cleanBody, checkDraft, nextOrder, hasRoom, importPlan, conflictOf, mondayOf, shiftWeek, weekLabel, lineText, sourceRecord, weekSuggestions, sameBody, SUG_SHOWN, BODY_MAX, SHOWN} from './weekly-org-lines-model.mjs';
import {seoulDateKey} from './meeting-time.js';
import {fillMissing} from './weekly-org-suggest.js';
import {waitHtml, emptyHtml} from './wait-state.js';
import { chevHtml } from './fold-chevron.mjs';
import {rowMore} from './row-more.js';
import {SITE_REF_LINE} from './weekly-cell-names.mjs';

const TABLE = '/rest/v1/app_weekly_org_lines';
const COLS = 'id,organization_id,week_start,day,end_day,body,sort_order,state,origin,edited,source_update_ids,source_note_ids,source_status_ids,updated_at';
const EVENT = 'kptu:weekly-org-lines-changed';
const enc = encodeURIComponent;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export const TEXT = {
  missing: '주별 조직보고 표는 준비 중이에요.', failed: '조직보고를 불러오지 못했어요.', saveFailed: '저장하지 못했어요. 다시 눌러 주세요.',
  noBody: '내용을 적어 주세요.', badDay: '날짜를 다시 골라 주세요.', badEnd: '끝나는 날은 시작일과 같거나 뒤여야 해요.', full: '이 조직의 이번 주 줄이 가득 찼어요.',
  saved: '저장했어요.', added: '줄을 넣었어요.', placed: '주간보고에 넣었어요.', dropped: '뺐어요.', had: '이미 있는 내용으로 치웠어요.', imported: n => `지난주 ${n}줄을 가져왔어요.`, importNone: '가져올 새 줄이 없었어요.',
  conflict: '다른 화면에서 먼저 고쳤어요', gone: '다른 화면에서 이 줄이 없어졌어요.',
};
export const thisWeek = () => mondayOf(seoulDateKey(Date.now()));
export {mondayOf, shiftWeek, weekLabel, lineText};

// 여러 조직의 그 주 줄. 표가 없으면 {missing:true}, 읽지 못하면 throw. 반환 Map(조직 id → 줄들).
export async function readWeekLines({rt = window.KPTURuntime, workspaceId, week, orgIds = []} = {}) {
  const ids = [...new Set(orgIds.filter(Boolean))];
  const out = new Map(ids.map(id => [id, []]));
  if (!ids.length || !workspaceId || !week) return {rows: out};
  try {
    for (let i = 0; i < ids.length; i += 50) {
      const rows = await rt.api(`${TABLE}?workspace_id=eq.${enc(workspaceId)}&week_start=eq.${enc(week)}&organization_id=in.(${ids.slice(i, i + 50).map(enc).join(',')})&select=${COLS}&order=sort_order.asc&limit=2000`, {singleFlight: false});
      if (!Array.isArray(rows)) throw new Error('rows');
      for (const r of rows) if (out.has(r.organization_id)) out.get(r.organization_id).push(r);
    }
  } catch (e) { if (missingTable(e)) return {missing: true, rows: out}; throw e; }
  return {rows: out};
}
async function readOne(c, id) {
  const rows = await c.rt.api(`${TABLE}?id=eq.${enc(id)}&workspace_id=eq.${enc(c.workspaceId)}&select=${COLS}&limit=1`, {singleFlight: false});
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}
// 조건 쓰기: 읽은 updated_at이 그대로일 때만. 반환 {row} 또는 {conflict:{…}, row:지금 값|null}.
async function patchLine(c, line, body) {
  const rows = await c.rt.api(`${TABLE}?id=eq.${enc(line.id)}&workspace_id=eq.${enc(c.workspaceId)}&updated_at=eq.${enc(line.updated_at)}&select=${COLS}`, {method: 'PATCH', body, prefer: 'return=representation', singleFlight: false});
  if (Array.isArray(rows) && rows.length === 1) return {row: rows[0]};
  const now = await readOne(c, line.id);
  return {row: now, conflict: conflictOf({...line, ...body}, now)};
}
async function insertLines(c, orgId, week, list) {
  if (!list.length) return [];
  const rows = await c.rt.api(`${TABLE}?select=${COLS}`, {method: 'POST', prefer: 'return=representation', singleFlight: false,
    body: list.map(l => ({workspace_id: c.workspaceId, week_start: week, organization_id: orgId, day: l.day ?? null, end_day: l.end_day ?? null, body: l.body,
      sort_order: l.sort_order, state: l.state === 'dropped' ? 'dropped' : 'in', origin: l.origin || 'user', edited: false}))});
  if (!Array.isArray(rows) || rows.length !== list.length) throw new Error('insert');
  return rows;
}

let seq = 0;
// 한 화면의 조직보고 칸들. host = 칸들이 들어 있는 상자(클릭·키를 여기서 받음), repaint = 그 화면 다시 그리기, say(text, error) = 상태 한 줄.
// mode: 'desk'(담당조직 — 지난주 줄 접어 둠) | 'weekly'(주간 정리 — 넣은 줄 1줄 이하 조직만 지난주 줄 펼침).
// openSource({org, record}, trigger) = 줄 끝 [↗](원래 기록 열기, ⑨)를 누르면 부르는 화면 쪽 열기. 없으면 [↗]를 그리지 않는다.
export function createWeekLines({rt, workspaceId, week = thisWeek(), mode = 'desk', repaint = () => {}, say = () => {}, openSource = null} = {}) {
  const ctl = {
    id: `wl${++seq}`, rt, workspaceId, week, mode, openSource, status: 'idle', orgIds: [], lines: new Map(), last: new Map(), lastFromStatus: new Set(),
    open: new Set(), lastOpen: new Set(), sugOpen: new Set(), siteRefIds: new Set(), refOpen: new Set(), editing: null, draft: null, invalid: '', busy: false, conflicts: new Map(), run: 0, host: null, focus: '',
  };
  const c = () => ({rt: ctl.rt, workspaceId: ctl.workspaceId});
  const announce = orgId => window.dispatchEvent(new CustomEvent(EVENT, {detail: {week: ctl.week, organization_id: orgId, source: ctl.id}}));
  const sorted = orgId => sortLines(ctl.lines.get(orgId) || []);
  const find = id => { for (const [org, list] of ctl.lines) { const l = list.find(x => x.id === id); if (l) return {org, line: l}; } return null; };
  const replace = row => { const list = ctl.lines.get(row.organization_id); if (!list) return; const i = list.findIndex(x => x.id === row.id); if (i >= 0) list[i] = row; else list.push(row); };

  // 그 주 줄 + 지난주 넣은 줄(+ 지난주가 빈 조직은 현황 표 최근 3줄)을 읽는다.
  ctl.load = async (orgIds = ctl.orgIds, {quiet = false} = {}) => {
    ctl.orgIds = [...orgIds];
    const run = ++ctl.run;
    if (!quiet || ctl.status !== 'ready') { ctl.status = 'loading'; repaint(); }
    try {
      const [now, prev] = await Promise.all([
        readWeekLines({rt: ctl.rt, workspaceId: ctl.workspaceId, week: ctl.week, orgIds: ctl.orgIds}),
        readWeekLines({rt: ctl.rt, workspaceId: ctl.workspaceId, week: shiftWeek(ctl.week, -1), orgIds: ctl.orgIds}).catch(() => ({rows: new Map()})),
      ]);
      if (run !== ctl.run) return;
      if (now.missing) { ctl.status = 'missing'; repaint(); return; }
      const last = new Map(ctl.orgIds.map(id => [id, sortLines((prev.rows?.get(id) || []).filter(l => l.state === 'in'))]));
      const empty = ctl.orgIds.filter(id => !last.get(id).length), fromStatus = new Set();
      if (empty.length) {
        try {
          const st = await readStatusRows({rt: ctl.rt, workspaceId: ctl.workspaceId, orgIds: empty});
          if (!st.missing) for (const id of empty) { const rows = splitRows(st.rows.get(id) || [], SHOWN).shown; if (rows.length) { last.set(id, rows.map(r => ({id: `st-${r.id}`, day: r.day, end_day: r.end_day, body: r.body}))); fromStatus.add(id); } }
        } catch { /* 현황 표를 못 읽으면 지난주 자리만 비움 */ }
      }
      if (run !== ctl.run) return;
      ctl.lines = now.rows; ctl.last = last; ctl.lastFromStatus = fromStatus; ctl.status = 'ready';
      // P4 열 때 빠진 것 채우기: 다른 기기·서버 경로로 들어온 그 주 기록 중 줄 출처에 없는 것(이번 접속에 주마다 한 번, 기다리지 않음).
      void fillMissing({rt: ctl.rt, workspaceId: ctl.workspaceId, week: ctl.week, orgIds: ctl.orgIds, lines: now.rows}).catch(() => {});
    } catch { if (run !== ctl.run) return; ctl.status = 'error'; }
    repaint();
  };
  ctl.setWeek = week => { if (!week || week === ctl.week) return; ctl.week = week; ctl.editing = null; ctl.draft = null; ctl.conflicts.clear(); ctl.open.clear(); ctl.lastOpen.clear(); ctl.sugOpen.clear(); void ctl.load(ctl.orgIds); };
  ctl.reportLines = orgId => cellParts(ctl.lines.get(orgId) || []).placed;
  ctl.disabled = () => ctl.busy || !!ctl.editing;

  // ---- 그리기 ----
  // S52-25 WEEKLY-조직현황폰: 주간 정리(weekly)의 ⋯ 는 공용 rowMore(row-more.js) — 글 그리기(innerHTML) 뒤 afterPaint 에서 이 자리표를 그 부품으로 바꾼다.
  // spec = {label, data, items:[{text, data, aria, danger}]}. 누르기는 메뉴 버튼의 data-* 그대로 아래 host click 이 받는다.
  const moreSlot = spec => `<span class="wl-more-slot" data-wl-more="${esc(JSON.stringify(spec))}"></span>`;
  // 공용 '제안 줄' 메뉴 순서(주간 정리의 다른 제안 줄과 같음): [넣기][이미 있음][고쳐서 넣기][빼기].
  const sugMore = (label, d, text) => moreSlot({label: `제안: ${text}`, data: {wlSugMore: ''}, items: [
    {text: '넣기', data: d.take, aria: `넣기: ${text}`}, {text: '이미 있음', data: d.have, aria: `이미 있음(이미 쓴 내용): ${text}`},
    {text: '고쳐서 넣기', data: d.edit, aria: `고쳐서 넣기: ${text}`}, {text: '빼기', data: d.drop, danger: true, aria: `제안 빼기: ${text}`}]});
  const tagHtml = t => `<span class="weekly-flow-tag wl-tag">${esc(t)}</span>`;
  // 주간 정리 흐린 제안 줄 하나: 출처 꼬리표 · 날짜 · 글 · ⋯. kind 'line' = 표의 제안 행, 'last' = 지난주·현황 표 줄.
  const sugHtml = (orgId, x) => {
    const l = x.line, label = cleanBody(l.body), day = dayText(l.day, l.end_day);
    if (x.kind === 'line' && ctl.editing?.id === l.id) return formHtml(orgId, l);
    const tag = x.kind === 'last' ? (ctl.lastFromStatus.has(orgId) ? '현황 표' : '지난주') : l.origin === 'ai' ? 'AI 제안' : '기록';
    const d = x.kind === 'line'
      ? {take: {wlIn: l.id}, have: {wlHave: l.id}, edit: {wlEdit: l.id}, drop: {wlDrop: l.id}}
      : {take: {wlSugTake: orgId, wlKey: l.id}, have: {wlSugHave: orgId, wlKey: l.id}, edit: {wlSugEdit: orgId, wlKey: l.id}, drop: {wlSugDrop: orgId, wlKey: l.id}};
    return `<div class="wl-line is-sug" data-wl-sug="${esc(l.id)}" data-wl-sug-kind="${x.kind}"${x.kind === 'line' ? ` data-wl-line="${esc(l.id)}" data-wl-state="suggested"` : ''}>${tagHtml(tag)}${day ? `<span class="wl-day">${esc(day)}</span>` : ''}<span class="wl-text">${esc(label)}</span>${ctl.disabled() ? '' : sugMore(label, d, label)}</div>`;
  };
  const lineHtml = (orgId, l, {sug = false} = {}) => {
    if (ctl.editing && ctl.editing.id === l.id) return formHtml(orgId, l);
    const label = esc(cleanBody(l.body)), dis = ctl.disabled(), day = dayText(l.day, l.end_day);
    const text = dis ? `<span class="wl-text">${label}</span>` : `<span class="wl-text is-edit" role="button" tabindex="0" data-wl-edit="${esc(l.id)}" aria-label="${label} 고치기">${label}</span>`;
    const ai = l.origin === 'ai' ? '<span class="wl-ai" title="AI가 기록을 한 줄로 줄인 제안">AI</span>' : '';
    const src = typeof ctl.openSource === 'function' && sourceRecord(l) !== null ? `<button type="button" class="wl-src" data-wl-src="${esc(l.id)}" aria-label="${label} 원래 기록 열기" title="원래 기록 열기"${dis ? ' disabled' : ''}>↗</button>` : '';
    const btns = sug ? `<span class="wl-btns btn-row"><button type="button" class="wl-btn is-main" data-wl-in="${esc(l.id)}"${dis ? ' disabled' : ''}>✓ 넣기</button><button type="button" class="wl-btn" data-wl-edit="${esc(l.id)}"${dis ? ' disabled' : ''}>고치기</button><button type="button" class="wl-btn" data-wl-drop="${esc(l.id)}" aria-label="${label} 빼기"${dis ? ' disabled' : ''}>×</button></span>` : '';
    const conf = ctl.conflicts.get(l.id);
    const confHtml = conf ? `<div class="wl-conf" role="alert" data-wl-conflict="${esc(l.id)}">${conf.gone ? TEXT.gone : `${TEXT.conflict}: '${esc(conf.body)}'`} <span class="wl-conf-btns btn-row"><button type="button" class="wl-btn" data-wl-keep="${esc(l.id)}">그대로 두기</button>${conf.gone ? '' : `<button type="button" class="wl-btn" data-wl-mine="${esc(l.id)}">내 글로 바꾸기</button>`}</span></div>` : '';
    return `<div class="wl-line${sug ? ' is-sug' : ''}" data-wl-line="${esc(l.id)}" data-wl-state="${esc(l.state)}"><span class="wl-day">- ${esc(day)}</span>${text}${ai}${src}${btns}</div>${confHtml}`;
  };
  const formHtml = (orgId, l) => {
    const d = ctl.draft || {}, dis = ctl.busy ? ' disabled' : '', key = l?.id || 'new', inv = f => (ctl.invalid === f ? ' aria-invalid="true"' : '');
    return `<div class="wl-form" data-wl-form="${esc(key)}" data-wl-org="${esc(orgId)}">`
      + `<span class="wl-f-days"><input type="date" data-wl-field="day" aria-label="날짜(선택)" value="${esc(d.day || '')}"${inv('day')}${dis}><span aria-hidden="true">~</span><input type="date" data-wl-field="end_day" aria-label="끝나는 날(선택)" value="${esc(d.end_day || '')}"${d.day ? ` min="${esc(d.day)}"` : ''}${inv('end_day')}${dis}></span>`
      + `<input type="text" class="wl-f-body" data-wl-field="body" aria-label="조직보고 줄" maxlength="${BODY_MAX}" autocomplete="off" value="${esc(d.body || '')}"${inv('body')}${dis}>`
      + `<span class="wl-btns btn-row">${l ? `<button type="button" class="wl-btn" data-wl-drop="${esc(l.id)}"${dis}>빼기</button>` : ''}<button type="button" class="wl-btn" data-wl-cancel${dis}>취소</button><button type="button" class="wl-btn is-main" data-wl-save${dis}>저장</button></span></div>`;
  };
  const lastHtml = (orgId, parts) => {
    const last = ctl.last.get(orgId) || [];
    if (!last.length) return '';
    const fromStatus = ctl.lastFromStatus.has(orgId), name = fromStatus ? '현황 표' : '지난주';
    const open = ctl.lastOpen.has(orgId) || (ctl.mode === 'weekly' && parts.thin && !ctl.lastOpen.has(`-${orgId}`));
    const dis = ctl.disabled() || !hasRoom(ctl.lines.get(orgId));
    const toggle = `<button type="button" class="wl-more is-last" data-wl-last="${esc(orgId)}" aria-expanded="${open}">${name} ${last.length}줄 ${chevHtml(open)}</button>`;
    if (!open) return toggle;
    return `${toggle}<div class="wl-last" data-wl-last-box="${esc(orgId)}">${last.map((l, i) => `<div class="wl-line is-last"><span class="wl-day">- ${esc(dayText(l.day, l.end_day))}</span><span class="wl-text">${esc(cleanBody(l.body))}</span><span class="wl-btns btn-row"><button type="button" class="wl-btn" data-wl-take="${esc(orgId)}" data-wl-i="${i}"${dis ? ' disabled' : ''}>가져오기</button></span></div>`).join('')}</div>`;
  };
  // 조직 이름 옆: '주간보고 3줄 넘음', 주간 정리에서 부실 조직은 [지난주 모두 가져오기].
  // 주간 정리(weekly): 조직 이름 뒤 ' · n줄'(넣은 줄 없으면 ' · 빈 칸') + 줄 끝 ⋯ 하나 — [현황 표(지난주) 모두 가져오기]·[줄 추가]·[현황 표 보기].
  const weeklyName = orgId => {
    // S52-25 WEEKLY-투쟁사업장참고: 3장에 들어간 조직은 이름 줄에 '참고'만, ⋯ 는 [현황 표 보기]만(줄 추가·가져오기 없음 — 보고서에는 참고 한 줄).
    if (ctl.siteRefIds.has(orgId)) return typeof ctl.openSource === 'function' && !ctl.disabled() ? moreSlot({label: '조직 칸 메뉴', data: {wlOrgMore: orgId}, items: [{text: '현황 표 보기', data: {wlOpenOrg: orgId}}]}) : '';
    const list = ctl.lines.get(orgId) || [], parts = cellParts(list), room = hasRoom(list), dis = ctl.disabled();
    const lastLeft = weekSuggestions(list, ctl.last.get(orgId) || []).filter(x => x.kind === 'last').length;
    const name = ctl.lastFromStatus.has(orgId) ? '현황 표' : '지난주', items = [];
    if (lastLeft && room) items.push({text: `${name} 모두 가져오기`, data: {wlTakeAll: orgId}});
    if (room && !(ctl.editing?.orgId === orgId && ctl.editing.id === 'new')) items.push({text: '줄 추가', data: {wlAdd: orgId}});
    if (typeof ctl.openSource === 'function') items.push({text: '현황 표 보기', data: {wlOpenOrg: orgId}});
    const more = !dis && items.length ? moreSlot({label: '조직 칸 메뉴', data: {wlOrgMore: orgId}, items}) : '';
    return `<span class="wl-count" data-wl-count>· ${parts.placed.length ? `${parts.placed.length}줄` : '빈 칸'}</span>${parts.over ? '<span class="wl-warn">주간보고 3줄 넘음</span>' : ''}${more}`;
  };
  ctl.nameHtml = orgId => {
    if (ctl.status !== 'ready') return '';
    if (ctl.mode === 'weekly') return weeklyName(orgId);
    const parts = cellParts(ctl.lines.get(orgId) || []), last = ctl.last.get(orgId) || [];
    let html = parts.over ? '<span class="wl-warn">주간보고 3줄 넘음</span>' : '';
    if (ctl.mode === 'weekly' && parts.thin && last.length) html += `<button type="button" class="wl-btn" data-wl-take-all="${esc(orgId)}"${ctl.disabled() ? ' disabled' : ''}>${ctl.lastFromStatus.has(orgId) ? '현황 표' : '지난주'} 모두 가져오기</button>`;
    return html;
  };
  // 넣은 줄(앞 줄은 '외 n줄 ▾' 뒤) — 담당조직·주간 정리 같은 그리기.
  const placedHtml = (orgId, parts, open) => (parts.older.length ? `<button type="button" class="wl-more" data-wl-toggle="${esc(orgId)}" aria-expanded="${open}">외 ${parts.older.length}줄 ${chevHtml(open)}</button>` : '')
    + (open ? parts.older.map(l => lineHtml(orgId, l)).join('') : '') + parts.shown.map(l => lineHtml(orgId, l)).join('');
  // 주간 정리(weekly) 한 조직 칸: 넣은 줄(보통 글자) → 흐린 제안 줄(공용 '제안 줄', 3개 넘으면 '제안 n개 더 ▾'). 표·지난주 덩어리·[+ 줄]은 없다(⋯ 안).
  // 3장(투쟁 사업장 현황)에 들어간 조직 칸: '- 투쟁 사업장 보고 참고' 한 줄 + 이 주에 넣은 줄은 지우지 않고 흐린 접힌 줄 '쓴 줄 n개 ▾'(공용 접기). 제안 없음.
  const refCell = orgId => {
    const placed = cellParts(ctl.lines.get(orgId) || []).placed, open = ctl.refOpen.has(orgId);
    const fold = placed.length ? `<details class="journal-org-raw weekly-flow-records wl-ref-fold" data-wl-ref-fold="${esc(orgId)}"${open ? ' open' : ''}><summary>쓴 줄 ${placed.length}개</summary>${placed.map(l => `<div class="wl-line is-last"><span class="wl-day">${esc(dayText(l.day, l.end_day))}</span><span class="wl-text">${esc(cleanBody(l.body))}</span></div>`).join('')}</details>` : '';
    return `<div class="wl-cell" data-wl-cell="${esc(orgId)}" data-wl-site-ref><div class="wl-line" data-wl-site-ref-line><span class="wl-text">${esc(SITE_REF_LINE)}</span></div>${fold}</div>`;
  };
  const weeklyCell = orgId => {
    if (ctl.siteRefIds.has(orgId)) return refCell(orgId);
    const list = ctl.lines.get(orgId) || [], parts = cellParts(list), sugs = weekSuggestions(list, ctl.last.get(orgId) || []);
    const open = parts.older.length > 0 && (ctl.open.has(orgId) || parts.older.some(l => l.id === ctl.editing?.id));
    const adding = ctl.editing?.orgId === orgId && ctl.editing.id === 'new';
    let html = '';
    html += placedHtml(orgId, parts, open);
    if (!parts.placed.length && !sugs.length && !adding) html += '<span class="wl-empty">—</span>';
    const all = ctl.sugOpen.has(orgId) || sugs.slice(SUG_SHOWN).some(x => x.line.id === ctl.editing?.id);
    html += (all ? sugs : sugs.slice(0, SUG_SHOWN)).map(x => sugHtml(orgId, x)).join('');
    if (sugs.length > SUG_SHOWN) html += `<button type="button" class="row-act wl-sug-more" data-wl-sug-toggle="${esc(orgId)}" aria-expanded="${all}">${all ? '제안 접기' : `제안 ${sugs.length - SUG_SHOWN}개 더`} ${chevHtml(all)}</button>`;
    if (adding) html += formHtml(orgId, null);
    return `<div class="wl-cell" data-wl-cell="${esc(orgId)}">${html}</div>`;
  };
  ctl.cellHtml = orgId => {
    if (ctl.mode === 'weekly') return weeklyCell(orgId);
    const parts = cellParts(ctl.lines.get(orgId) || []), dis = ctl.disabled();
    const open = parts.older.length > 0 && (ctl.open.has(orgId) || parts.older.some(l => l.id === ctl.editing?.id));
    let html = '';
    html += placedHtml(orgId, parts, open);
    if (!parts.placed.length && !parts.suggested.length && !(ctl.editing?.orgId === orgId)) html += '<span class="wl-empty">—</span>';
    html += parts.suggested.map(l => lineHtml(orgId, l, {sug: true})).join('');
    if (ctl.editing && ctl.editing.orgId === orgId && ctl.editing.id === 'new') html += formHtml(orgId, null);
    html += lastHtml(orgId, parts);
    if (!(ctl.editing && ctl.editing.orgId === orgId && ctl.editing.id === 'new')) html += `<button type="button" class="wl-add" data-wl-add="${esc(orgId)}"${dis || !hasRoom(ctl.lines.get(orgId)) ? ' disabled' : ''}>+ 줄</button>`;
    return `<div class="wl-cell" data-wl-cell="${esc(orgId)}">${html}</div>`;
  };
  ctl.afterPaint = () => {
    for (const slot of ctl.host?.querySelectorAll('[data-wl-more]') ?? []) {
      let spec = null; try { spec = JSON.parse(slot.dataset.wlMore); } catch { /* 자리표가 깨졌으면 ⋯ 를 그리지 않는다 */ }
      if (spec) slot.replaceWith(rowMore(document, spec)); else slot.remove();
    }
    if (!ctl.host || !ctl.focus) return;
    const el = ctl.host.querySelector(ctl.focus);
    el?.focus({preventScroll: true});
    if (el?.matches('input')) el.scrollIntoView({block: 'nearest'});
    ctl.focus = '';
  };

  // ---- 쓰기 ----
  const work = async (fn, done, orgId) => {
    if (ctl.busy) return false;
    ctl.busy = true; say('저장하는 중…'); repaint();
    let ok = true, msg = done;
    try { const r = await fn(); if (typeof r === 'string') msg = r; } catch (e) { ok = false; console.warn('weekly org lines write failed', e?.message || e); }
    ctl.busy = false;
    if (ok && !ctl.conflicts.size) { ctl.editing = null; ctl.draft = null; ctl.invalid = ''; }
    say(ok ? msg : TEXT.saveFailed, !ok);
    repaint(); ctl.afterPaint();
    if (ok && orgId) announce(orgId);
    return ok;
  };
  const patch = (line, body, done) => work(async () => {
    const r = await patchLine(c(), line, body);
    if (r.row) replace(r.row);
    if (r.conflict) { ctl.conflicts.set(line.id, {...r.conflict, mine: body}); ctl.editing = null; ctl.draft = null; return TEXT.conflict + '.'; }
    ctl.conflicts.delete(line.id);
    return done;
  }, done, line.organization_id);
  ctl.save = async () => {
    if (!ctl.editing || ctl.busy) return;
    const {orgId, id} = ctl.editing, v = checkDraft(ctl.draft);
    if (!v.ok) { ctl.invalid = v.field; say(v.field === 'body' ? TEXT.noBody : v.field === 'end_day' ? TEXT.badEnd : TEXT.badDay, true); ctl.focus = `[data-wl-field="${v.field}"]`; repaint(); ctl.afterPaint(); return; }
    if (id === 'new') {
      const list = ctl.lines.get(orgId) || [];
      if (!hasRoom(list)) { say(TEXT.full, true); return; }
      // 지난주·현황 표 제안을 [고쳐서 넣기]로 고쳐 넣으면 원래 글은 뺀 줄로 함께 남긴다(같은 제안이 다시 나오지 않게, 지우지 않음).
      const from = ctl.editing.from, rows = [{...v.value, sort_order: nextOrder(list)}];
      if (from && !sameBody(from.body, v.value.body)) rows.push({day: from.day || null, end_day: from.end_day || null, body: cleanBody(from.body), sort_order: Math.min(1000, nextOrder(list) + 1), state: 'dropped', origin: 'last_week'});
      if (!hasRoom(list, rows.length)) { say(TEXT.full, true); return; }
      await work(async () => { (await insertLines(c(), orgId, ctl.week, rows)).forEach(replace); }, TEXT.added, orgId);
      return;
    }
    const hit = find(id); if (!hit) return;
    await patch(hit.line, {...v.value, state: 'in', edited: true}, TEXT.saved);
  };
  // 다른 칸(주간 정리 캘린더 추천 [+] 등)에서 줄 하나를 바로 넣는다(넣은 줄, 내 줄). 같은 글이 이미 있으면 넣지 않는다.
  ctl.addLine = async (orgId, text, {day = null} = {}) => {
    const list = ctl.lines.get(orgId) || [], v = checkDraft({day: day || '', body: text});
    if (!v.ok || ctl.busy) return false;
    if (list.some(l => l.state !== 'dropped' && cleanBody(l.body) === v.value.body)) { say('이미 넣은 줄이에요.'); return false; }
    if (!hasRoom(list)) { say(TEXT.full, true); return false; }
    return work(async () => { (await insertLines(c(), orgId, ctl.week, [{...v.value, sort_order: nextOrder(list)}])).forEach(replace); }, TEXT.added, orgId);
  };
  ctl.cancel = () => { const e = ctl.editing; ctl.editing = null; ctl.draft = null; ctl.invalid = ''; ctl.focus = e ? (e.id === 'new' ? `[data-wl-add="${e.orgId}"]` : `[data-wl-edit="${e.id}"]`) : ''; say(''); repaint(); ctl.afterPaint(); };
  const take = async (orgId, list) => {
    const plan = importPlan(list, ctl.lines.get(orgId) || []);
    if (!plan.length) { say(TEXT.importNone); return; }
    await work(async () => { (await insertLines(c(), orgId, ctl.week, plan.map(p => ({...p, origin: 'last_week'})))).forEach(replace); return TEXT.imported(plan.length); }, '', orgId);
  };

  // ---- 입력 받기(화면 상자 하나에 한 번) ----
  ctl.bind = host => {
    if (ctl.host === host) return;
    ctl.host = host;
    host.addEventListener('toggle', e => { const d = e.target; if (!d?.matches?.('details[data-wl-ref-fold]')) return; if (d.open) ctl.refOpen.add(d.dataset.wlRefFold); else ctl.refOpen.delete(d.dataset.wlRefFold); }, true);
    host.addEventListener('input', e => { const t = e.target; if (!t.matches?.('[data-wl-field]')) return; ctl.draft = {...(ctl.draft || {}), [t.dataset.wlField]: t.value}; if (ctl.invalid === t.dataset.wlField) { ctl.invalid = ''; t.removeAttribute('aria-invalid'); } });
    host.addEventListener('change', e => { const t = e.target; if (!t.matches?.('[data-wl-field]')) return; ctl.draft = {...(ctl.draft || {}), [t.dataset.wlField]: t.value}; if (t.dataset.wlField === 'day') t.closest('.wl-form')?.querySelector('[data-wl-field="end_day"]')?.setAttribute('min', t.value); });
    host.addEventListener('keydown', e => {
      const sp = e.target.closest?.('.wl-text[data-wl-edit]');
      if (sp && e.target === sp && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); sp.click(); return; }
      if (!e.target.matches?.('[data-wl-field]')) return;
      if (e.key === 'Enter' && !e.isComposing && (e.ctrlKey || e.metaKey || e.target.dataset.wlField === 'body')) { e.preventDefault(); void ctl.save(); }
      else if (e.key === 'Escape' && ctl.editing) { e.preventDefault(); ctl.cancel(); }
    });
    host.addEventListener('click', e => {
      const b = e.target.closest?.('button,[data-wl-edit]'); if (!b || b.disabled || !host.contains(b)) return;
      const d = b.dataset;
      if (d.wlEdit) { const hit = find(d.wlEdit); if (!hit || ctl.disabled()) return; ctl.editing = {orgId: hit.org, id: hit.line.id}; ctl.draft = {day: hit.line.day || '', end_day: hit.line.end_day || '', body: hit.line.body}; ctl.invalid = ''; ctl.focus = '[data-wl-field="body"]'; say(''); repaint(); ctl.afterPaint(); }
      else if (d.wlAdd) { ctl.editing = {orgId: d.wlAdd, id: 'new'}; const today = seoulDateKey(Date.now()); ctl.draft = {day: today >= ctl.week && today <= shiftWeek(ctl.week, 1) ? today : ctl.week, end_day: '', body: ''}; ctl.invalid = ''; ctl.focus = '[data-wl-field="body"]'; say(''); repaint(); ctl.afterPaint(); }
      else if (d.wlSrc) { const hit = find(d.wlSrc), record = hit ? sourceRecord(hit.line) : null; if (hit && record !== null && typeof ctl.openSource === 'function') ctl.openSource({org: hit.org, record}, b); }
      else if ('wlCancel' in d) ctl.cancel();
      else if ('wlSave' in d) void ctl.save();
      else if (d.wlHave) { const hit = find(d.wlHave); if (hit) void patch(hit.line, {state: 'dropped'}, TEXT.had); }
      else if (d.wlSugToggle) { if (ctl.sugOpen.has(d.wlSugToggle)) ctl.sugOpen.delete(d.wlSugToggle); else ctl.sugOpen.add(d.wlSugToggle); ctl.focus = `[data-wl-sug-toggle="${d.wlSugToggle}"]`; repaint(); ctl.afterPaint(); }
      else if (d.wlOpenOrg) { if (typeof ctl.openSource === 'function') ctl.openSource({org: d.wlOpenOrg, record: ''}, b); }
      else if (d.wlSugTake || d.wlSugHave || d.wlSugDrop || d.wlSugEdit) {
        const org = d.wlSugTake || d.wlSugHave || d.wlSugDrop || d.wlSugEdit, l = (ctl.last.get(org) || []).find(x => x.id === d.wlKey);
        if (!l || ctl.disabled()) return;
        if (d.wlSugTake) void take(org, [l]);
        else if (d.wlSugEdit) { ctl.editing = {orgId: org, id: 'new', from: l}; ctl.draft = {day: l.day || '', end_day: l.end_day || '', body: cleanBody(l.body)}; ctl.invalid = ''; ctl.focus = '[data-wl-field="body"]'; say(''); repaint(); ctl.afterPaint(); }
        else {
          // [이미 있음]·[빼기]: 그 주 표에 뺀 줄(state dropped, origin last_week)로 남긴다 — 지우지 않고, 같은 글은 다시 제안하지 않는다(importPlan 과 같은 규칙).
          const list = ctl.lines.get(org) || [];
          if (!hasRoom(list)) { say(TEXT.full, true); return; }
          void work(async () => { (await insertLines(c(), org, ctl.week, [{day: l.day || null, end_day: l.end_day || null, body: cleanBody(l.body), sort_order: nextOrder(list), state: 'dropped', origin: 'last_week'}])).forEach(replace); }, d.wlSugHave ? TEXT.had : TEXT.dropped, org);
        }
      }
      else if (d.wlIn) { const hit = find(d.wlIn); if (hit) void patch(hit.line, {state: 'in'}, TEXT.placed); }
      else if (d.wlDrop) { const hit = find(d.wlDrop); if (hit) void patch(hit.line, {state: 'dropped'}, TEXT.dropped); }
      else if (d.wlKeep) { ctl.conflicts.delete(d.wlKeep); say(''); repaint(); }
      else if (d.wlMine) { const hit = find(d.wlMine), conf = ctl.conflicts.get(d.wlMine); if (hit && conf) { ctl.conflicts.delete(d.wlMine); void patch(hit.line, conf.mine, TEXT.saved); } }
      else if (d.wlToggle) { if (ctl.open.has(d.wlToggle)) ctl.open.delete(d.wlToggle); else ctl.open.add(d.wlToggle); ctl.focus = `[data-wl-toggle="${d.wlToggle}"]`; repaint(); ctl.afterPaint(); }
      else if (d.wlLast) {
        const org = d.wlLast, parts = cellParts(ctl.lines.get(org) || []), auto = ctl.mode === 'weekly' && parts.thin;
        const open = ctl.lastOpen.has(org) || (auto && !ctl.lastOpen.has(`-${org}`));
        ctl.lastOpen.delete(org); ctl.lastOpen.delete(`-${org}`);
        if (!open) ctl.lastOpen.add(org); else if (auto) ctl.lastOpen.add(`-${org}`);
        ctl.focus = `[data-wl-last="${org}"]`; repaint(); ctl.afterPaint();
      }
      else if (d.wlTake) { const l = (ctl.last.get(d.wlTake) || [])[Number(d.wlI)]; if (l) void take(d.wlTake, [l]); }
      else if (d.wlTakeAll) void take(d.wlTakeAll, ctl.last.get(d.wlTakeAll) || []);
    });
  };
  // 다른 화면(같은 탭)이 바꾸면 그 주면 다시 읽기, 화면이 다시 보이면 다시 읽기(캐시 지우기가 아니라 다시 읽기).
  const quiet = () => { if (ctl.status === 'ready' && !ctl.busy && !ctl.editing && ctl.host?.isConnected) void ctl.load(ctl.orgIds, {quiet: true}); };
  window.addEventListener(EVENT, e => { if (e.detail?.source !== ctl.id && (!e.detail?.week || e.detail.week === ctl.week || e.detail.week === shiftWeek(ctl.week, -1))) quiet(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') quiet(); });
  return ctl;
}
export const WEEK_LINES_EVENT = EVENT;
// 주간보고 4. 조직보고 표(조직 | 조직현황) — 담당조직 [전체 표]와 홈 [주간 정리] 4.가 이 함수 하나로 그린다(S50-7: 따로 만들지 않음).
// orgs = [{id, name}] 주간보고(개인본) 순서대로, 내용 없어도 자리 유지.
// 옵션: orgHtml(o) 조직 칸 안쪽 글(기본: 이름), stageOf(o) 조직 이름 밑 작은 글(쟁의 단계), headOrg 조직 머리칸 안쪽(칸 폭 끌기 손잡이), tableClass 표 구분 이름.
export function weekTableHtml(ctl, orgs, {msg = '', error = false, orgHtml = null, stageOf = null, headOrg = '조직', headRows = '조직현황', tableClass = ''} = {}) {
  if (ctl.status === 'missing') return `<p class="wl-note" data-wl-missing>${TEXT.missing}</p>`;
  if (ctl.status === 'error') return `<p class="wl-note" role="alert">${TEXT.failed}</p>`;
  if (ctl.status !== 'ready') return waitHtml({rows: 2});
  if (!orgs.length) return emptyHtml('담당조직 없음');
  const rows = orgs.map(o => { const stage = stageOf ? stageOf(o) : ''; return `<tr data-wl-org-row="${esc(o.id)}"><th scope="row" class="wl-c-org">${orgHtml ? orgHtml(o) : `<span class="wl-org">${esc(o.name)}</span>`}${ctl.nameHtml(o.id)}${stage ? `<span class="wl-stage">${esc(stage)}</span>` : ''}</th><td class="wl-c-rows">${ctl.cellHtml(o.id)}</td></tr>`; }).join('');
  return `<table class="wl-table${tableClass ? ` ${tableClass}` : ''}" data-wl-table><thead><tr><th scope="col" class="wl-c-org">${headOrg}</th><th scope="col">${esc(headRows)}</th></tr></thead><tbody>${rows}</tbody></table>`
    + `<p class="wl-status${error ? ' is-error' : ''}" role="status" aria-live="polite" data-wl-status>${esc(msg)}</p>`;
}
