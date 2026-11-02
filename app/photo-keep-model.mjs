// S48-17 PHOTO-지우기두갈래(요청함 11/01 00:27, 시안 확정): '폰 공간만 비우기'로 비운 사진을 폰 사진 보기에 남기는 규칙.
// - 서버(Edge onedrive-photos kept-list)가 비운 사진 기록(원래 폰 폴더·찍은 시각·원드라이브 사본 칸)을 준다. 이 파일은 그것을 화면 칸으로 바꾸고,
//   폰 사진 목록(쪽으로 받음)에 원래 날짜 자리로 섞는다. 칸은 원드라이브 사진이고(작은 그림·크게 보기 = 원드라이브), kept 표시만 더한다.
// - 지우기 두 갈래 계획: 고른 사진 → 폰 공간만 비우기(원드라이브에 원본이 확인된 폰 사진만) / 완전히 지우기(폰 + 원드라이브, 짝 사본까지).
import {toItem} from './photos-model.mjs';
import {copyFinder} from './photo-tidy-model.mjs';

const pad = n => String(n).padStart(2, '0');
// 이 기기 시간대의 날(폰 사진 칸의 day와 같은 기준).
const localDay = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
// 폰 폴더 경로는 끝 '/'를 붙여 비교한다(MediaStore relative_path는 'DCIM/Camera/' 모양).
export const folderKey = v => { const s = String(v || '').trim(); return !s ? '' : s.endsWith('/') ? s : s + '/'; };

// 서버 한 줄 {logId, phoneId, relPath, takenAt, photo} → 칸. 찍은 시각은 폰에서 쓰던 것(있으면)으로 원래 날짜 자리에.
export function keptItem(row) {
  if (!row?.photo || typeof row.photo.id !== 'string') return null;
  const base = toItem(row.photo), t = Date.parse(row.takenAt || '');
  const when = Number.isFinite(t) && t > 0 ? {taken_at:new Date(t).toISOString(), day:localDay(t)} : {};
  return {...base, ...when, kept:true, keptId:String(row.logId || ''), keptPath:row.relPath ? folderKey(row.relPath) : null, keptPhone:String(row.phoneId || '')};
}
export const keptItems = rows => (Array.isArray(rows) ? rows : []).map(keptItem).filter(Boolean);

// 거르기(별표·동영상·스크린샷)·건너뛴 시작(before ms보다 앞에 찍은 것만).
export function keptFilter(list, {filter = 'all', isStarred = () => false, before = null} = {}) {
  return (list || []).filter(x => (filter === 'video' ? x.video : filter === 'shot' ? x.screenshot : filter === 'star' ? isStarred(x) : true)
    && (!Number.isFinite(before) || Date.parse(x.taken_at) < before));
}
export const keptInFolder = (list, folder) => { const k = folderKey(folder); return k ? (list || []).filter(x => x.keptPath === k) : []; };

// 쪽으로 받는 폰 목록(phone, 정렬 순서) + 다 받은 비운 사진(kept): 폰 목록이 다 오지 않았으면 마지막 폰 칸보다 앞(정렬상)인 것만 섞는다.
export function keptMerge(phoneList, kept, ended, cmp) {
  const own = (phoneList || []).filter(x => !x.kept);
  if (!kept?.length) return own;
  const last = own[own.length - 1];
  const take = ended ? kept : last ? kept.filter(k => cmp(k, last) <= 0) : [];
  return [...own, ...take].sort(cmp);
}

// S48-32: 고른 원드라이브 칸(비운 사진 아님)의 폰 원본 짝. 사진 정리 짝 판정(copyFinder: 같은 크기 + 같은 사진)을 거꾸로 —
// 폰 사진(phItems, 사진 정리가 읽은 전부)마다 고른 원드라이브 칸에서 사본을 찾는다. 원드라이브 칸 하나에 폰 짝 하나(먼저 찾은 것).
// 답: [{item(폰 칸), copy(원드라이브 칸)}]. 폰 사진 목록을 못 읽었으면 null(부르는 쪽이 지우지 않음).
export function twinPairs(phItems, odPicked) {
  if (!Array.isArray(phItems)) return null;
  const od = (odPicked || []).filter(x => x && x.kind !== 'phone' && x.kind !== 'gdrive' && !x.kept);
  if (!od.length) return [];
  const find = copyFinder(od), seen = new Set(), out = [];
  for (const p of phItems) {
    const o = p?.phoneId ? find(p) : null;
    if (o && !seen.has(o.id)) { seen.add(o.id); out.push({item:p, copy:o}); }
  }
  return out;
}
// 지우기 두 갈래 계획. picked = 고른 칸, pairs = 폰 사진의 원드라이브 사본 짝({pairs:[{item, copy}], noCopy}, 원드라이브를 못 읽었으면 null),
// twins = 고른 원드라이브 칸의 폰 원본 짝(twinPairs, 없으면 null·[]).
// space = 폰 공간만 비우기 후보(원본이 있는 폰 사진 + 고른 원드라이브 칸의 폰 짝, 서버가 한 번 더 확인), noCopy = 그 밖의 고른 폰 사진 수,
// full = 완전히 지우기 장수(고른 것 모두 — 짝은 같은 사진이라 따로 세지 않음), phone·od·gd = 완전히 지우기의 나눔(phone에 폰 짝 포함),
// copies = 폰 사진 짝 사본 id(원드라이브도 지움, 고른 원드라이브 칸 제외).
export function deletePlan(picked, pairs, twins = null) {
  const all = picked || [];
  const own = all.filter(x => x.kind === 'phone'), gd = all.filter(x => x.kind === 'gdrive'), od = all.filter(x => x.kind !== 'phone' && x.kind !== 'gdrive');
  const ownSpace = (pairs?.pairs || []).filter(p => own.some(x => x.id === p.item.id)).map(p => ({item:p.item, copyId:p.copy.id}));
  const twin = (twins || []).filter(p => od.some(x => x.id === p.copy.id) && !own.some(x => x.id === p.item.id)).map(p => ({item:p.item, copyId:p.copy.id}));
  const space = [...ownSpace, ...twin];
  const copies = [...new Set(ownSpace.map(p => p.copyId).filter(id => !od.some(x => x.id === id)))];
  const phone = [...own, ...twin.map(p => p.item)];
  // twinOf: 원드라이브 칸 id → 폰 짝 칸 id(완전히 지우기에서 폰 짝을 못 지웠으면 그 원드라이브 칸도 남긴다).
  return {space, noCopy:own.length - ownSpace.length, full:all.length, phone, od, gd, copies, twins:twin.length, twinOf:new Map(twin.map(p => [p.copyId, p.item.id])),
    twoWay:own.length > 0 || twin.length > 0 || od.some(x => x.kept)};
}
// 고르기 창 글(시안 확정 00:27).
export function deleteChoices(plan) {
  return {
    space:{label:`폰 공간만 비우기 · ${plan.space.length}장`, note:'원드라이브에 원본이 있는 사진만. 목록에 남고, 나중에 [폰으로 되돌리기]로 제자리에'},
    full:{label:`완전히 지우기 · ${plan.full}장`, note:'폰과 원드라이브 둘 다 휴지통으로(30일 안엔 되살리기). 목록에서 사라짐'},
    foot:plan.noCopy > 0 ? `원드라이브에 원본이 없는 ${plan.noCopy}장은 공간만 비우기에서 빠져요` : '',
  };
}
// 비운 기록으로 남길 줄(서버 trash-log). 원래 폴더·찍은 시각만, 이름·크기·내용은 넣지 않는다.
export const keepLogRows = (list, copyOf, {keep = true} = {}) => (list || []).filter(x => x.phoneId && copyOf.has(x.id)).map(x => ({
  phone_id:String(x.phoneId), copy_id:copyOf.get(x.id), keep,
  ...(keep && x.folder ? {rel_path:folderKey(x.folder)} : {}), ...(keep && Number.isFinite(Date.parse(x.taken_at || '')) ? {taken_at:x.taken_at} : {}),
}));
// 원드라이브 칸 id들에 걸린 비운 기록 id(완전히 지우기·바로 지우기 뒤 기록도 지운다).
export const keptIdsFor = (kept, odIds) => { const s = new Set(odIds || []); return (kept || []).filter(k => s.has(k.id) && k.keptId).map(k => k.keptId); };
