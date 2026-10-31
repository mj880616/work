// S46-20 사진 정리 ⑥(명진 11/01 01:04 "사진 정리 6 시작" = 추천대로): 업무 사진 붙이기·일기 그날 폰 사진의 순수 규칙(DOM·네트워크 없음, 단위 시험 대상).
// - 사업 보고: 그 보고 시각 앞뒤(NEAR_MS)에 찍은 폰·원드라이브 사진을 추천한다(시각만, 위치는 쓰지 않음). 명진이 고른 사진만
//   기존 사진 첨부와 같은 길(Drive 첨부, app_documents.meeting_id)로 올린다. 고르지 않은 사진은 어디에도 올리지 않는다.
// - 일기: 그날 폰 사진을 보여 주기만 한다(서버 저장 없음). 같은 사진이 원드라이브에도 있으면 원드라이브 것 한 장만.
import {dupFinder} from './photo-sources-model.mjs';

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
export const odToItem = p => ({kind:'od', source:'onedrive', key:p.id, id:p.id, day:String(p.day || ''), name:String(p.name || ''), taken_at:String(p.taken_at || ''), approx:p.approx === true, video:false, size_bytes:null});
export function odMonthItems(month) {
  const out = [];
  for (const [day, list] of Object.entries(month?.days || {})) for (const p of Array.isArray(list) ? list : []) if (p?.id) out.push(odToItem({...p, day}));
  return out;
}
const isStill = it => !!it && it.video !== true;

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

export const nearHead = n => (n ? `그 시각 사진 ${n}장` : '그 시각 앞뒤 3시간에 찍은 사진이 없어요');
export const pickLabel = n => (n ? `붙이기 ${n}` : '붙이기');
