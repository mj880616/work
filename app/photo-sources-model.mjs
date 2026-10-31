// PHOTO-출처 ①(요청함 10/30 17:30, 명진 결정 "어 맞아"): 사진 메뉴의 출처(원드라이브·구글 드라이브·폰 사진) 규칙. 화면 없이 시험한다.
// - 출처 켜기/끄기는 서버 view_prefs.photo_sources({onedrive, gdrive, phone} 참·거짓, migration 20261030230000) 하나에 둔다(기기 저장 없음).
//   없으면 원드라이브·폰 사진 켜짐, 구글 드라이브 꺼짐(② 전에는 '준비 중'이라 켜지지 않는다).
// - 켜진 출처는 같은 정렬 기준으로 한 목록에 섞는다. 출처마다 따로 쪽을 받아 오므로 '모든 출처가 이미 보낸 것보다 앞인 것'만 보인다(safe 앞부분).
// - 같은 사진이 폰과 원드라이브에 다 있으면(파일 이름·크기·찍은 시각) 한 장만 보인다(원드라이브 것을 남김).
import {sortCompare} from './photos-model.mjs';

export const SOURCES = Object.freeze(['onedrive', 'gdrive', 'phone']);
export const SOURCE_DEFAULT = Object.freeze({onedrive:true, gdrive:false, phone:true});
export const SOURCE_TEXT = Object.freeze({onedrive:'원드라이브', gdrive:'구글 드라이브', phone:'폰 사진'});
// 구글 드라이브(②)는 아직 연결 길이 없다. ②가 들어올 때 이 값만 바꾼다.
export const GDRIVE_READY = false;

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
// 아이콘 줄: 폰 사진은 폰 앱에서만(PC·폰 브라우저는 없음), 구글 드라이브는 늘 보이되 ② 전에는 흐리게(누를 수 없음).
export function sourceButtons(state, {phone = false, gdriveReady = GDRIVE_READY} = {}) {
  const s = parseSources(state);
  const out = [{name:'onedrive', on:s.onedrive, ready:true}, {name:'gdrive', on:gdriveReady && s.gdrive, ready:gdriveReady}];
  if (phone) out.push({name:'phone', on:s.phone, ready:true});
  return out.map(b => ({...b, label:`${SOURCE_TEXT[b.name]}${b.ready ? (b.on ? ' 켜짐' : ' 꺼짐') : ' · 준비 중'}`}));
}
// 이번 화면에서 실제로 읽을 출처.
export function activeSources(state, {onedrive = false, phone = false, gdrive = false} = {}) {
  const s = parseSources(state);
  return {onedrive:s.onedrive && onedrive, phone:s.phone && phone, gdrive:s.gdrive && gdrive && GDRIVE_READY};
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
    screenshot:p.screenshot === true, size_bytes:Number.isFinite(p.size_bytes) && p.size_bytes >= 0 ? p.size_bytes : null, uploaded_at:isoOf(p.uploaded_at)};
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
  const od = streams.filter(s => s.source === 'onedrive').flatMap(s => s.items);
  const isDup = dropDup && od.length ? dupFinder(od) : () => false;
  const all = [];
  for (const s of streams) for (const it of s.items) if (!(it.source === 'phone' && isDup(it))) all.push(it);
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
