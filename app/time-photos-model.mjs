// S46-20 사진 정리 ⑥(명진 11/01 01:04 "사진 정리 6 시작" = 추천대로): 업무 사진 붙이기·일기 그날 폰 사진의 순수 규칙(DOM·네트워크 없음, 단위 시험 대상).
// - 사업 보고: 그 보고 시각 앞뒤(NEAR_MS)에 찍은 폰·원드라이브 사진을 추천한다(시각만, 위치는 쓰지 않음). 명진이 고른 사진만
//   기존 사진 첨부와 같은 길(Drive 첨부, app_documents.meeting_id)로 올린다. 고르지 않은 사진은 어디에도 올리지 않는다.
// - 일기: 그날 폰 사진을 보여 주기만 한다(서버 저장 없음). 같은 사진이 원드라이브에도 있으면 원드라이브 것 한 장만.
// - S48-58 그 장소(요청함 10/31 11:04 ⑥ '그날·그 장소에서 찍은'): 보고 시각 앞뒤 사진들이 찍힌 곳(사진 자체의 위치)을 기준점으로 삼아,
//   그날 그 기준점 PLACE_M 안에서 찍은 사진을 앞뒤 3시간 밖이어도 더한다(here = true, 화면 '📍'). 위치는 원드라이브 색인(lat·lon)에서만 오고,
//   폰 사진은 원드라이브에 같은 사진(짝)이 있을 때 그 짝의 위치를 빌린다. 지도 서비스·주소 찾기는 쓰지 않는다(장소 글자로 좌표를 찾지 않음).
import {dupFinder, sameMedia} from './photo-sources-model.mjs';

export const NEAR_MS = 3 * 60 * 60 * 1000; // 앞뒤 3시간
export const NEAR_MAX = 60;                 // 한 번에 보이는 추천 칸
export const PICK_MAX = 20;                 // 한 번에 붙이는 장수
const SEOUL = 9 * 60 * 60 * 1000;
const dayRe = /^\d{4}-\d{2}-\d{2}$/;

// 보고 시각 → ms. 쓰기 창 값('YYYY-MM-DDTHH:MM', 서울)과 저장된 값(ISO, 시간대 있음) 둘 다. 못 읽으면 NaN.
export function reportAtMs(value) {
  const v = String(value || '').trim();
  const local = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(v);
  if (local) {
    const [, y, mo, d, h, mi, s] = local.map(Number);
    return Date.UTC(y, mo - 1, d, h, mi, s || 0) - SEOUL;
  }
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(v)) return Date.parse(v);
  return NaN;
}
export const nearWindow = (atMs, span = NEAR_MS) => ({from:atMs - span, to:atMs + span});
const takenMs = it => Date.parse(it?.taken_at || '');
// 그 시각의 서울 날짜(달 목록을 고를 때).
export const seoulDay = ms => new Date(ms + SEOUL).toISOString().slice(0, 10);
// 서울 그날 끝(다음 날 0시) ms.
export function dayEndMs(day) {
  if (!dayRe.test(day || '')) return NaN;
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d + 1) - SEOUL;
}
// 창이 걸친 달들('YYYY-MM', 앞 달 먼저, 많아야 2개).
export function windowMonths({from, to}) {
  const a = seoulDay(from).slice(0, 7), b = seoulDay(to).slice(0, 7);
  return a === b ? [a] : [a, b];
}
// 원드라이브 달 목록({days:{날:[{id,name,taken_at,approx}]}}) → 칸(일기 dayItems와 같은 모양).
export const odToItem = p => ({kind:'od', source:'onedrive', key:p.id, id:p.id, day:String(p.day || ''), name:String(p.name || ''), taken_at:String(p.taken_at || ''), approx:p.approx === true, video:false, size_bytes:null, ...placeOf(p)});
export function odMonthItems(month) {
  const out = [];
  for (const [day, list] of Object.entries(month?.days || {})) for (const p of Array.isArray(list) ? list : []) if (p?.id) out.push(odToItem({...p, day}));
  return out;
}
const isStill = it => !!it && it.video !== true;

// ---- S48-58 그 장소 ----
export const PLACE_M = 300; // 기준점에서 이 거리(m) 안이면 '그 장소'
// 찍은 곳 {lat, lon}: 둘 다 숫자이고 범위 안일 때만.
export function placeOf(p) {
  const lat = p?.lat, lon = p?.lon;
  return typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon)
    && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? {lat, lon} : {};
}
const hasPlace = it => typeof it?.lat === 'number' && typeof it?.lon === 'number';
// 두 곳 사이 거리(m, 하버사인).
export function distanceM(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
const median = list => { const v = [...list].sort((a, b) => a - b), m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
// 기준점: 보고 시각 앞뒤(span) 안에서 찍은, 위치 있는 사진들 중 가장 많이 모인 곳(radius 안 이웃이 가장 많은 사진, 같으면 보고 시각에 가까운 사진)을 고르고,
// 그 무리의 가운데 값을 쓴다(이동 중에 찍은 한두 장이 섞여도 흔들리지 않게). 없으면 null.
export function placeAnchor(items, atMs, span = NEAR_MS, radius = PLACE_M) {
  if (!Number.isFinite(atMs)) return null;
  const {from, to} = nearWindow(atMs, span);
  const got = (items || []).filter(it => { const t = takenMs(it); return hasPlace(it) && it.approx !== true && Number.isFinite(t) && t >= from && t <= to; });
  if (!got.length) return null;
  let best = null;
  for (const it of got) {
    const group = got.filter(o => distanceM(it, o) <= radius);
    const gap = Math.abs(takenMs(it) - atMs);
    if (!best || group.length > best.group.length || (group.length === best.group.length && gap < best.gap)) best = {group, gap};
  }
  return {lat:median(best.group.map(it => it.lat)), lon:median(best.group.map(it => it.lon))};
}
// 폰 사진에 원드라이브 짝의 위치를 빌려 준다(새 배열, 원래 칸은 그대로). 짝이 없거나 짝에 위치가 없으면 그대로.
export function lendPlaces(phone, od) {
  const withPlace = (od || []).filter(hasPlace);
  if (!withPlace.length) return phone || [];
  const byName = new Map();
  for (const o of withPlace) { const k = String(o.name || '').trim().toLowerCase(); if (k) (byName.get(k) || byName.set(k, []).get(k)).push(o); }
  return (phone || []).map(p => {
    if (hasPlace(p)) return p;
    const twin = (byName.get(String(p.name || '').trim().toLowerCase()) || []).find(o => sameMedia(p, o))
      || withPlace.find(o => sameMedia(p, o));
    return twin ? {...p, lat:twin.lat, lon:twin.lon} : p;
  });
}
// 보고 시각이 걸친 범위: 앞뒤 3시간 창과 그 서울 날 하루를 합친 것(그 장소 사진은 그날 전체에서 찾는다).
export function suggestRange(atMs, span = NEAR_MS) {
  const win = nearWindow(atMs, span), day = seoulDay(atMs), end = dayEndMs(day);
  return {from:Math.min(win.from, end - 24 * 60 * 60 * 1000), to:Math.max(win.to, end - 1)};
}

// 보고 시각 앞뒤 사진: 폰·원드라이브를 합쳐 찍은 시각 순(앞 먼저). 같은 사진은 폰 것 한 장(원본이 폰 안에 있어 서버를 거치지 않음).
export function nearPhotos({phone = [], od = [], atMs, span = NEAR_MS, max = NEAR_MAX}) {
  if (!Number.isFinite(atMs)) return [];
  const {from, to} = nearWindow(atMs, span);
  const inside = it => { const t = takenMs(it); return Number.isFinite(t) && t >= from && t <= to; };
  const ph = phone.filter(it => isStill(it) && inside(it));
  const phDup = ph.length ? dupFinder(ph) : () => false;
  const seen = new Set();
  const all = [...ph, ...od.filter(it => isStill(it) && inside(it) && !phDup(it))].filter(it => (seen.has(it.id) ? false : seen.add(it.id)));
  // 보고 시각에 가까운 것부터 max장을 고른 뒤 찍은 시각 순으로 늘어놓는다.
  const near = all.sort((a, b) => Math.abs(takenMs(a) - atMs) - Math.abs(takenMs(b) - atMs)).slice(0, max);
  return near.sort((a, b) => takenMs(a) - takenMs(b) || String(a.id).localeCompare(String(b.id)));
}

// 그 시각 + 그 장소 사진: 앞뒤 3시간 사진(nearPhotos와 같은 규칙)에 그날 기준점 PLACE_M 안에서 찍은 사진을 더한다.
// 답 = {items(찍은 순, 그 장소면 here:true), here(📍 장수), anchor(기준점 또는 null)}. 많으면 그 장소 사진을 먼저 남기고 나머지는 보고 시각에 가까운 것부터.
export function suggestPhotos({phone = [], od = [], atMs, span = NEAR_MS, max = NEAR_MAX, radius = PLACE_M}) {
  if (!Number.isFinite(atMs)) return {items:[], here:0, anchor:null};
  const ph0 = lendPlaces(phone.filter(isStill), od);
  const anchor = placeAnchor([...ph0, ...od], atMs, span);
  const {from, to} = nearWindow(atMs, span), day = seoulDay(atMs);
  const inside = it => { const t = takenMs(it); return Number.isFinite(t) && t >= from && t <= to; };
  const atPlace = it => !!anchor && hasPlace(it) && it.approx !== true && distanceM(anchor, it) <= radius;
  const sameDay = it => { const t = takenMs(it); return Number.isFinite(t) && seoulDay(t) === day; };
  const want = it => inside(it) || (atPlace(it) && sameDay(it));
  const ph = ph0.filter(want);
  const phDup = ph.length ? dupFinder(ph) : () => false;
  const seen = new Set();
  const all = [...ph, ...od.filter(it => isStill(it) && want(it) && !phDup(it))]
    .filter(it => (seen.has(it.id) ? false : seen.add(it.id)))
    .map(it => (atPlace(it) ? {...it, here:true} : it));
  const gap = it => Math.abs(takenMs(it) - atMs);
  const kept = all.sort((a, b) => (b.here === true) - (a.here === true) || gap(a) - gap(b)).slice(0, max);
  kept.sort((a, b) => takenMs(a) - takenMs(b) || String(a.id).localeCompare(String(b.id)));
  return {items:kept, here:kept.filter(it => it.here).length, anchor};
}

// 일기 그날 폰 사진: 그날 찍은 사진만(동영상 빼고), 원드라이브에 같은 사진이 있으면 뺀다, 찍은 시각 순.
export function phoneDayItems(phone, day, odDay = []) {
  const od = (odDay || []).map(p => odToItem({...p, day}));
  const odDup = od.length ? dupFinder(od) : () => false;
  return (phone || []).filter(it => isStill(it) && it.day === day && !odDup(it)).sort((a, b) => takenMs(a) - takenMs(b));
}

// 붙일 파일 이름: 확장자가 없거나 그림 형식과 다르면 형식에 맞는 확장자를 붙인다.
const EXT = Object.freeze({'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp', 'image/gif':'gif', 'image/heic':'heic', 'image/heif':'heif'});
export function attachName(name, type) {
  const base = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 120) || '사진';
  const ext = EXT[String(type || '').toLowerCase()];
  if (!ext) return base;
  return /\.[A-Za-z0-9]{2,5}$/.test(base) ? base : `${base}.${ext}`;
}

export const nearHead = (n, here = 0) => (n ? `그 시각 사진 ${n}장${here ? ` · 📍그 장소 ${here}장` : ''}` : '그 시각 앞뒤 3시간에 찍은 사진이 없어요');
export const pickLabel = n => (n ? `붙이기 ${n}` : '붙이기');
