// S48-60 PHOTO-정보고치기(요청함 11/03 00:29, 명진 결정 E1·E2): 사진 정보(찍은 시각·위치) 고치기 계산. 화면·다리 없이 시험한다.
// - 방법 하나: shift(모두 ±n시간 n분 밀기) · date(모두 이 날짜·시각으로 — 첫 장을 맞추고 원래 간격 유지) · place(모두 이 장소로) · clear(위치 지우기).
// - 미리 보기 표 = 장마다 {id, name, before, after, can, why}. 못 고치는 사진(HEIC·동영상)은 빠진다.
// - 앱에 보낼 것 = [{id, taken} | {id, loc} | {id, loc:null}], 되돌리기 = 앞 값으로 같은 모양.
// - 서버 기록 행(app_photo_info_edits) = 한 장에 한 줄(사진 이름 없음).
import {seoulParts} from './meeting-time.js';

export const INFO_MAX = 200;
const HOUR = 3600000, MINUTE = 60000;
export const TAKEN_MIN = 86400000, TAKEN_MAX = 4102444800000;
const pad = n => String(n).padStart(2, '0');

export function validLoc(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 && !(lat === 0 && lon === 0);
}
// '37.5665, 126.9780' 또는 지도 주소(…@37.5,127.0… / ?q=37.5,127.0 / ll=)에서 위도·경도를 꺼낸다. 못 꺼내면 null.
export function parsePlace(text) {
  const s = String(text || '').trim();
  if (!s || s.length > 500) return null;
  const m = /(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)/.exec(s.replace(/%2C/gi, ','));
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  return validLoc(lat, lon) ? {lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6} : null;
}
export const placeText = loc => (loc && validLoc(loc.lat, loc.lon) ? `${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)}` : '');
// 화면 시각 글자(서울): '2026.11.03 14:05'.
export function takenText(ms) {
  if (!Number.isFinite(ms)) return '—';
  const p = seoulParts(new Date(ms));
  return `${p.year}.${pad(p.month + 1)}.${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}
// <input type="datetime-local"> 값(서울 벽시계) ↔ ms.
export function localValue(ms) {
  if (!Number.isFinite(ms)) return '';
  const p = seoulParts(new Date(ms));
  return `${p.year}-${pad(p.month + 1)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}
export function fromLocalValue(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(v || ''));
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5], +(m[6] || 0));
  return Number.isFinite(ms) ? ms : null;
}
export function shiftMs({sign = -1, hours = 0, minutes = 0} = {}) {
  const h = Math.trunc(Number(hours) || 0), m = Math.trunc(Number(minutes) || 0);
  if (h < 0 || m < 0 || h > 24 * 3660 || m > 59) return null;
  return (sign < 0 ? -1 : 1) * (h * HOUR + m * MINUTE);
}
const validTaken = ms => Number.isFinite(ms) && ms >= TAKEN_MIN && ms <= TAKEN_MAX;

// 정보(앱 읽기 답)와 사진(화면 항목)을 묶는다. info: Map(id → {taken, lat, lon, make, model, lens, can}).
export function infoRows(items, info) {
  return (items || []).slice(0, INFO_MAX).map(it => {
    const v = info?.get?.(String(it.phoneId));
    const loc = v && validLoc(v.lat, v.lon) ? {lat: v.lat, lon: v.lon} : null;
    const taken = Number.isFinite(v?.taken) ? v.taken : Date.parse(it.taken_at || '');
    return {id: String(it.phoneId), name: String(it.name || ''), taken: Number.isFinite(taken) ? taken : null, loc,
      can: !!v && v.can === true && !it.video, why: !v ? '폰에 없음' : it.video ? '동영상' : v.can !== true ? '이 종류는 못 고침' : '',
      make: v?.make || '', model: v?.model || '', lens: v?.lens || ''};
  });
}
// 카메라·렌즈 한 줄(보기만). 여러 가지면 '여러 가지'.
export function cameraLine(rows) {
  const one = list => { const s = [...new Set(list.filter(Boolean))]; return s.length === 0 ? '' : s.length === 1 ? s[0] : '여러 가지'; };
  const cam = one(rows.map(r => [r.make, r.model].filter(Boolean).join(' ').trim()));
  const lens = one(rows.map(r => r.lens));
  return [cam && `카메라 ${cam}`, lens && `렌즈 ${lens}`].filter(Boolean).join(' · ');
}
// 미리 보기: 방법을 적용한 뒤 값. how = {kind:'shift', ms} | {kind:'date', ms} | {kind:'place', loc} | {kind:'clear'}.
export function planRows(rows, how) {
  const ok = rows.filter(r => r.can && Number.isFinite(r.taken));
  const first = ok.length ? Math.min(...ok.map(r => r.taken)) : null;
  return rows.map(r => {
    const out = {...r, after: {taken: r.taken, loc: r.loc}, changed: false};
    if (!r.can) return out;
    if (how?.kind === 'shift' && Number.isFinite(how.ms) && how.ms !== 0 && Number.isFinite(r.taken)) out.after = {taken: r.taken + how.ms, loc: r.loc};
    else if (how?.kind === 'date' && Number.isFinite(how.ms) && Number.isFinite(r.taken) && first !== null) out.after = {taken: how.ms + (r.taken - first), loc: r.loc};
    else if (how?.kind === 'place' && how.loc && validLoc(how.loc.lat, how.loc.lon)) out.after = {taken: r.taken, loc: {lat: how.loc.lat, lon: how.loc.lon}};
    else if (how?.kind === 'clear') out.after = {taken: r.taken, loc: null};
    if (out.after.taken !== r.taken && !validTaken(out.after.taken)) { out.after = {taken: r.taken, loc: r.loc}; out.why = '시각이 범위를 벗어남'; return out; }
    out.changed = out.after.taken !== r.taken || !sameLoc(out.after.loc, r.loc);
    return out;
  });
}
const sameLoc = (a, b) => (!a && !b) || (!!a && !!b && Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lon - b.lon) < 1e-7);
// 앱에 보낼 고치기(바뀐 것만). 시각이 바뀌면 taken, 위치가 바뀌면 loc(지우기는 null).
export function writeItems(plan) {
  return plan.filter(r => r.changed).map(r => {
    const o = {id: r.id};
    if (r.after.taken !== r.taken) o.taken = r.after.taken;
    if (!sameLoc(r.after.loc, r.loc)) o.loc = r.after.loc ? {lat: r.after.loc.lat, lon: r.after.loc.lon} : null;
    return o;
  });
}
// 되돌리기: 기록(앞·뒤)에서 앞 값으로.
export function undoItems(records) {
  return (records || []).map(r => {
    const id = /^ms:(\d{1,18})$/.exec(r.item_key || '')?.[1];
    if (!id) return null;
    const o = {id};
    const before = Date.parse(r.before_taken || ''), after = Date.parse(r.after_taken || '');
    if (Number.isFinite(after) && Number.isFinite(before) && before !== after) o.taken = before;
    if (r.loc_changed) o.loc = validLoc(r.before_lat, r.before_lon) ? {lat: r.before_lat, lon: r.before_lon} : null;
    return 'taken' in o || 'loc' in o ? o : null;
  }).filter(Boolean);
}
// 서버 기록 행(고친 것만, 앱이 고쳤다고 한 것만).
export function recordRows(plan, {workspaceId, batchId, failed = []} = {}) {
  const bad = new Set(failed.map(String));
  return plan.filter(r => r.changed && !bad.has(r.id)).map(r => {
    const locChanged = !sameLoc(r.after.loc, r.loc);
    return {workspace_id: workspaceId, batch_id: batchId, source: 'phone', item_key: `ms:${r.id}`,
      before_taken: Number.isFinite(r.taken) ? new Date(r.taken).toISOString() : null,
      after_taken: r.after.taken !== r.taken ? new Date(r.after.taken).toISOString() : null,
      loc_changed: locChanged,
      before_lat: locChanged && r.loc ? r.loc.lat : null, before_lon: locChanged && r.loc ? r.loc.lon : null,
      after_lat: locChanged && r.after.loc ? r.after.loc.lat : null, after_lon: locChanged && r.after.loc ? r.after.loc.lon : null};
  });
}
// 앱 답 오류 → 화면 글.
const WRITE_ERRORS = {refused: '폰에서 허락하지 않았어요', none: '고칠 수 있는 사진이 없어요', old: '안드로이드 11 이상에서만 고칠 수 있어요', busy: '다른 고치기가 진행 중이에요',
  bad: '앱이 요청 모양을 받지 않았어요', failed: '고치지 못했어요'};
export const writeErrorText = e => WRITE_ERRORS[e] || WRITE_ERRORS.failed;
export function doneText({count = 0, failed = []} = {}, verb = '고쳤어요') {
  return failed.length ? `${count}장 ${verb} · ${failed.length}장은 못 고쳤어요` : `${count}장 ${verb}`;
}
