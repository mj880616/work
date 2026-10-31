// FEAT-1029묶음 ② 교섭·회의 전 한 장(설계 docs/design/pre-meeting-sheet.md, 시안 docs/design/mockups/pre-meeting-sheet.html).
// 한 장을 그리는 곳은 이 모듈 하나(창 #pmsModal). 일정 수정 창·담당조직 상세는 여는 줄만 그리고 누르면 openPreMeetingSheet를 부른다.
// - 읽기: 서버 표 app_pre_meeting_sheets(owner RLS, 읽기만). 표가 없으면(DB 적용 전) "준비 중" 한 줄.
// - 만들기: ai-assist kind=pre_meeting_sheet(일정 값 + 담당조직 id만 보냄, 재료는 서버가 읽음). 이 모듈에는 원본 쓰기 호출이 없다.
// - 자동: 전날 18시(서울) 뒤 업무일지·홈을 열면 내일 대상마다 한 번(autoMakeTomorrow, 같은 일정은 이 화면 세션에서 한 번만 묻는다).
// - 모양: 다음 주 준비 한 장과 같은 공용 그리기(prep-sheet-view.js). 기다림은 wait-state.js. 기기 저장 없음.
import {renderPrepSheet, jumpToPrepRef} from './prep-sheet-view.js';
import {waitHtml} from './wait-state.js';
import {callAiAssist, AI_SUMMARY_TEXT} from './basket-ai-summary.js';
import {requestLibraryDocument} from './basket-library-send.js';
import {sheetView, whenText, openTarget, eventBody, eventKey, autoTargets, showLine, orgLines, lineText, slashDay, seoulDay, AUTO_HOUR} from './pre-meeting-sheet-model.mjs';

const encode = encodeURIComponent;
const TABLE = 'app_pre_meeting_sheets';
const COLS = 'event_key,organization_id,event_title,event_start,event_end,event_location,top_lines,groups,ai_status,made_by,created_at,updated_at';
const MODAL = 'pmsModal';
const runtime = () => window.KPTURuntime;
const workspace = rt => { const id = rt?.context?.read?.()?.workspace?.id; if (!id) throw new Error('workspace'); return id; };
const owner = rt => rt?.session?.read?.()?.user?.id || '';
export const SKIN = Object.freeze({cls:'pms', data:'pms', heading:{tag:'h3', cls:'pms-title'}, open:'pms-open', list:'pms-list', day:'pms-day', muted:'pms-muted', button:'pms-btn',
  footer:'AI가 기록을 정리한 것임. 원본을 눌러 확인할 것.'});

function ensureStyles() {
  const have = [...document.querySelectorAll('link[rel="stylesheet"]')].some(l => (l.getAttribute('href') || '').split('?')[0].endsWith('pre-meeting-sheet.css'));
  if (have) return;
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = './pre-meeting-sheet.css'; link.dataset.kptuViewStyle = '1'; document.head.append(link);
}

// ---- 읽기 ----
export async function readSheet(key, rt = runtime()) {
  try {
    const rows = await rt.api(`/rest/v1/${TABLE}?workspace_id=eq.${encode(workspace(rt))}&event_key=eq.${encode(key)}&select=${COLS}&limit=1`, {singleFlight:false});
    const row = Array.isArray(rows) ? rows[0] : null;
    return {missing:false, sheet:row && row.event_key === key ? row : null};
  } catch (error) {
    if (Number(error?.status) === 404) return {missing:true, sheet:null};
    throw error;
  }
}
async function readSheetsByKeys(keys, rt) {
  if (!keys.length) return [];
  const list = keys.map(k => `"${String(k).replace(/"/g, '')}"`).join(',');
  try { const rows = await rt.api(`/rest/v1/${TABLE}?workspace_id=eq.${encode(workspace(rt))}&event_key=in.(${encode(list)})&select=event_key&limit=50`, {singleFlight:false}); return Array.isArray(rows) ? rows : []; }
  catch (error) { if (Number(error?.status) === 404) return null; throw error; }
}
export async function readOrgSheets(orgId, rt = runtime()) {
  try {
    const rows = await rt.api(`/rest/v1/${TABLE}?workspace_id=eq.${encode(workspace(rt))}&organization_id=eq.${encode(orgId)}&select=${COLS}&order=event_start.desc&limit=50`, {singleFlight:false});
    return {missing:false, rows:Array.isArray(rows) ? rows : []};
  } catch (error) {
    if (Number(error?.status) === 404) return {missing:true, rows:[]};
    throw error;
  }
}
// 담당조직 목록(대상 고르기용, 이 화면 세션 동안 메모리에만).
let orgCache = null;
async function readOrgs(rt) {
  const key = `${owner(rt)}:${workspace(rt)}`;
  if (orgCache?.key === key) return orgCache.flight;
  const flight = rt.api(`/rest/v1/app_suborganizations?workspace_id=eq.${encode(workspace(rt))}&deleted_at=is.null&select=id,name,aliases&order=name.asc&limit=500`, {singleFlight:false})
    .then(rows => Array.isArray(rows) ? rows : []);
  orgCache = {key, flight};
  flight.catch(() => { if (orgCache?.flight === flight) orgCache = null; });
  return flight;
}
// Google 일정(지금 ~ 8일 뒤, 읽기만). 이 화면 세션에서 5분 동안 다시 쓴다.
let eventCache = null;
async function readSoonEvents(rt) {
  const now = Date.now(), key = owner(rt);
  if (eventCache?.key === key && now - eventCache.at < 5 * 60 * 1000) return eventCache.flight;
  const from = `${seoulDay(now)}T00:00:00+09:00`, to = new Date(now + 9 * 86400000).toISOString();
  const flight = rt.api(`/functions/v1/google-calendar?action=events&timeMin=${encode(from)}&timeMax=${encode(to)}`).then(data => {
    if (!Array.isArray(data?.events) || data?.connected === false || data?.needs_reconnect) throw new Error('calendar');
    return data.events.filter(e => e?.status !== 'cancelled');
  });
  eventCache = {key, at:now, flight};
  flight.catch(() => { if (eventCache?.flight === flight) eventCache = null; });
  return flight;
}

// ---- 만들기 ----
export async function makeSheet({event, orgId, mode}, rt = runtime()) {
  const body = eventBody(event);
  if (!body.event_key || !body.start) return {ok:false, code:'invalid_request', message:'이 일정은 한 장을 만들 수 없어요.'};
  const result = await callAiAssist({kind:'pre_meeting_sheet', mode, event:body, organization_id:String(orgId).toLowerCase()}, {rt});
  if (result?.ok && result.data?.event_key === body.event_key) return {ok:true, sheet:result.data.sheet ?? null, skipped:result.data.skipped ?? null};
  const code = result?.code || 'internal_error';
  const message = code === 'not_ready' || code === 'pre_meeting_sheet_not_ready' ? '교섭 전 한 장은 아직 준비 중이에요.' : AI_SUMMARY_TEXT[code] || '만들지 못했어요. 잠시 뒤 다시 시도해 주세요.';
  return {ok:false, code, message};
}

// 전날 18시 뒤 업무일지·홈을 열 때: 내일 대상마다 장이 없으면 한 번(mode=auto). 서버가 같은 규칙을 다시 보고, 이미 있으면 덮지 않는다.
const asked = new Set();
let autoFlight = null;
export function autoMakeTomorrow(rt = runtime()) {
  if (new Date(Date.now() + 9 * 3600 * 1000).getUTCHours() < AUTO_HOUR || autoFlight) return autoFlight;
  autoFlight = (async () => {
    const scope = owner(rt);
    if (!scope) return 0;
    const [events, orgs] = await Promise.all([readSoonEvents(rt), readOrgs(rt)]);
    const mineAsked = new Set([...asked].filter(k => k.startsWith(scope + '|')).map(k => k.slice(scope.length + 1)));
    let targets = autoTargets({events, orgs, asked:mineAsked});
    if (!targets.length) return 0;
    const have = await readSheetsByKeys(targets.map(t => t.key), rt);
    if (have === null) return 0; // 표 없음(DB 적용 전).
    const done = new Set(have.map(r => r.event_key));
    targets = targets.filter(t => !done.has(t.key));
    let made = 0;
    for (const t of targets) {
      if (owner(rt) !== scope) break;
      asked.add(`${scope}|${t.key}`);
      const r = await makeSheet({event:t.event, orgId:t.org.id, mode:'auto'}, rt).catch(() => ({ok:false}));
      if (r.ok && r.sheet && !r.skipped) made += 1;
      if (!r.ok && /not_ready/.test(r.code || '')) break;
    }
    if (made) window.dispatchEvent(new CustomEvent('kptu:pre-meeting-sheets-changed'));
    return made;
  })().catch(() => 0).finally(() => { setTimeout(() => { autoFlight = null; }, 0); });
  return autoFlight;
}

// ---- 한 장 창 ----
let ui = null; // {key, event, orgId, orgName, state, sheet, busy, message, error, open:Set, trigger}
function installModal() {
  if (document.querySelector('#' + MODAL)) return;
  document.body.insertAdjacentHTML('beforeend', `<div id="${MODAL}" class="modal hidden pms-modal" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="pmsHeading"><div class="modal-card small-card pms-card"><div class="modal-head"><div><div class="eyebrow">교섭 전 한 장</div><h2 id="pmsHeading">교섭 전 한 장</h2></div><button class="icon-btn" data-pms-close type="button" aria-label="닫기">×</button></div><div id="pmsBody" class="pms" tabindex="-1"></div><div id="pmsStatus" class="status" role="status"></div></div></div>`);
  const m = document.querySelector('#' + MODAL);
  m.addEventListener('click', onClick);
  m.addEventListener('toggle', e => { if (ui && e.target.matches?.('[data-pms-group]')) { if (e.target.open) ui.open.add(e.target.dataset.pmsGroup); else ui.open.delete(e.target.dataset.pmsGroup); } }, true);
}
function paint() {
  const body = document.querySelector('#pmsBody');
  if (!body || !ui) return;
  const row = ui.sheet, title = row?.event_title || ui.event?.title || '교섭·회의';
  document.querySelector('#pmsHeading').textContent = title;
  if (ui.state === 'loading' && !ui.busy) { body.innerHTML = waitHtml({rows:4, h:20}); return; }
  const view = row ? sheetView(row, ui.event) : null;
  const when = row ? whenText(row) : ui.event ? whenText({event_start:eventBody(ui.event).start, event_location:ui.event.location}) : '';
  const sub = [when, view?.stage ? `쟁의 단계: ${view.stage}` : ''].filter(Boolean).join(' · ');
  const after = new Date(Date.now() + 9 * 3600 * 1000).getUTCHours() >= AUTO_HOUR;
  renderPrepSheet(body, {state:ui.state, title:ui.orgName || '담당조직', sub, view, canMake:!!ui.event && !!ui.orgId, busy:ui.busy, message:ui.message, error:ui.error, open:ui.open,
    notes:{missing:'교섭 전 한 장은 아직 준비 중이에요.', failed:'불러오지 못했습니다.', none:after ? '아직 만들지 않음.' : '전날 18시 뒤 만듦.', empty:'없음'}}, SKIN);
}
export async function openPreMeetingSheet({key = '', event = null, orgId = '', orgName = '', row = null, trigger = document.activeElement} = {}) {
  const rt = runtime();
  ensureStyles(); installModal();
  key = key || eventKey(event);
  ui = {key, event, orgId:orgId || row?.organization_id || '', orgName, state:row ? 'ok' : 'loading', sheet:row, busy:false, message:'', error:false, open:new Set(), scope:owner(rt)};
  const m = document.querySelector('#' + MODAL);
  m.classList.remove('hidden'); m.setAttribute('aria-hidden', 'false');
  window.KPTUA11y?.dialog?.activate?.(m, {trigger, initialFocus:'#pmsBody', onRequestClose:closePreMeetingSheet});
  paint();
  const mine = ui;
  if (!ui.orgName && ui.orgId) void readOrgs(rt).then(list => { const o = list.find(x => String(x.id).toLowerCase() === String(mine.orgId).toLowerCase()); if (ui === mine && o) { mine.orgName = o.name; paint(); } }).catch(() => {});
  if (row || !key) { if (!key) { mine.state = 'failed'; paint(); } return; }
  try {
    const r = await readSheet(key, rt);
    if (ui !== mine) return;
    mine.state = r.missing ? 'missing' : 'ok'; mine.sheet = r.sheet;
  } catch { if (ui !== mine) return; mine.state = 'failed'; }
  paint();
}
export function closePreMeetingSheet() {
  const m = document.querySelector('#' + MODAL); if (!m || m.classList.contains('hidden')) return;
  m.classList.add('hidden'); m.setAttribute('aria-hidden', 'true');
  window.KPTUA11y?.dialog?.deactivate?.(m, {restoreFocus:true});
  ui = null;
}
async function make() {
  const mine = ui, rt = runtime();
  if (!mine || mine.busy || !mine.event || !mine.orgId) return;
  mine.busy = true; mine.message = ''; mine.error = false; paint();
  let r;
  try { r = await makeSheet({event:mine.event, orgId:mine.orgId, mode:'user'}, rt); } catch { r = {ok:false, message:'만들지 못했어요. 잠시 뒤 다시 시도해 주세요.'}; }
  if (ui !== mine || owner(rt) !== mine.scope) return;
  mine.busy = false;
  if (r.ok && r.sheet) { mine.sheet = r.sheet; mine.state = 'ok'; mine.message = '한 장을 만들었어요.'; window.dispatchEvent(new CustomEvent('kptu:pre-meeting-sheets-changed')); }
  else if (!r.ok && /not_ready/.test(r.code || '')) { mine.state = 'missing'; }
  else { mine.message = r.message || '만들지 못했어요.'; mine.error = true; }
  paint();
}
async function openLine(index, trigger) {
  const item = Array.isArray(ui?.sheet?.groups) ? ui.sheet.groups[index] : null, target = openTarget(item);
  if (!target) return;
  const go = view => window.KPTURouter?.go?.(view, {source:'delegated'}), loader = window.KPTUViewLoader, orgId = ui.orgId;
  const status = document.querySelector('#pmsStatus');
  try {
    if (target.type === 'meeting') {
      await loader?.prepare?.('meetings'); await import('./meeting-round-detail.js');
      if (!(await window.__KPTU_MEETING_ROUND_DETAIL_READY__)) throw new Error('meeting');
      closePreMeetingSheet(); await window.KPTUMeetingRoundDetail.open(target.id); return;
    }
    if (target.type === 'ledger') { await loader?.load?.('ledger'); closePreMeetingSheet(); window.KPTULedgerBrowse?.show?.({openId:target.id}); go('ledger'); return; }
    if (target.type === 'document') { closePreMeetingSheet(); requestLibraryDocument(target.id, runtime()); go('library'); return; }
    if (target.type === 'feed') { closePreMeetingSheet(); go(target.kind === 'call' ? 'calls' : 'telegram'); return; }
    if (target.type === 'people') {
      closePreMeetingSheet();
      if (!document.querySelector('#wdModal:not(.hidden)')) await window.KPTUWorkplace?.open?.(orgId);
      document.querySelector('#wdTab_people')?.click(); return;
    }
  } catch { if (status) status.textContent = '원본을 열지 못했어요. 다시 시도해 주세요.'; void trigger; }
}
function onClick(e) {
  const b = e.target.closest?.('button, [data-pms-close]');
  if (!b || !ui) return;
  if (b.matches('[data-pms-close]')) { closePreMeetingSheet(); return; }
  if (b.matches('[data-pms-make]')) { void make(); return; }
  if (b.matches('[data-pms-open]')) { void openLine(Number(b.dataset.pmsOpen), b); return; }
  if (b.matches('[data-pms-ref]')) {
    const group = jumpToPrepRef(document.querySelector('#pmsBody'), b.dataset.pmsRef, SKIN);
    if (group) ui.open.add(group);
  }
}

// ---- 여는 줄 ----
// 일정 수정 창: 담당조직이 연결된(또는 제목에 이름이 하나 맞는) 7일 안 교섭·회의 일정에만 '교섭 전 한 장 ›' 한 줄.
export async function paintEventLine(host, event) {
  if (!host) return;
  host.hidden = true; host.replaceChildren();
  const rt = runtime(), mine = Symbol('line'); host._pms = mine;
  let orgs;
  try { orgs = await readOrgs(rt); } catch { return; }
  if (host._pms !== mine) return;
  const t = showLine(event, orgs);
  if (!t) return;
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'pms-line'; b.dataset.pmsLine = t.key; b.textContent = '교섭 전 한 장 ›';
  b.addEventListener('click', () => void openPreMeetingSheet({event, orgId:t.org.id, orgName:t.org.name, trigger:b}));
  ensureStyles(); host.append(b); host.hidden = false;
}
// 담당조직 상세: 제목 아래 '다가오는 교섭 11/3(화) 14:00 — 한 장 ›'(7일 안) + 접힌 '지난 한 장 n ›'(결정 3).
export async function paintOrgLine(host, {orgId, orgName = ''} = {}) {
  if (!host || !orgId) return;
  const rt = runtime(), mine = Symbol('org'); host._pms = mine;
  const [sheets, events, orgs] = await Promise.all([readOrgSheets(orgId, rt).catch(() => ({missing:true, rows:[]})), readSoonEvents(rt).catch(() => []), readOrgs(rt).catch(() => [])]);
  if (host._pms !== mine) return;
  const {next, past} = orgLines({sheets:sheets.rows, events, orgs, orgId});
  host.replaceChildren();
  if (!next && !past.length) { host.hidden = true; return; }
  ensureStyles();
  if (next) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'pms-line'; b.dataset.pmsOrgNext = next.key; b.textContent = lineText(next);
    b.addEventListener('click', () => void openPreMeetingSheet({key:next.key, event:next.event, orgId, orgName, row:next.event ? null : next.row, trigger:b}));
    host.append(b);
  }
  if (past.length) {
    const d = document.createElement('details'); d.className = 'pms-past'; d.dataset.pmsPast = '';
    const s = document.createElement('summary'); s.textContent = `지난 한 장 ${past.length} ›`; d.append(s);
    const ul = document.createElement('ul'); ul.className = 'pms-list';
    for (const r of past.slice(0, 20)) {
      const li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button'; b.className = 'pms-open'; b.dataset.pmsPastOpen = r.event_key;
      b.textContent = `${slashDay(seoulDay(Date.parse(r.event_start)))} ${r.event_title}`;
      b.addEventListener('click', () => void openPreMeetingSheet({key:r.event_key, orgId, orgName, row:r, trigger:b}));
      li.append(b); ul.append(li);
    }
    d.append(ul); host.append(d);
  }
  host.hidden = false;
}
window.addEventListener('kptu:session-changed', () => { orgCache = null; eventCache = null; asked.clear(); closePreMeetingSheet(); });
window.KPTUPreMeetingSheet = {open:openPreMeetingSheet, close:closePreMeetingSheet, paintEventLine, paintOrgLine, autoMakeTomorrow};
