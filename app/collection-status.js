// OPS-수집점검: 홈 "마지막 수집 시각" 작은 칸. 조용히 멈춘 수집을 알아채려고 출처별 마지막 시각만 보여 준다.
// - Claude용 Drive 사본(Drive "Web2 읽기용 사본" 폴더): drive-summary GET ?action=status(소유자 JWT 전용, 시각·단계 코드만, 쓰기 없음).
// - 챙길 것 찾기(AI 후보): app_todo_radar_state.last_success_at(owner RLS 표, 화면 토큰으로 읽기만).
// - 텔레그램 수집·통화 전사: 바깥 프로그램이 만든 Drive 파일이라 Web2 권한(drive.file)으로 직접 못 읽는다(권한을 넓히지 않음).
//   대신 통화 전사용 Google 앱 스크립트가 1시간마다 시각·건수만 drive-summary POST ?action=heartbeat로 보내고(2단계),
//   같은 상태 읽기 응답의 collectors로 받는다. 옛 함수(collectors 없음)면 지금처럼 "확인 불가".
// 함수가 아직 배포 전(405·CORS 실패)이거나 표가 없으면(404) 그 줄을 조용히 숨기고, 확인할 수 있는 줄이 하나도 없으면 칸을 숨긴다.
// 내용·파일 이름·링크는 받지도 그리지도 않는다. 한 탭에서 10분에 한 번만 묻는다.
import {formatSeoulTime, seoulParts, seoulDateKey} from './meeting-time.js';
import {viewPrefs} from './view-prefs.js';

const HOUR = 3600000;
// telegram: 회사 PC 수집이 messages/<YYYY-MM>/에 만드는 가장 최근 메시지 파일 시각(업무방 매일 07:30 1회 → 하루+2시간 여유로 26시간). call: 전사 폴더 최근 파일 시각(통화가 없는 주말을 넘기도록 72시간).
// 수집기 두 줄(telegram·call)은 이 시간을 넘게 새 파일이 없어도 경고하지 않고 '조용함'으로만 표시한다(메시지·통화가 없는 날이 있음, 2026-10-22 사용자 결정). 경고는 신호(silent)만.
// silent: 앱 스크립트가 1시간마다 보내는 신호 자체가 3시간 넘게 없으면 스크립트·트리거 문제로 본다.
export const STALE_HOURS = Object.freeze({copy:24, radar:48, telegram:26, call:72});
// OPS-수집멈춤알림: 경고로 올리는 기준. 위 STALE_HOURS(조용함)보다 훨씬 길어서, 메시지·통화가 없는 주말·연휴는 넘긴다.
// telegram·call: 회사 PC 수집기가 이 시간 넘게 새 원문 파일을 안 올림. telegramSend·callSend: 보내기 스크립트가 이 시간 넘게 결과를 안 알림
// (매일 08:10 트리거 + 지터 / 1시간 트리거 + 지터). GAP: 새 원문은 있는데 실제로 보낸 글이 이 시간 넘게 없음(빈 날만 보낸 경우).
export const STALL_HOURS = Object.freeze({telegram:72, call:168});
export const SEND_SILENT_HOURS = Object.freeze({telegramSend:26, callSend:3});
export const SEND_GAP_HOURS = 72;
export const SILENT_HOURS = 3;
export const CACHE_MS = 10 * 60 * 1000;
export const SOURCES = Object.freeze([
  {key:'telegram', label:'텔레그램 수집', collector:'telegram'},
  {key:'call', label:'통화 녹음 전사', collector:'transcript'},
  {key:'telegramSend', label:'텔레그램 보내기', collector:'telegram_send', send:true},
  {key:'callSend', label:'통화 보내기', collector:'call_send', send:true},
  {key:'copy', label:'Claude용 Drive 사본'},
  {key:'radar', label:'챙길 것 찾기(AI)'},
]);
// 건수 칸을 채우는 줄(통화 전사·텔레그램). 값은 점검 신호의 최근 24시간 새 파일 수이고, 신호에 건수가 없으면 칸을 비운다.
const COUNT_KEYS = new Set(['call', 'telegram']);
export const UNCHECKABLE_NOTE = 'Web2 권한 밖이라 확인 불가';
const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));

export function validTime(value) {
  if (typeof value !== 'string' || value.length > 40 || !ISO.test(value)) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}

// One checkable source → {state:'ok'|'stale'|'failed'|'never', at} or null (hide the line).
export function judge(key, raw, now = Date.now()) {
  if (!raw) return null;
  const at = validTime(raw.at), failedAt = validTime(raw.failedAt);
  if (at === null && failedAt === null) return raw.none ? {state:'never', at:null} : null;
  if (failedAt !== null && (at === null || failedAt > at)) return {state:'failed', at};
  if (at === null) return {state:'never', at:null};
  return {state:now - at > STALE_HOURS[key] * HOUR ? 'stale' : 'ok', at};
}

// drive-summary status answer → raw copy source. Anything malformed or not ok hides the line.
export function copyFromStatus(data) {
  const c = data && data.ok === true && data.copy && typeof data.copy === 'object' ? data.copy : null;
  if (!c || !['found', 'none'].includes(c.state)) return null;
  return {at:c.last_success_at ?? null, failedAt:c.last_failure_at ?? null, none:c.state === 'none'};
}
// collectors part of the same status answer. null = old function (no field) → the two lines stay "확인 불가".
// {telegram, transcript}: each {at, reportedAt, count} or null (no signal received yet).
export function collectorsFromStatus(data) {
  const c = data && data.ok === true && data.collectors && typeof data.collectors === 'object' && !Array.isArray(data.collectors) ? data.collectors : null;
  if (!c) return null;
  const one = v => v && typeof v === 'object' && validTime(v.last_at) !== null && validTime(v.reported_at) !== null
    ? {at:v.last_at, reportedAt:v.reported_at, count:Number.isInteger(v.count) && v.count >= 0 ? v.count : null} : null;
  // 보내기 출처(OPS-수집멈춤알림): {at, reportedAt, state}. 옛 함수는 이 칸이 없어 null이고 그 줄은 조용히 숨는다.
  const SEND_STATES = ['ok', 'test', 'limit_day', 'limit_ai', 'failing', 'broken'];
  const send = v => v && typeof v === 'object' && validTime(v.last_at) !== null && validTime(v.reported_at) !== null && SEND_STATES.includes(v.state)
    ? {at:v.last_at, reportedAt:v.reported_at, state:v.state} : null;
  return {telegram:one(c.telegram), transcript:one(c.transcript), telegram_send:send(c.telegram_send), call_send:send(c.call_send)};
}
// One collector line → {state:'ok'|'quiet'|'silent'|'never', at, count}. quiet = 신호는 정상인데 새 파일만 없음(경고 아님).
export function judgeCollector(key, raw, now = Date.now()) {
  if (!raw) return {state:'never', at:null, count:null};
  const at = validTime(raw.at), reported = validTime(raw.reportedAt);
  if (at === null || reported === null) return {state:'never', at:null, count:null};
  const count = raw.count ?? null;
  if (now - reported > SILENT_HOURS * HOUR) return {state:'silent', at, count};
  if (now - at > STALL_HOURS[key] * HOUR) return {state:'stalled', at, count};
  return {state:now - at > STALE_HOURS[key] * HOUR ? 'quiet' : 'ok', at, count};
}
// 보내기 스크립트 한 줄 → {state, at}. 신호를 아직 한 번도 못 받았으면 null(줄 숨김, 켜는 날 경고가 뜨지 않게).
// 판정 순서: 신호 끊김 → 오류·실패 → AI 상한 → (정상일 때) 새 원문은 있는데 보낸 글이 오래 없음 → 하루 상한·시험 모드(경고 아님).
// collectorRaw: 같은 줄의 수집기(telegram) 신호. 새 원문이 최근에 있을 때만 '빈 날만 보냄'을 의심한다.
export function judgeSend(key, raw, now = Date.now(), collectorRaw = null) {
  if (!raw) return null;
  const at = validTime(raw.at), reported = validTime(raw.reportedAt);
  if (at === null || reported === null) return null;
  if (now - reported > SEND_SILENT_HOURS[key] * HOUR) return {state:'stopped', at};
  if (raw.state === 'broken') return {state:'broken', at};
  if (raw.state === 'failing') return {state:'failing', at};
  if (raw.state === 'limit_ai') return {state:'limit_ai', at};
  if (raw.state === 'test') return {state:'test', at};
  if (raw.state === 'limit_day') return {state:'limit_day', at};
  if (key === 'telegramSend' && collectorRaw) {
    const fresh = validTime(collectorRaw.at);
    if (fresh !== null && now - fresh <= STALE_HOURS.telegram * HOUR && now - at > SEND_GAP_HOURS * HOUR) return {state:'gap', at};
  }
  return {state:'ok', at};
}
export function radarFromRows(rows) {
  if (!Array.isArray(rows)) return null;
  // No state row yet (never run) hides the line like a missing table; the first home open of the day runs it.
  if (!rows.length || !rows[0]?.last_success_at) return null;
  return {at:rows[0].last_success_at, failedAt:null};
}

export const isOwner = rt => {
  const c = rt?.context?.read?.(), s = rt?.session?.read?.();
  return !!s?.access_token && c?.user?.id === s?.user?.id && c?.workspace?.slug === 'kptu-work' && c?.membership?.role === 'owner';
};
const scopeOf = rt => { const c = rt?.context?.read?.(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };

// drive-summary GET ?action=status is shared with the home "예전 자료 글자 읽기 끝남" line (text-backfill-notice.js):
// one request per tab and owner scope for 10 minutes (memory only). A failure is cached as null like the card cache.
let driveStatus = null; // {scope, at, promise}
export function readDriveStatus(rt) {
  const scope = scopeOf(rt), at = Date.now();
  if (driveStatus && driveStatus.scope === scope && at - driveStatus.at < CACHE_MS) return driveStatus.promise;
  const promise = rt.api('/functions/v1/drive-summary?action=status', {refreshSession:false, singleFlight:false, timeoutMs:30000}).catch(() => null);
  driveStatus = {scope, at, promise};
  return promise;
}
// After a server write the caller already knows the new value (e.g. the dismissed time): keep the shared answer in step.
export function updateDriveStatus(rt, change) {
  if (!driveStatus || driveStatus.scope !== scopeOf(rt)) return;
  driveStatus.promise = driveStatus.promise.then(data => (data && typeof data === 'object' ? change(data) : data));
}

// Each read failing (not deployed, 404, network) → null, never thrown.
export async function readStatus(rt) {
  const workspace = rt.context.read()?.workspace?.id;
  const [status, radar] = await Promise.all([
    readDriveStatus(rt),
    workspace
      ? rt.api(`/rest/v1/app_todo_radar_state?workspace_id=eq.${encodeURIComponent(workspace)}&select=last_success_at&limit=1`, {singleFlight:false}).then(radarFromRows, () => null)
      : Promise.resolve(null),
  ]);
  return {copy:copyFromStatus(status), radar, collectors:collectorsFromStatus(status)};
}

const STATE_TEXT = {ok:'', stale:'주의 · 오래됨', failed:'주의 · 최근 실패', never:'기록 없음'};
const COLLECTOR_TEXT = {ok:'', quiet:'조용함', silent:'주의 · 점검 신호 끊김', never:'점검 신호 없음', stalled:'주의 · 새 파일 없음',
  stopped:'주의 · 보내기 멈춤', broken:'주의 · 보내기 오류', failing:'주의 · 보내기 실패 이어짐', limit_ai:'주의 · 이번 달 AI 상한', gap:'주의 · 받은 글이 안 보내짐',
  limit_day:'하루 상한 · 내일 이어서', test:'시험 모드'};
const ATTENTION = new Set(['stale', 'failed', 'silent', 'stalled', 'stopped', 'broken', 'failing', 'limit_ai', 'gap']);
const timeText = at => formatSeoulTime(at, {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'});
function judgeAll(raw, now) {
  const collectors = raw?.collectors || null;
  const judged = {copy:judge('copy', raw?.copy, now), radar:judge('radar', raw?.radar, now)};
  if (collectors) for (const {key, collector, send} of SOURCES) {
    if (!collector) continue;
    judged[key] = send ? judgeSend(key, collectors[collector], now, collectors.telegram) : judgeCollector(key, collectors[collector], now);
  }
  return {collectors, judged, empty:!judged.copy && !judged.radar && !collectors};
}
// HOME-수집경보: 폰 홈이 쓰는 요약. attention = 주의 줄(오래됨·최근 실패·점검 신호 끊김), ok = 정상으로 확인된 줄이 있는지.
export function summarize(raw, now = Date.now()) {
  const {judged, empty} = judgeAll(raw, now);
  if (empty) return {empty:true, attention:[], ok:false};
  const attention = SOURCES.filter(({key}) => ATTENTION.has(judged[key]?.state)).map(({key, label}) => ({key, label, ...judged[key]}));
  return {empty:false, attention, ok:SOURCES.some(({key}) => ['ok', 'quiet'].includes(judged[key]?.state))};
}
// 받침이 있는 이름은 '이', 없으면 '가'(텔레그램 수집이 · 통화 녹음 전사가 · Claude용 Drive 사본이 · 챙길 것 찾기(AI)가).
const SUBJECT = {telegram:'이', call:'가', telegramSend:'가', callSend:'가', copy:'이', radar:'가'};
const SEND_ALERT = {
  stopped:label => `${label}가 멈췄어요`, broken:label => `${label}에 오류가 났어요`, failing:label => `${label} 실패가 이어져요`,
  limit_ai:label => `${label}가 이번 달 AI 상한에 걸렸어요`, gap:label => `${label}: 받은 글이 안 보내지고 있어요`,
};
const dayHalf = at => { const p = seoulParts(at); return `${p.month + 1}/${p.day} ${p.hour < 12 ? '오전' : '오후'}`; };
export function alertText(attention) {
  const first = attention[0];
  if (!first) return '';
  const name = first.label + SUBJECT[first.key];
  const text = SEND_ALERT[first.state] ? SEND_ALERT[first.state](first.label)
    : first.state === 'failed' ? `${name} 최근 실패했어요`
    : first.state === 'silent' ? `${first.label} 점검 신호가 끊겼어요`
    : first.at !== null ? `${name} ${dayHalf(first.at)} 이후 멈췄어요` : `${name} 멈췄어요`;
  return attention.length > 1 ? `${text} 외 ${attention.length - 1}건` : text;
}
export function renderRows(raw, now = Date.now()) {
  const {collectors, judged, empty} = judgeAll(raw, now);
  if (empty) return '';
  return SOURCES.map(({key, label, collector, send}) => {
    if (send && !collectors) return '';
    if (collector && !collectors) return `<li class="collect-row" data-collect="${key}" data-collect-state="unknown"><span class="collect-name"><span class="collect-label">${esc(label)}</span></span><span class="collect-value">${esc(UNCHECKABLE_NOTE)}</span></li>`;
    const j = judged[key];
    if (!j) return '';
    const note = (collector ? COLLECTOR_TEXT : STATE_TEXT)[j.state];
    // 배치만: 이름(+메모) | 건수 칸 | 시각 칸. 시각 칸이 맨 오른쪽이라 모든 줄의 시각이 같은 세로선에 선다. 건수가 없는 줄은 건수 칸을 비워 둔다.
    const count = COUNT_KEYS.has(key) && j.count !== null && j.count !== undefined ? `24시간 ${esc(j.count)}건` : '';
    const noteHtml = note ? ` <${ATTENTION.has(j.state) ? 'strong class="collect-note collect-warn"' : 'span class="collect-note"'}>${esc(note)}</${ATTENTION.has(j.state) ? 'strong' : 'span'}>` : '';
    return `<li class="collect-row" data-collect="${key}" data-collect-state="${j.state}"><span class="collect-name"><span class="collect-label">${esc(label)}</span>${noteHtml}</span><span class="collect-count">${count}</span><span class="collect-value">${j.at !== null ? `마지막 ${esc(timeText(j.at))}` : ''}</span></li>`;
  }).join('');
}

let cache = null; // {scope, at, raw} — memory only, this tab.
// HOME-수집경보(폰·중간 폭, 1023px 이하): 칸 대신 홈 위쪽 경고 한 줄(누르면 전체 칸이 펼쳐짐, ✕는 오늘 하루 숨김) 또는
// 맨 아래 '수집 정상 ✓' 한 줄. 전체 칸은 폰 메뉴 창 안에도 둔다. PC(1024px 이상)는 오른쪽 칸 그대로.
// 이 파일이 네 자리(카드·경고 줄·정상 줄·메뉴 창 칸)의 유일한 상태 소유자이자 렌더러다.
const phoneQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(max-width:1023px)') : null;
// ✕ "오늘 하루 숨김"은 화면 설정(날짜 하나)으로 서버 프로필에 기억한다(view-prefs.js). 읽지 못했으면 숨기지 않는다.
let expanded = false;
function hiddenToday(rt, now) {
  return viewPrefs.get('collect_hidden_on') === seoulDateKey(now);
}
function hideToday(rt, now) {
  viewPrefs.set('collect_hidden_on', seoulDateKey(now));
}
const cardHtml = (rows, titleId) => `<header><h3${titleId ? ` id="${titleId}"` : ''}>마지막 수집 시각</h3></header><ul class="collect-list">${rows}</ul>`;
function menuHostFor(doc) {
  const panel = doc.querySelector('#mobileMenu .mobile-menu-panel');
  if (!panel) return null;
  let host = panel.querySelector('[data-menu-collect]');
  if (!host) {
    host = doc.createElement('section');
    host.className = 'home-collect mobile-menu-collect';
    host.dataset.menuCollect = '';
    host.setAttribute('aria-label', '마지막 수집 시각');
    host.hidden = true;
    const before = panel.querySelector(':scope > hr');
    before ? panel.insertBefore(host, before) : panel.append(host);
  }
  return host;
}
export function mountCollectionStatus(host, {rt = window.KPTURuntime, now = () => Date.now(), alert = null, okLine = null, menu = undefined} = {}) {
  if (!host) return null;
  const menuHost = menu === undefined && typeof document !== 'undefined' ? menuHostFor(document) : menu;
  const all = [host, alert, okLine, menuHost].filter(Boolean);
  for (const el of all) el.hidden = true;
  let run = 0, alive = true, shown = null;
  function clear() { for (const el of all) { el.hidden = true; el.innerHTML = ''; } }
  function paint(raw) {
    shown = raw;
    const at = now(), rows = renderRows(raw, at);
    if (!rows) return clear();
    const phone = !!phoneQuery?.matches && !!alert;
    // PC: 오른쪽 칸 그대로. 폰: 칸은 숨기고 아래 둘 중 하나만.
    host.innerHTML = phone ? '' : cardHtml(rows, 'home-collect-title');
    host.hidden = phone;
    if (menuHost) { menuHost.innerHTML = cardHtml(rows); menuHost.hidden = false; }
    if (!phone) { if (alert) { alert.hidden = true; alert.innerHTML = ''; } if (okLine) { okLine.hidden = true; okLine.innerHTML = ''; } return; }
    const sum = summarize(raw, at);
    const warn = sum.attention.length > 0 && !hiddenToday(rt, at);
    alert.hidden = !warn;
    alert.innerHTML = warn ? `<div class="collect-alert-line"><button type="button" class="collect-alert-open" data-collect-expand aria-expanded="${expanded}" aria-controls="homeCollectPanel"><svg class="collect-alert-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3 2.5 16.5h15zM10 8.5v3.5M10 14.2v.3"/></svg><span>${esc(alertText(sum.attention))}</span><span class="collect-alert-chevron" aria-hidden="true">›</span></button><button type="button" class="collect-alert-close" data-collect-dismiss aria-label="오늘 하루 숨기기">✕</button></div><div class="home-card home-collect collect-alert-panel" id="homeCollectPanel" role="region" aria-label="마지막 수집 시각"${expanded ? '' : ' hidden'}>${cardHtml(rows)}</div>` : '';
    const ok = !sum.attention.length && sum.ok;
    okLine.hidden = !ok;
    okLine.innerHTML = ok ? '수집 정상 <span aria-hidden="true">✓</span>' : '';
  }
  function onClick(event) {
    const b = event.target.closest('button');
    if (!b || !alert.contains(b)) return;
    if (b.matches('[data-collect-expand]')) {
      expanded = b.getAttribute('aria-expanded') !== 'true';
      if (shown) paint(shown);
      alert.querySelector('[data-collect-expand]')?.focus({preventScroll:true});
    } else if (b.matches('[data-collect-dismiss]')) {
      hideToday(rt, now());
      expanded = false;
      if (shown) paint(shown);
    }
  }
  const onMedia = () => { if (alive && shown) paint(shown); };
  alert?.addEventListener('click', onClick);
  phoneQuery?.addEventListener?.('change', onMedia);
  async function refresh() {
    if (!isOwner(rt)) { clear(); return; }
    const scope = scopeOf(rt), mine = ++run;
    if (cache && cache.scope === scope && now() - cache.at < CACHE_MS) { paint(cache.raw); return; }
    const raw = await readStatus(rt);
    if (!alive || mine !== run || scope !== scopeOf(rt)) return;
    cache = {scope, at:now(), raw};
    paint(raw);
  }
  return {refresh, destroy() { alive = false; run++; alert?.removeEventListener('click', onClick); phoneQuery?.removeEventListener?.('change', onMedia); }};
}
export function resetCollectionCache() { cache = null; driveStatus = null; }
