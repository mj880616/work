// JOURNAL-일기원드라이브 2단계: [일기]의 원드라이브 사진과 ☆ 별표 데이터.
// - 원드라이브는 Edge 함수 onedrive-photos(로그인한 소유자만)를 통해서만 부른다. 토큰은 서버에만 있고 이 파일은 보지 못한다.
// - 별표는 app_diary_stars(owner RLS) 한 표에 둔다(원드라이브 사진 + 직접 올린 사진). 모든 저장은 서버, 브라우저에는 아무것도 남기지 않는다.
// - 사진 그림은 메모리(대기열의 기억, 상한 300장)로만 잠시 들고 있다(로그인한 사람이 바뀌면 버린다). 기기 저장은 쓰지 않는다.
import {ownerScope, diaryPhotos} from './diary-data.js';
import {seoulDateKey} from './meeting-time.js';
import {createThumbLoader, retryDelay, ThumbError, VISIBLE, NEAR, IDLE} from './od-thumb-loader.js';

export const OD_FN = '/functions/v1/onedrive-photos';
const encode = encodeURIComponent;
const dayRe = /^\d{4}-\d{2}-\d{2}$/;

function workspace(rt) {
  const id = rt.context.read()?.workspace?.id;
  if (!id) throw new Error('업무 공간을 확인할 수 없습니다.');
  return id;
}
const monthParam = (year, month) => `${year}-${String(month + 1).padStart(2, '0')}`;
const monthRange = (year, month) => ({first: `${monthParam(year, month)}-01`, last: seoulDateKey(new Date(Date.UTC(year, month + 1, 0, 3)))});

// ---- 원드라이브 (Edge) ----
// 원드라이브는 서버가 사진 목록을 받아 오느라 한 번에 십수 초 걸릴 수 있어, 기본 15초 대신 45초까지 기다린다.
export const OD_TIMEOUT_MS = 45000;
export const odCall = (rt, body) => rt.api(OD_FN, {method: 'POST', body, singleFlight: false, timeoutMs: OD_TIMEOUT_MS});

const ERROR_TEXT = {
  onedrive_not_configured: '원드라이브 연결 준비가 아직 안 됐어요.',
  onedrive_not_connected: '원드라이브가 연결돼 있지 않아요.',
  onedrive_folder_not_set: '사진을 읽을 폴더를 먼저 골라 주세요.',
  onedrive_auth_expired: '원드라이브 연결이 풀렸어요. 다시 연결해 주세요.',
  onedrive_reconnect_needed: '지우려면 원드라이브를 다시 연결해 주세요.',
  onedrive_outside_folder: '고른 폴더 밖의 사진은 지울 수 없어요.',
  onedrive_item_missing: '이미 없는 사진이에요.',
  onedrive_scope_invalid: '마이크로소프트가 준 권한이 맞지 않아요. 앱 등록의 권한을 확인해 주세요.',
  onedrive_state_invalid: '연결 시간이 지났어요. 처음부터 다시 눌러 주세요.',
  onedrive_code_invalid: '연결 정보를 확인하지 못했어요. 다시 연결해 주세요.',
  onedrive_folder_invalid: '이 폴더는 고를 수 없어요. 다른 폴더를 골라 주세요.',
  onedrive_too_many_requests: '폴더가 너무 커서 읽지 못했어요. 더 작은 폴더를 골라 주세요.',
  onedrive_delete_failed: '원드라이브가 지우기를 받아 주지 않았어요. 잠시 뒤 다시 해 주세요.',
  onedrive_unavailable: '원드라이브에 연결하지 못했어요. 잠시 뒤 다시 해 주세요.',
  onedrive_index_busy: '사진 목록을 이미 받고 있어요. 잠시 뒤 다시 해 주세요.',
  onedrive_throttled: '원드라이브가 요청이 많다고 해요. 잠시 뒤 다시 해 주세요.',
  onedrive_folder_missing: '이 폴더를 찾지 못했어요. 목록을 다시 열어 주세요.',
  onedrive_index_read_failed: '사진 목록을 읽지 못했어요. 잠시 뒤 다시 해 주세요.',
};
export function odErrorText(error) {
  const code = String(error?.message || '');
  if (ERROR_TEXT[code]) return ERROR_TEXT[code];
  if (error?.status === 401) return '로그인이 필요해요.';
  return '원드라이브 요청이 실패했어요. 잠시 뒤 다시 해 주세요.';
}

export async function odStatus(rt) {
  const d = await odCall(rt, {action: 'status'});
  return {
    configured: d?.configured === true,
    connected: d?.connected === true,
    folder: typeof d?.folder?.name === 'string' ? {name: d.folder.name} : null,
    canDelete: d?.can_delete === true,
  };
}
export async function odAuthStart(rt) {
  const d = await odCall(rt, {action: 'auth-start'});
  let url; try { url = new URL(d?.url); } catch { url = null; }
  // 마이크로소프트 로그인 주소만 따라간다(받은 주소를 그대로 믿고 이동하지 않는다).
  if (!url || url.protocol !== 'https:' || url.hostname !== 'login.microsoftonline.com') throw new Error('onedrive_unavailable');
  return url.href;
}
export const odAuthFinish = (rt, {code, state}) => odCall(rt, {action: 'auth-finish', code, state});
export async function odFolders(rt, parentId = null) {
  const d = await odCall(rt, parentId ? {action: 'folders', parent_id: parentId} : {action: 'folders'});
  return (Array.isArray(d?.folders) ? d.folders : []).filter(f => f && typeof f.id === 'string' && typeof f.name === 'string').map(f => ({id: f.id, name: f.name}));
}
// ---- 사진 목록(서버 색인) 받기와 하위 폴더 스위치 ----
// 한 번 부르면 서버가 한 걸음 받고 {more, indexing}을 준다. more:false가 될 때까지 화면이 반복한다(진행 상태는 서버에 있다).
export async function odSync(rt) {
  const d = await odCall(rt, {action: 'sync'});
  return {more: d?.more === true, indexing: d?.indexing === true};
}
// 다시 부르기 전에 기다릴 밀리초: 429는 서버가 준 retry_after초(1~120초로 제한), 409(다른 곳에서 받는 중)는 5초, 나머지는 null(멈춤).
export function odSyncDelay(error) {
  const code = String(error?.message || '');
  if (code === 'onedrive_throttled' || error?.status === 429) {
    const s = Number(error?.retryAfter);
    return Math.min(120, Math.max(1, Number.isFinite(s) ? s : 10)) * 1000;
  }
  if (code === 'onedrive_index_busy' || error?.status === 409) return 5000;
  // 화면이 기다리다 끊은 경우: 서버는 받은 만큼 저장해 두므로 잠깐 쉬고 이어서 받는다.
  if (error?.code === 'timeout') return 3000;
  return null;
}
const wholeCount = n => (Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0);
export async function odFolderTree(rt) {
  const d = await odCall(rt, {action: 'folders-tree'});
  if (!d?.top || typeof d.top.id !== 'string') throw new Error('onedrive_unavailable');
  const folders = (Array.isArray(d.folders) ? d.folders : []).filter(f => f && typeof f.id === 'string' && f.id && typeof f.name === 'string' && typeof f.parent_id === 'string')
    .map(f => ({id: f.id, name: f.name, parent_id: f.parent_id, enabled: f.enabled !== false, count: wholeCount(f.count), total: wholeCount(f.total)}));
  return {top: {id: d.top.id, name: String(d.top.name || ''), count: wholeCount(d.top.count), total: wholeCount(d.top.total)}, folders, indexing: d.indexing === true};
}
export const odFolderToggle = (rt, folderId, enabled) => odCall(rt, {action: 'folder-toggle', folder_id: folderId, enabled: enabled === true});
// 스위치 줄: 맨 위 폴더 바로 아래부터, ▾로 펼친 폴더의 하위만 들여쓰기로 이어 붙인다. dim=위 폴더 중 하나가 꺼져 있음(서버 규칙: 상위를 끄면 아래는 숨김).
export function odTreeRows(tree, draft, expanded) {
  const kids = new Map();
  for (const f of tree.folders) { if (!kids.has(f.parent_id)) kids.set(f.parent_id, []); kids.get(f.parent_id).push(f); }
  const on = f => (draft.has(f.id) ? draft.get(f.id) : f.enabled);
  const rows = [];
  const walk = (parentId, depth, dim) => {
    for (const f of kids.get(parentId) || []) {
      const hasKids = kids.has(f.id), open = hasKids && expanded.has(f.id);
      rows.push({...f, depth, dim, on: on(f), hasKids, open});
      if (open) walk(f.id, depth + 1, dim || !on(f));
    }
  };
  walk(tree.top.id, 0, false);
  return rows;
}
// 저장 때 보낼 것: 처음 상태와 달라진 폴더만.
export const odTreeChanges = (tree, draft) => tree.folders.filter(f => draft.has(f.id) && draft.get(f.id) !== f.enabled).map(f => ({id: f.id, enabled: draft.get(f.id)}));
export const odFolderSet = (rt, folderId) => odCall(rt, {action: 'folder-set', folder_id: folderId});
export const odDisconnect = rt => odCall(rt, {action: 'disconnect'});
export const odDelete = (rt, id) => odCall(rt, {action: 'photo-delete', id, confirm: true});

// 한 달치 사진: {days:{'YYYY-MM-DD':[{id,name,taken_at,approx}]}, truncated}. 모양이 맞는 것만 받는다.
export async function odPhotos(rt, year, month) {
  const d = await odCall(rt, {action: 'photos', month: monthParam(year, month)});
  const days = {};
  for (const [day, list] of Object.entries(d?.days && typeof d.days === 'object' ? d.days : {})) {
    if (!dayRe.test(day) || !Array.isArray(list)) continue;
    const clean = list.filter(p => p && typeof p.id === 'string' && p.id).map(p => ({id: p.id, name: String(p.name || ''), taken_at: String(p.taken_at || ''), approx: p.approx === true}));
    if (clean.length) days[day] = clean;
  }
  return {days, truncated: d?.truncated === true};
}

// ---- 사진 그림 (OD-속도 2026-10-28: 보이는 칸부터, 동시 4개, 중복 합치기, 메모리 기억 300장) ----
// 받는 길: ① photo-urls(여러 장의 짧게 사는 썸네일 주소를 한 번에) ② photo(한 장씩 서버가 그림을 넘김, object URL). 대기열은 od-thumb-loader.js.
// 기억은 이 화면을 보는 동안의 메모리뿐이고 로그인한 사람이 바뀌면 버린다. 썸네일 주소의 그림은 브라우저 일반 HTTP 캐시가 주소 단위로 다시 쓴다.

// Microsoft가 준 썸네일 주소: https, 이름 있는 호스트, 계정 글자 없음(서버 safeDownloadUrl과 같은 기준).
export function safeThumbUrl(v) {
  if (typeof v !== 'string') return null;
  let u; try { u = new URL(v); } catch { return null; }
  const h = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || u.username || u.password || !h.includes('.') || /^[\d.]+$/.test(h) || h.includes(':') || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return null;
  return u.href;
}
// 여러 장의 썸네일 주소. 서버가 이 동작을 아직 모르면(배포 전) unsupported, 요청이 많으면 throttled.
export async function odPhotoUrls(rt, ids, size = 'small') {
  let d;
  try { d = await odCall(rt, {action: 'photo-urls', ids, size}); }
  catch (error) {
    const code = String(error?.message || '');
    if (code === 'action_invalid') throw new ThumbError('unsupported');
    if (code === 'onedrive_throttled' || error?.status === 429) throw new ThumbError('throttled', {retryAfter: error?.retryAfter});
    throw error;
  }
  const urls = new Map(), failed = new Map();
  const own = (o, k) => !!o && typeof o === 'object' && Object.hasOwn(o, k);
  for (const id of ids) {
    const url = own(d?.urls, id) ? safeThumbUrl(d.urls[id]) : null;
    if (url) urls.set(id, url);
    else if (own(d?.failed, id) && typeof d.failed[id] === 'string') failed.set(id, d.failed[id]);
  }
  return {urls, failed, retryAfter: Number.isFinite(d?.retry_after) ? d.retry_after : 0};
}
// 한 장의 그림 바이트 → object URL. 429면 throttled(retry_after 존중).
export async function odPhotoBytes(rt, id, size = 'small', fetcher = globalThis.fetch) {
  if (!(await rt.session.ensure())) throw new Error('session');
  const token = rt.session.read()?.access_token;
  if (!token) throw new Error('session');
  const response = await fetcher(rt.config.url + OD_FN, {
    method: 'POST', cache: 'no-store',
    headers: {apikey: rt.config.key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
    body: JSON.stringify({action: 'photo', id, size}),
  });
  const type = response.headers.get('content-type') || '';
  if (response.status === 429) {
    let after = null; try { after = (await response.json())?.retry_after; } catch { /* 본문 없음 */ }
    throw new ThumbError('throttled', {retryAfter: after});
  }
  if (response.status === 404 || response.status === 403) throw new ThumbError(response.status === 404 ? 'missing' : 'outside');
  if (!response.ok || !/^image\//.test(type)) throw new Error('photo');
  return URL.createObjectURL(await response.blob());
}

let loader = null, cacheScope = '';
// 이 화면의 사진 대기열(로그인한 사람마다 하나). 시험은 fetchUrls·fetchBytes를 바꿔 넣는다.
export function odThumbLoader(rt = window.KPTURuntime, {fetchUrls, fetchBytes} = {}) {
  const scope = ownerScope(rt);
  if (loader && scope === cacheScope && !fetchUrls && !fetchBytes) return loader;
  loader?.clear();
  cacheScope = scope;
  loader = createThumbLoader({
    fetchUrls: fetchUrls || ((ids, size) => odPhotoUrls(rt, ids, size)),
    fetchBytes: fetchBytes || ((id, size) => odPhotoBytes(rt, id, size)),
    revoke: url => URL.revokeObjectURL(url),
  });
  return loader;
}
export function clearOdPhotoCache() { loader?.clear(); }
export function forgetOdPhoto(id) { loader?.forget(id); }
// 그림 주소 하나(대기열을 거친다). 크게 보기·미리 받기가 쓴다.
export const odPhotoUrl = (id, size = 'small', {rt = window.KPTURuntime, prio = VISIBLE} = {}) => odThumbLoader(rt).get(id, size, prio);
// 달을 열면 날마다 앞 몇 장의 주소를 가장 낮은 순서로 미리 받아 둔다(주소 묶음 길일 때만; 한 장씩 받는 길에서는 요청을 늘리지 않는다).
export function odPrefetchMonth(month, {rt = window.KPTURuntime, perDay = 4, size = 'small'} = {}) {
  const l = odThumbLoader(rt);
  if (l.mode !== 'urls') return 0;
  let n = 0;
  for (const list of Object.values(month?.days || {})) for (const p of list.slice(0, perDay)) { l.get(p.id, size, IDLE).catch(() => {}); n++; }
  return n;
}

// 화면에 보이는지(VISIBLE)와 곧 보일지(NEAR: 아래로 한 화면, 위로 조금)를 두 관찰자로 본다. 칸마다의 처리기는 WeakMap(떼어 낸 칸은 저절로 놓인다).
const watchers = new WeakMap();
let views = null;
function observers() {
  if (typeof IntersectionObserver !== 'function') return null;
  if (!views) {
    const route = kind => entries => { for (const e of entries) watchers.get(e.target)?.[kind](e.isIntersecting); };
    views = {view: new IntersectionObserver(route('view')), near: new IntersectionObserver(route('near'), {rootMargin: '200px 0px 100% 0px'})};
  }
  return views;
}
const RETRY_GAP_MS = 3000;
// 사진 한 칸(.diary-photo는 직접 올린 사진과 같은 모양). 보일 때·곧 보일 때 받고, 멀어지면 차례가 안 온 요청은 거둔다.
// 못 받으면 3초부터 두 배씩(60초까지) 기다렸다 다시 받고, 4번 넘게 실패하면 "사진" 표시로 쉰다. 그 칸이 화면에 다시 들어오면 처음부터 다시 받는다.
// eager: 화면 관찰 없이 바로 받는다(크게 보기의 앞뒤 칸). prio: eager일 때의 순서.
export function odPhotoElement(item, size, {label = '', rt = window.KPTURuntime, eager = false, prio = VISIBLE} = {}) {
  const box = document.createElement('span');
  box.className = 'diary-photo'; box.dataset.diaryPhoto = 'od:' + item.id;
  const img = document.createElement('img');
  img.alt = label || '원드라이브 사진'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer'; img.hidden = true;
  box.append(img); box.dataset.state = 'idle';
  const l = odThumbLoader(rt);
  let busy = false, holding = false, failures = 0, timer = null, gaveUpAt = 0, visible = false, near = false, mark = null;
  const setMark = on => {
    if (on && !mark) { mark = document.createElement('span'); mark.className = 'diary-photo-mark'; mark.setAttribute('aria-hidden', 'true'); mark.textContent = '사진'; box.append(mark); }
    else if (!on && mark) { mark.remove(); mark = null; }
  };
  const wanted = () => eager || visible || near;
  const order = () => (eager ? prio : visible ? VISIBLE : NEAR);
  const failed = () => {
    failures++;
    const wait = retryDelay(failures);
    if (wait === null) { box.dataset.state = 'link'; setMark(true); gaveUpAt = Date.now(); return; }
    box.dataset.state = 'retry';
    timer = setTimeout(() => { timer = null; if (wanted()) request(); }, wait);
  };
  function request() {
    const state = box.dataset.state;
    if (state === 'shown' || state === 'gone' || timer) return;
    // 받는 중: 다시 보이면 기다리는 칸으로 다시 세고(거두지 않게), 순서만 당긴다.
    if (busy) { if (holding) l.bump(item.id, size, order()); else { holding = true; l.get(item.id, size, order()); } return; }
    busy = true; holding = true; box.dataset.state = 'loading';
    l.get(item.id, size, order()).then(url => {
      holding = false;
      img.onload = () => { img.onload = img.onerror = null; busy = false; failures = 0; box.dataset.state = 'shown'; setMark(false); };
      img.onerror = () => { img.onload = img.onerror = null; img.hidden = true; img.removeAttribute('src'); l.bad(item.id, size, url); busy = false; failed(); };
      img.src = url; img.hidden = false;
    }, error => {
      busy = false; holding = false;
      if (error?.code === 'dropped') { box.dataset.state = 'idle'; return; }
      if (error?.code === 'missing' || error?.code === 'outside') { box.dataset.state = 'gone'; setMark(true); return; }
      failed();
    });
  }
  const enter = () => {
    if (box.dataset.state === 'link' && Date.now() - gaveUpAt >= RETRY_GAP_MS) { failures = 0; box.dataset.state = 'idle'; setMark(false); }
    if (box.dataset.state !== 'link') request();
  };
  const leave = () => {
    if (busy && holding) { holding = false; l.drop(item.id, size); }
    if (!box.isConnected && views) { views.view.unobserve(box); views.near.unobserve(box); }
  };
  const io = eager ? null : observers();
  if (!io) { request(); return box; }
  watchers.set(box, {
    view(on) { visible = on; if (on) enter(); else if (!near) leave(); },
    near(on) { near = on; if (on) enter(); else if (!visible) leave(); },
  });
  io.view.observe(box); io.near.observe(box);
  return box;
}

// ---- 별표 (app_diary_stars, owner RLS) ----
export const starKey = (source, key) => `${source}:${key}`;
export async function readStars(year, month, rt = window.KPTURuntime) {
  const {first, last} = monthRange(year, month);
  const rows = await rt.api(`/rest/v1/app_diary_stars?workspace_id=eq.${encode(workspace(rt))}&taken_day=gte.${first}&taken_day=lte.${last}&select=source,item_key,taken_day&order=taken_day.asc&limit=5000`);
  if (!Array.isArray(rows)) throw new Error('stars');
  return rows.filter(r => r && (r.source === 'onedrive' || r.source === 'upload') && typeof r.item_key === 'string');
}
export async function addStar({source, key, day}, rt = window.KPTURuntime) {
  if (!dayRe.test(day || '') || (source !== 'onedrive' && source !== 'upload') || !key) throw new Error('별표할 사진을 확인해 주세요.');
  try {
    await rt.api('/rest/v1/app_diary_stars', {method: 'POST', prefer: 'return=representation', body: {workspace_id: workspace(rt), source, item_key: key, taken_day: day}});
  } catch (error) {
    if (error?.status === 409) return; // 이미 별표된 사진: 같은 결과
    throw error;
  }
}
export async function removeStar({source, key}, rt = window.KPTURuntime) {
  if ((source !== 'onedrive' && source !== 'upload') || !key) throw new Error('별표를 풀 사진을 확인해 주세요.');
  await rt.api(`/rest/v1/app_diary_stars?workspace_id=eq.${encode(workspace(rt))}&source=eq.${source}&item_key=eq.${encode(key)}`, {method: 'DELETE', prefer: 'return=representation'});
}

// ---- 그날의 사진 목록: 직접 올린 사진 먼저, 그 뒤 원드라이브(찍은 시각 순) ----
export function dayItems(day, row, odMonth) {
  const uploads = diaryPhotos(row).map(file => ({kind: 'upload', source: 'upload', key: file.drive_file_id, day, file, row}));
  const drive = ((odMonth && odMonth.days && odMonth.days[day]) || []).map(p => ({kind: 'od', source: 'onedrive', key: p.id, id: p.id, day, name: p.name, taken_at: p.taken_at, approx: p.approx}));
  return [...uploads, ...drive];
}
// 서울 시각 "HH:MM". 파일 생성 시각으로 대신한 사진은 "대략"을 붙인다.
export function takenLabel(item) {
  const ms = Date.parse(item?.taken_at || '');
  if (!Number.isFinite(ms)) return '';
  const hhmm = new Date(ms + 9 * 3600 * 1000).toISOString().slice(11, 16);
  return item.approx ? `대략 ${hhmm}` : hhmm;
}

// ---- 마이크로소프트에서 돌아온 값 ----
// onedrive-return.html이 코드와 확인값을 주소의 # 뒤에 담아 보낸다(서버에 전달되지 않는 부분). 읽는 즉시 주소에서 지운다.
export function takeOdReturn(loc = globalThis.location, hist = globalThis.history) {
  if (!loc) return null;
  const hash = new URLSearchParams(String(loc.hash || '').replace(/^#/, ''));
  const code = hash.get('onedrive_code'), state = hash.get('onedrive_state'), error = hash.get('onedrive_error');
  if (code === null && state === null && error === null) return null;
  for (const name of ['onedrive_code', 'onedrive_state', 'onedrive_error']) hash.delete(name);
  const rest = hash.toString();
  try { hist?.replaceState?.(hist.state, '', loc.pathname + loc.search + (rest ? '#' + rest : '')); } catch { /* 주소 정리는 실패해도 연결 처리는 계속 */ }
  if (code && state) return {code, state};
  return {error: /^[a-z_]{1,40}$/.test(error || '') ? error : 'unknown'};
}
