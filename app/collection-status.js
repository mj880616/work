// OPS-수집점검: 홈 "마지막 수집 시각" 작은 칸. 조용히 멈춘 수집을 알아채려고 출처별 마지막 시각만 보여 준다.
// - Claude용 Drive 사본(Drive "Web2 읽기용 사본" 폴더): drive-summary GET ?action=status(소유자 JWT 전용, 시각·단계 코드만, 쓰기 없음).
// - 챙길 것 찾기(AI 후보): app_todo_radar_state.last_success_at(owner RLS 표, 화면 토큰으로 읽기만).
// - 텔레그램 수집·통화 전사: 바깥 프로그램이 만든 Drive 파일이라 Web2 권한(drive.file)으로 직접 못 읽는다(권한을 넓히지 않음).
//   대신 통화 전사용 Google 앱 스크립트가 1시간마다 시각·건수만 drive-summary POST ?action=heartbeat로 보내고(2단계),
//   같은 상태 읽기 응답의 collectors로 받는다. 옛 함수(collectors 없음)면 지금처럼 "확인 불가".
// 함수가 아직 배포 전(405·CORS 실패)이거나 표가 없으면(404) 그 줄을 조용히 숨기고, 확인할 수 있는 줄이 하나도 없으면 칸을 숨긴다.
// 내용·파일 이름·링크는 받지도 그리지도 않는다. 한 탭에서 10분에 한 번만 묻는다.
import {formatSeoulTime} from './meeting-time.js';

const HOUR = 3600000;
// telegram: 회사 PC 수집이 messages/<YYYY-MM>/에 만드는 가장 최근 메시지 파일 시각(업무방 매일 07:30 1회 → 하루+2시간 여유로 26시간). call: 전사 폴더 최근 파일 시각(통화가 없는 주말을 넘기도록 72시간).
// silent: 앱 스크립트가 1시간마다 보내는 신호 자체가 3시간 넘게 없으면 스크립트·트리거 문제로 본다.
export const STALE_HOURS = Object.freeze({copy:24, radar:48, telegram:26, call:72});
export const SILENT_HOURS = 3;
export const CACHE_MS = 10 * 60 * 1000;
export const SOURCES = Object.freeze([
  {key:'telegram', label:'텔레그램 수집', collector:'telegram'},
  {key:'call', label:'통화 녹음 전사', collector:'transcript'},
  {key:'copy', label:'Claude용 Drive 사본'},
  {key:'radar', label:'챙길 것 찾기(AI)'},
]);
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
  return {telegram:one(c.telegram), transcript:one(c.transcript)};
}
// One collector line → {state:'ok'|'stale'|'silent'|'never', at, count}.
export function judgeCollector(key, raw, now = Date.now()) {
  if (!raw) return {state:'never', at:null, count:null};
  const at = validTime(raw.at), reported = validTime(raw.reportedAt);
  if (at === null || reported === null) return {state:'never', at:null, count:null};
  const count = raw.count ?? null;
  if (now - reported > SILENT_HOURS * HOUR) return {state:'silent', at, count};
  return {state:now - at > STALE_HOURS[key] * HOUR ? 'stale' : 'ok', at, count};
}
export function radarFromRows(rows) {
  if (!Array.isArray(rows)) return null;
  // No state row yet (never run) hides the line like a missing table; the first home open of the day runs it.
  if (!rows.length || !rows[0]?.last_success_at) return null;
  return {at:rows[0].last_success_at, failedAt:null};
}

const isOwner = rt => {
  const c = rt?.context?.read?.(), s = rt?.session?.read?.();
  return !!s?.access_token && c?.user?.id === s?.user?.id && c?.workspace?.slug === 'kptu-work' && c?.membership?.role === 'owner';
};
const scopeOf = rt => { const c = rt?.context?.read?.(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };

// Each read failing (not deployed, 404, network) → null, never thrown.
export async function readStatus(rt) {
  const workspace = rt.context.read()?.workspace?.id;
  const [status, radar] = await Promise.all([
    rt.api('/functions/v1/drive-summary?action=status', {refreshSession:false, singleFlight:false, timeoutMs:30000}).catch(() => null),
    workspace
      ? rt.api(`/rest/v1/app_todo_radar_state?workspace_id=eq.${encodeURIComponent(workspace)}&select=last_success_at&limit=1`, {singleFlight:false}).then(radarFromRows, () => null)
      : Promise.resolve(null),
  ]);
  return {copy:copyFromStatus(status), radar, collectors:collectorsFromStatus(status)};
}

const STATE_TEXT = {ok:'', stale:'주의 · 오래됨', failed:'주의 · 최근 실패', never:'기록 없음'};
const COLLECTOR_TEXT = {ok:'', stale:'주의 · 오래됨', silent:'주의 · 점검 신호 끊김', never:'점검 신호 없음'};
const ATTENTION = new Set(['stale', 'failed', 'silent']);
const timeText = at => formatSeoulTime(at, {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'});
export function renderRows(raw, now = Date.now()) {
  const collectors = raw.collectors || null;
  const judged = {copy:judge('copy', raw.copy, now), radar:judge('radar', raw.radar, now)};
  if (collectors) for (const {key, collector} of SOURCES) if (collector) judged[key] = judgeCollector(key, collectors[collector], now);
  if (!judged.copy && !judged.radar && !collectors) return '';
  return SOURCES.map(({key, label, collector}) => {
    if (collector && !collectors) return `<li class="collect-row" data-collect="${key}" data-collect-state="unknown"><span class="collect-label">${esc(label)}</span><span class="collect-value">${esc(UNCHECKABLE_NOTE)}</span></li>`;
    const j = judged[key];
    if (!j) return '';
    const note = (collector ? COLLECTOR_TEXT : STATE_TEXT)[j.state];
    const parts = [j.at !== null ? `마지막 ${esc(timeText(j.at))}` : '', collector === 'transcript' && j.count !== null && j.count !== undefined ? `24시간 ${esc(j.count)}건` : '', note];
    return `<li class="collect-row" data-collect="${key}" data-collect-state="${j.state}"><span class="collect-label">${esc(label)}</span><span class="collect-value">${parts.filter(Boolean).map(t => ATTENTION.has(j.state) && t === note ? `<strong class="collect-warn">${esc(t)}</strong>` : t).join(' · ')}</span></li>`;
  }).join('');
}

let cache = null; // {scope, at, raw} — memory only, this tab.
export function mountCollectionStatus(host, {rt = window.KPTURuntime, now = () => Date.now()} = {}) {
  if (!host) return null;
  host.hidden = true;
  let run = 0, alive = true;
  function paint(raw) {
    const rows = renderRows(raw, now());
    if (!rows) { host.hidden = true; host.innerHTML = ''; return; }
    host.innerHTML = `<header><h3 id="home-collect-title">마지막 수집 시각</h3></header><ul class="collect-list">${rows}</ul>`;
    host.hidden = false;
  }
  async function refresh() {
    if (!isOwner(rt)) { host.hidden = true; return; }
    const scope = scopeOf(rt), mine = ++run;
    if (cache && cache.scope === scope && now() - cache.at < CACHE_MS) { paint(cache.raw); return; }
    const raw = await readStatus(rt);
    if (!alive || mine !== run || scope !== scopeOf(rt)) return;
    cache = {scope, at:now(), raw};
    paint(raw);
  }
  return {refresh, destroy() { alive = false; run++; }};
}
export function resetCollectionCache() { cache = null; }
