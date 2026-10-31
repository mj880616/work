// PHOTO-출처 ①(요청함 10/30 17:30, 명진 결정 "어 맞아"): 사진 메뉴의 출처(원드라이브·구글 드라이브·폰 사진) 규칙. 화면 없이 시험한다.
// - 출처 켜기/끄기는 서버 view_prefs.photo_sources({onedrive, gdrive, phone} 참·거짓, migration 20261030230000) 하나에 둔다(기기 저장 없음).
//   없으면 원드라이브·폰 사진 켜짐, 구글 드라이브 꺼짐(② 전에는 '준비 중'이라 켜지지 않는다).
// - 켜진 출처는 같은 정렬 기준으로 한 목록에 섞는다. 출처마다 따로 쪽을 받아 오므로 '모든 출처가 이미 보낸 것보다 앞인 것'만 보인다(safe 앞부분).
// - 같은 사진이 폰과 원드라이브에 다 있으면(파일 이름·크기·찍은 시각) 한 장만 보인다(원드라이브 것을 남김).
// S46-24 ④: 구글 드라이브(Edge gdrive-photos, 운영자 기능 gdrive_photos가 있는 작업공간만). 같은 사진 규칙은 원드라이브 > 구글 드라이브 > 폰 사진 순서로 남긴다.
import {sortCompare} from './photos-model.mjs';

export const SOURCES = Object.freeze(['onedrive', 'gdrive', 'phone']);
export const SOURCE_DEFAULT = Object.freeze({onedrive:true, gdrive:false, phone:true});
export const SOURCE_TEXT = Object.freeze({onedrive:'원드라이브', gdrive:'구글 드라이브', phone:'폰 사진'});
// 구글 드라이브: S46-24 ①~③(DB·연결 권한·Edge gdrive-photos)이 들어와 켰다. 칩은 운영자 기능 gdrive_photos가 있을 때만 보인다(sourceButtons gdrive).
export const GDRIVE_READY = true;
export const GDRIVE_FEATURE = 'gdrive_photos';
// app_my_features() 답(기능 키 목록) → 구글 드라이브 칩을 보일지. 모양이 틀리면 안 보인다(서버가 어차피 403).
export const gdriveAllowed = features => GDRIVE_READY && Array.isArray(features) && features.includes(GDRIVE_FEATURE);

// 서버 값 → {onedrive, gdrive, phone}. 모양이 틀린 칸은 기본값.
export function parseSources(value) {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const out = {};
  for (const name of SOURCES) out[name] = typeof v[name] === 'boolean' ? v[name] : SOURCE_DEFAULT[name];
  return out;
}
export const sourcesValue = state => Object.fromEntries(SOURCES.map(name => [name, parseSources(state)[name]]));
export function toggleSource(state, name) {
  const next = parseSources(state);
  if (!SOURCES.includes(name)) return next;
  next[name] = !next[name];
  return next;
}
// 아이콘 줄: 폰 사진은 폰 앱에서만(PC·폰 브라우저는 없음), 구글 드라이브는 운영자 기능이 있는 작업공간에서만(gdrive:true).
// gdriveProblem: 권한이 없거나(scope_missing) 연결이 풀렸으면(drive_auth_expired) 그 이유 — 칩은 '권한 없음'이고 누르면 [Drive 다시 연결].
export function sourceButtons(state, {phone = false, gdrive = false, gdriveProblem = ''} = {}) {
  const s = parseSources(state);
  const out = [{name:'onedrive', on:s.onedrive, ready:true}];
  if (gdrive && GDRIVE_READY) out.push({name:'gdrive', on:s.gdrive, ready:!gdriveProblem, problem:gdriveProblem || ''});
  if (phone) out.push({name:'phone', on:s.phone, ready:true});
  return out.map(b => ({...b, label:`${SOURCE_TEXT[b.name]}${b.problem ? (GDRIVE_RECONNECT.includes(b.problem) ? ' · 권한 없음' : ' · 못 읽음') : b.on ? ' 켜짐' : ' 꺼짐'}`}));
}
// 이번 화면에서 실제로 읽을 출처. gdrive = 칩이 보이고 권한이 있음.
export function activeSources(state, {onedrive = false, phone = false, gdrive = false} = {}) {
  const s = parseSources(state);
  return {onedrive:s.onedrive && onedrive, phone:s.phone && phone, gdrive:s.gdrive && gdrive && GDRIVE_READY};
}
export const activeCount = u => ['onedrive', 'gdrive', 'phone'].filter(k => u?.[k]).length;

// ---- 구글 드라이브 사진 한 장(Edge gdrive-photos list 답) → 사진 메뉴 칸 ----
// {id, folder, name, video, size_bytes, taken_at, approx, day}. 칸 id는 'gd:'+Drive id(원드라이브 id·폰 'ph:'와 겹치지 않게).
const driveIdRe = /^[A-Za-z0-9_-]{1,200}$/;
export const gdriveKey = driveId => `gd:${driveId}`;
export const gdriveIdOf = id => (/^gd:([A-Za-z0-9_-]{1,200})$/.exec(String(id || '')) || [])[1] || null;
export function gdriveToItem(p) {
  if (!p || !driveIdRe.test(String(p.id ?? ''))) return null;
  const taken = isoOf(p.taken_at);
  if (!taken || !dayRe.test(p.day || '')) return null;
  return {kind:'gdrive', source:'gdrive', key:gdriveKey(p.id), id:gdriveKey(p.id), gdId:String(p.id), day:p.day, name:String(p.name || ''), taken_at:taken, approx:p.approx === true,
    video:p.video === true, duration_ms:null, width:null, height:null, size_bytes:Number.isFinite(p.size_bytes) && p.size_bytes >= 0 ? p.size_bytes : null,
    folder:typeof p.folder === 'string' && driveIdRe.test(p.folder) ? p.folder : null};
}
// 다음 쪽 기준(before): 앞 쪽 마지막 사진. 달·날로 건너뛰기(from)는 그 시각보다 앞(가장 큰 id 'z…'로 같은 시각 모두 포함).
export const gdriveBefore = last => (last ? {t:last.taken_at, id:last.gdId} : null);
export const gdriveFrom = t => (Number.isFinite(Date.parse(t || '')) ? {t:new Date(Date.parse(t)).toISOString(), id:'z'.repeat(40)} : null);
// 서버 답 오류 코드 → 화면 글(작은 글자로 이유 코드도 함께 보인다).
const GDRIVE_TEXT = Object.freeze({
  scope_missing:'구글 드라이브 사진 권한이 없어요', drive_auth_expired:'구글 드라이브 연결이 풀렸어요', drive_not_connected:'구글 드라이브가 연결돼 있지 않아요',
  feature_required:'이 작업공간은 구글 드라이브 사진을 쓰지 않아요', drive_owner_mismatch:'구글 드라이브 연결 주인이 아니에요', forbidden:'쓸 수 없어요',
  drive_denied:'구글 드라이브가 거절했어요', not_found:'구글 드라이브에 없어요', folder_not_found:'폴더를 찾지 못했어요', photo_not_in_index:'켠 폴더 사진이 아니에요',
  too_many_folders:'켤 수 있는 폴더는 50개까지예요', name_invalid:'이름을 확인해 주세요(1~200자)', confirm_required:'확인이 필요해요', ids_invalid:'한 번에 50장까지예요',
  thumb_unavailable:'그림을 받지 못했어요', media_unsupported:'열 수 없는 파일이에요', gdrive_unavailable:'구글 드라이브에 연결하지 못했어요',
  gdrive_store_unavailable:'사진 목록 저장소에 닿지 못했어요', session_required:'로그인이 필요해요', action_invalid:'서버가 아직 이 기능을 몰라요',
});
// 권한·연결 문제(칩 '권한 없음' + [Drive 다시 연결])로 볼 코드.
export const GDRIVE_RECONNECT = Object.freeze(['scope_missing', 'drive_auth_expired', 'drive_not_connected']);
export const gdriveCode = error => { const m = String(error?.message || ''); return /^[a-z_]{1,40}$/.test(m) ? m : (error?.status ? `http_${error.status}` : 'error'); };
export const gdriveNeedsReconnect = error => GDRIVE_RECONNECT.includes(gdriveCode(error));
export function gdriveErrorText(error) {
  const code = gdriveCode(error);
  return `${GDRIVE_TEXT[code] || '구글 드라이브 요청이 실패했어요'} (${code})`;
}
// status 답 → 칸 상태. scope:false면 권한 없음(scope_missing).
export function gdriveState(status) {
  if (!status || status.ok !== true) return {problem:'error', foldersOn:0};
  return {problem:status.scope === true ? '' : 'scope_missing', foldersOn:Number.isInteger(status.folders_on) ? status.folders_on : 0};
}

// ---- 폰 사진 한 장(앱 PhoneMediaRules.itemJson) → 사진 메뉴 칸 ----
const dayRe = /^\d{4}-\d{2}-\d{2}$/, idRe = /^\d{1,18}$/;
const isoOf = v => { const ms = Date.parse(v || ''); return Number.isFinite(ms) ? new Date(ms).toISOString() : ''; };
export const phoneKey = phoneId => `ms:${phoneId}`;
export function phoneToItem(p) {
  if (!p || !idRe.test(String(p.id ?? ''))) return null;
  const phoneId = String(p.id), taken = isoOf(p.taken_at);
  if (!taken || !dayRe.test(p.day || '')) return null;
  return {kind:'phone', source:'phone', key:phoneKey(phoneId), id:`ph:${phoneId}`, phoneId, day:p.day, name:String(p.name || ''), taken_at:taken, approx:p.approx === true,
    video:p.kind === 'video', duration_ms:Number.isFinite(p.duration_ms) ? p.duration_ms : null, width:Number.isFinite(p.width) ? p.width : null, height:Number.isFinite(p.height) ? p.height : null,
    screenshot:p.screenshot === true, size_bytes:Number.isFinite(p.size_bytes) && p.size_bytes >= 0 ? p.size_bytes : null, uploaded_at:isoOf(p.uploaded_at),
    // PHOTO-폴더스위치(앱 0.4.1+): 폰 폴더(relative_path). 옛 앱은 없음(null). 화면 메모리에서만 쓴다.
    folder:typeof p.folder === 'string' && p.folder.length <= 255 ? p.folder : null};
}
// ---- PHOTO-폰사진못읽음: 앱 다리 실패 이유(앱 0.4.0+는 상태 코드 + {"error":종류,"detail":예외 클래스 이름}) ----
export const PHONE_FAIL_KINDS = Object.freeze(['permission', 'key', 'bad_request', 'query', 'column', 'decode', 'not_found']);
const PHONE_FAIL_TEXT = Object.freeze({
  permission:'사진 접근 허용이 없어요', key:'앱 열쇠가 바뀌었어요, [다시]를 눌러 주세요', bad_request:'앱이 요청 모양을 받지 않았어요',
  query:'사진첩 조회가 실패했어요', column:'사진첩 항목 이름이 맞지 않아요', decode:'그림을 만들지 못했어요', not_found:'그 사진이 폰에 없어요',
  unreached:'앱이 요청을 받지 못했어요', answer:'앱 답을 읽지 못했어요', no_access:'사진 접근 허용이 없어요', old:'앱이 이유를 주지 않았어요(앱 새 판 필요)',
});
const DETAIL_RE = /^[A-Za-z0-9_$.]{1,60}$/;
// 실패 답 해석. status: HTTP 상태(0 = 앱에 닿지 않음), body: 답 글(JSON이 아니어도 됨). 모르는 종류·이상한 글은 버린다.
export function phoneFailure(status, body = '', {error = '', detail: given = ''} = {}) {
  let v = null;
  try { v = body ? JSON.parse(body) : null; } catch { v = null; }
  const kind = error || (PHONE_FAIL_KINDS.includes(v?.error) ? v.error : '');
  const raw = given || v?.detail;
  const detail = typeof raw === 'string' && DETAIL_RE.test(raw) ? raw : '';
  return {status:Number.isInteger(status) && status >= 0 && status < 1000 ? status : 0, error:kind, detail};
}
// 실패 → 화면 글('폰 사진을 읽지 못했어요: 이유 (종류·클래스·상태)'). 사진 이름·경로는 들어오지 않는다(앱이 보내지 않음).
export function phoneErrorText(err) {
  const p = err?.phone;
  if (!p) return `폰 사진을 읽지 못했어요${err?.message === 'phone_no_access' ? `: ${PHONE_FAIL_TEXT.no_access}` : '.'}`;
  const kind = PHONE_FAIL_TEXT[p.error] ? p.error : p.status === 404 ? 'old' : '';
  const tags = [p.error, p.detail && DETAIL_RE.test(p.detail) ? p.detail : '', p.status ? String(p.status) : ''].filter(Boolean).join('·');
  return `폰 사진을 읽지 못했어요: ${PHONE_FAIL_TEXT[kind] || '알 수 없는 실패'}${tags ? ` (${tags})` : ''}`;
}
export const phoneIdOfKey = key => (/^ms:(\d{1,18})$/.exec(String(key || '')) || [])[1] || null;

// ---- 중복 판정: 이름(대소문자 무시)이 같고 크기나 찍은 시각(2초 안)이 같거나, 크기가 같고 찍은 시각이 2초 안 ----
export const SAME_MS = 2000;
const lower = v => String(v || '').trim().toLowerCase();
export function sameMedia(a, b) {
  if (!a || !b || a.video !== b.video) return false;
  const ta = Date.parse(a.taken_at || ''), tb = Date.parse(b.taken_at || '');
  const close = Number.isFinite(ta) && Number.isFinite(tb) && Math.abs(ta - tb) <= SAME_MS;
  const sizeEq = Number.isFinite(a.size_bytes) && a.size_bytes > 0 && a.size_bytes === b.size_bytes;
  const nameEq = !!lower(a.name) && lower(a.name) === lower(b.name);
  return (nameEq && (sizeEq || close)) || (sizeEq && close);
}
// 원드라이브 칸들로 찾기표를 만든다(크기·이름으로 후보만 본다).
export function dupFinder(odItems) {
  const bySize = new Map(), byName = new Map();
  const put = (m, k, it) => { if (!k) return; const l = m.get(k); if (l) l.push(it); else m.set(k, [it]); };
  for (const it of odItems || []) { if (it.size_bytes > 0) put(bySize, it.size_bytes, it); put(byName, lower(it.name), it); }
  return p => [...(bySize.get(p.size_bytes) || []), ...(byName.get(lower(p.name)) || [])].some(o => sameMedia(p, o));
}

// ---- 섞기 ----
// streams = [{items(그 출처 정렬 순서로 받은 것), ended}]. 끝나지 않은 출처의 마지막 칸보다 뒤(정렬상)는 아직 보이지 않는다
// (그 출처의 다음 쪽에 더 앞선 것이 있을 수 있어서). 끝나지 않았는데 아직 하나도 못 받은 출처가 있으면 아무것도 보이지 않는다.
// 결과: {items(보일 것, 정렬·중복 제거), waiting(아직 받아야 하는 출처 번호들 — 가장 앞을 막는 출처 먼저), ended(모두 끝)}.
export function mergeSources(streams, sort, {dropDup = true} = {}) {
  const cmp = sortCompare(sort);
  const live = streams.map((s, i) => ({i, s})).filter(({s}) => !s.ended);
  // 같은 사진 한 장: 원드라이브 > 구글 드라이브 > 폰 사진 순서로 남긴다(뒤 출처의 같은 사진을 뺀다).
  const od = streams.filter(s => s.source === 'onedrive').flatMap(s => s.items);
  const gd = streams.filter(s => s.source === 'gdrive').flatMap(s => s.items);
  const odDup = dropDup && od.length ? dupFinder(od) : () => false;
  const gdKept = gd.filter(it => !odDup(it));
  const gdDup = dropDup && gdKept.length ? dupFinder(gdKept) : () => false;
  const all = [];
  for (const s of streams) for (const it of s.items) {
    if (it.source === 'gdrive' && odDup(it)) continue;
    if (it.source === 'phone' && (odDup(it) || gdDup(it))) continue;
    all.push(it);
  }
  all.sort(cmp);
  let items = all;
  if (live.length) {
    if (live.some(({s}) => !s.items.length)) items = [];
    else {
      const lasts = live.map(({s}) => s.items[s.items.length - 1]);
      items = all.filter(it => lasts.every(last => cmp(it, last) <= 0));
    }
  }
  // 막는 출처: 아직 하나도 없는 것 먼저, 그다음 마지막 칸이 가장 앞(정렬상 작음)인 것.
  const waiting = live.slice().sort((a, b) => {
    if (!a.s.items.length || !b.s.items.length) return (a.s.items.length ? 1 : 0) - (b.s.items.length ? 1 : 0);
    return cmp(a.s.items[a.s.items.length - 1], b.s.items[b.s.items.length - 1]);
  }).map(({i}) => i);
  return {items, waiting, ended:!live.length};
}

// 달력 한 달: 출처마다 받은 days({날: {count, cover}})를 합친다. 대표는 원드라이브 것 먼저(없으면 폰 사진). 장수는 더한다
// (같은 사진이 두 곳에 있으면 달력 장수는 두 번 셀 수 있다 — 목록은 한 장만).
export function mergeDays(odDays, phoneDays) {
  const out = {};
  for (const [day, d] of Object.entries(odDays || {})) if (d?.count > 0) out[day] = {count:d.count, cover:d.cover, rep:null};
  for (const [day, d] of Object.entries(phoneDays || {})) {
    if (!(d?.count > 0)) continue;
    const rep = phoneToItem(d.cover);
    if (out[day]) out[day].count += d.count;
    else out[day] = {count:d.count, cover:null, rep};
  }
  return out;
}
// 빠른 이동 막대: 달마다 장수를 더한다.
export function mergeMonths(...lists) {
  const out = {};
  for (const m of lists) for (const [k, n] of Object.entries(m || {})) if (Number.isFinite(n) && n > 0) out[k] = (out[k] || 0) + n;
  return out;
}
// 폰 사진 별표 목록을 그 달 날마다 묶기(★ 거르기 달력).
export function daysFromItems(items, monthKey) {
  const out = {};
  for (const it of items || []) {
    if (!String(it.day).startsWith(monthKey + '-')) continue;
    const d = out[it.day] || (out[it.day] = {count:0, cover:null});
    d.count++; if (!d.cover) d.cover = {id:it.phoneId, name:it.name, taken_at:it.taken_at, day:it.day, kind:it.video ? 'video' : 'photo'};
  }
  return out;
}
