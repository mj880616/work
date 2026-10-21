// OPS-수집점검: 홈 "마지막 수집 시각" 작은 칸. 조용히 멈춘 수집을 알아채려고 출처별 마지막 시각만 보여 준다.
// - Drive 읽기용 사본: drive-summary GET ?action=status(소유자 JWT 전용, 시각·단계 코드만, 쓰기 없음).
// - 챙길 것 찾기(AI 후보): app_todo_radar_state.last_success_at(owner RLS 표, 화면 토큰으로 읽기만).
// - 텔레그램 수집·통화 전사: 바깥 프로그램이 만든 Drive 파일이라 Web2 권한(drive.file)으로 못 읽음 → "확인 불가"로만 표시.
//   권한을 넓히지 않는다. 받기 입구(AI-서버연동 S6) 뒤에 Web2 기록으로 시각을 알 수 있다.
// 함수가 아직 배포 전(405·CORS 실패)이거나 표가 없으면(404) 그 줄을 조용히 숨기고, 확인할 수 있는 줄이 하나도 없으면 칸을 숨긴다.
// 내용·파일 이름·링크는 받지도 그리지도 않는다. 한 탭에서 10분에 한 번만 묻는다.
import {formatSeoulTime} from './meeting-time.js';

const HOUR = 3600000;
export const STALE_HOURS = Object.freeze({copy:24, radar:48});
export const CACHE_MS = 10 * 60 * 1000;
export const SOURCES = Object.freeze([
  {key:'telegram', label:'텔레그램 수집', checkable:false},
  {key:'call', label:'통화 녹음 전사', checkable:false},
  {key:'copy', label:'Drive 읽기용 사본', checkable:true},
  {key:'radar', label:'챙길 것 찾기(AI)', checkable:true},
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
  const [copy, radar] = await Promise.all([
    rt.api('/functions/v1/drive-summary?action=status', {refreshSession:false, singleFlight:false, timeoutMs:30000}).then(copyFromStatus, () => null),
    workspace
      ? rt.api(`/rest/v1/app_todo_radar_state?workspace_id=eq.${encodeURIComponent(workspace)}&select=last_success_at&limit=1`, {singleFlight:false}).then(radarFromRows, () => null)
      : Promise.resolve(null),
  ]);
  return {copy, radar};
}

const STATE_TEXT = {ok:'', stale:'주의 · 오래됨', failed:'주의 · 최근 실패', never:'기록 없음'};
const timeText = at => formatSeoulTime(at, {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'});
export function renderRows(raw, now = Date.now()) {
  const judged = {copy:judge('copy', raw.copy, now), radar:judge('radar', raw.radar, now)};
  if (!judged.copy && !judged.radar) return '';
  return SOURCES.map(({key, label, checkable}) => {
    if (!checkable) return `<li class="collect-row" data-collect="${key}" data-collect-state="unknown"><span class="collect-label">${esc(label)}</span><span class="collect-value">${esc(UNCHECKABLE_NOTE)}</span></li>`;
    const j = judged[key];
    if (!j) return '';
    const attention = j.state === 'stale' || j.state === 'failed';
    const when = j.at !== null ? `마지막 ${esc(timeText(j.at))}` : '';
    const note = STATE_TEXT[j.state];
    return `<li class="collect-row" data-collect="${key}" data-collect-state="${j.state}"><span class="collect-label">${esc(label)}</span><span class="collect-value">${[when, note].filter(Boolean).map(t => attention && t === note ? `<strong class="collect-warn">${esc(t)}</strong>` : t).join(' · ')}</span></li>`;
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
