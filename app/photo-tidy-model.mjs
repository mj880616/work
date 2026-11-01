// S46-20 사진 정리 제안(요청함 10/31 11:04, 시안 확정 10/31 13:2x): 사진 메뉴 [정리] 칸의 순수 규칙(화면·네트워크 없음, 단위 시험 대상).
// - 재료: 폰 사진 전부(앱 다리 page, 끈 폴더 포함)와 원드라이브 사진 전부(서버 library). 모두 이 화면 메모리에만 둔다(기기·서버 저장 없음).
// - 같은 사진 판정은 섞어 보기의 '같은 사진이면 한 장' 규칙(photo-sources-model.mjs sameMedia·dupFinder)을 그대로 쓴다.
// - 제안은 보여 주기만 한다. 지우기·숨기기는 명진이 눌러야만(이 파일은 목록만 만든다).
import {dupFinder, sameMedia} from './photo-sources-model.mjs';

export const PLACES = Object.freeze(['all', 'phone', 'onedrive', 'both']);
export const PLACE_TEXT = Object.freeze({all:'전체', phone:'폰에만', onedrive:'원드라이브에만', both:'둘 다'});
export const validPlace = v => (PLACES.includes(v) ? v : 'all');
// 한 번에 읽는 장수 끝(이보다 많으면 거기까지만 보고 '일부만' 표시).
export const SCAN_MAX = 60000;
export const JUNK_DAYS = 365;
const DAY_MS = 86400000;

// 폰 칸 ↔ 원드라이브 칸 짝 찾기. 답: {phoneHas: Set(폰 칸 id — 원드라이브에 있음), odHas: Set(원드라이브 칸 id — 폰에 있음)}.
export function matchIndex(odItems, phItems) {
  const od = odItems || [], ph = phItems || [];
  const inOd = od.length ? dupFinder(od) : () => false;
  const inPh = ph.length ? dupFinder(ph) : () => false;
  const phoneHas = new Set(), odHas = new Set();
  for (const p of ph) if (inOd(p)) phoneHas.add(p.id);
  for (const o of od) if (inPh(o)) odHas.add(o.id);
  return {phoneHas, odHas};
}
// 끈 폰 폴더 바로 안 사진은 보기에서 뺀다(사진 메뉴 다른 보기와 같음).
const shown = (p, off) => !(off && p.folder && off.has(p.folder));
// 거르기: 폰에만 = 원드라이브에 짝 없는 폰 사진, 원드라이브에만 = 폰에 짝 없는 원드라이브 사진(폰에서 지웠지만 남은 것), 둘 다 = 짝 있는 것 한 장(원드라이브 것).
export function placeItems(place, {odItems = [], phItems = [], index, off = null} = {}) {
  const ix = index || matchIndex(odItems, phItems);
  switch (validPlace(place)) {
    case 'phone': return phItems.filter(p => !ix.phoneHas.has(p.id) && shown(p, off));
    case 'onedrive': return odItems.filter(o => !ix.odHas.has(o.id));
    case 'both': return odItems.filter(o => ix.odHas.has(o.id));
    default: return [...odItems, ...phItems.filter(p => !ix.phoneHas.has(p.id) && shown(p, off))];
  }
}
// 거르기 줄 장수.
export function placeCounts(ctx) {
  const ix = ctx.index || matchIndex(ctx.odItems, ctx.phItems);
  return Object.fromEntries(PLACES.map(p => [p, placeItems(p, {...ctx, index:ix}).length]));
}

// 폰 폴더 이름(맨 끝 칸).
export const folderLeaf = path => String(path || '').replace(/\/+$/, '').split('/').pop() || '폰';
// 백업 안 되는 폴더: 사진이 있는데 그중 한 장도 원드라이브에 없는 폰 폴더. [{id(경로), name, count, bytes}] 장수 많은 순.
export function unbackedFolders(phItems, index) {
  const by = new Map();
  for (const p of phItems || []) {
    if (!p.folder) continue;
    const f = by.get(p.folder) || by.set(p.folder, {id:p.folder, name:folderLeaf(p.folder), count:0, backed:0, bytes:0}).get(p.folder);
    f.count++; if (index?.phoneHas?.has(p.id)) f.backed++;
    if (Number.isFinite(p.size_bytes) && p.size_bytes > 0) f.bytes += p.size_bytes;
  }
  return [...by.values()].filter(f => f.count > 0 && f.backed === 0).map(({backed, ...f}) => f)
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

// 잡동사니: 1년 지난 스크린샷, 카톡·텔레그램으로 받은 사진(그 앱 폴더 안 사진).
const KAKAO_RE = /(^|\/)kakaotalk(\/|$)/i;
const TG_RE = /(^|\/)telegram( images| video| documents)?(\/|$)/i;
export const junkKind = path => (KAKAO_RE.test(path || '') ? 'kakao' : TG_RE.test(path || '') ? 'telegram' : '');
export const JUNK_TEXT = Object.freeze({shot:'1년 지난 스크린샷', kakao:'카톡 받은 사진', telegram:'텔레그램 받은 사진'});
// 답: [{kind, label, items, folders(그 무리 폰 폴더 경로들 — 숨기기 대상, 스크린샷은 빈 목록), bytes}] 비지 않은 무리만, 순서 고정.
export function junkGroups(phItems, now = Date.now()) {
  const cut = now - JUNK_DAYS * DAY_MS;
  const g = {shot:[], kakao:[], telegram:[]};
  for (const p of phItems || []) {
    const kind = junkKind(p.folder);
    if (kind) g[kind].push(p);
    else if (p.screenshot && Date.parse(p.taken_at) < cut) g.shot.push(p);
  }
  return Object.entries(g).filter(([, items]) => items.length).map(([kind, items]) => ({
    kind, label:JUNK_TEXT[kind], items,
    folders:kind === 'shot' ? [] : [...new Set(items.map(p => p.folder))].sort(),
    bytes:items.reduce((n, p) => n + (Number.isFinite(p.size_bytes) && p.size_bytes > 0 ? p.size_bytes : 0), 0),
  }));
}
// 무리의 폴더가 모두 꺼져 있나(숨김 상태).
export const groupHidden = (group, off) => group.folders.length > 0 && group.folders.every(f => off?.has(f));

// 크기 글('1.2GB'·'340MB'·'12KB').
export function sizeText(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(bytes >= 1e10 ? 0 : 1)}GB`;
  if (bytes >= 1e6) return `${bytes < 1e7 ? (bytes / 1e6).toFixed(1).replace(/\.0$/, '') : Math.round(bytes / 1e6)}MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))}KB`;
}
// ---- S47-19 정리 [보기] 그 줄 안 펼침(요청함 11/01 12:55·12:56): 합계 용량·정렬 ----
// 정렬 칩. 공간 비우기·잡동사니·백업 안 됨은 용량 큰 순, 어디에 있나(폰에만 등)는 찍은 날 최신이 기본. 같은 사진 묶음은 묶음 순서.
export const TIDY_SORTS = Object.freeze({size:'용량 큰 순', new:'찍은 날 최신', old:'찍은 날 오래된'});
export const DUP_SORTS = Object.freeze({save:'아낄 용량 큰 순', new:'찍은 날 최신', old:'찍은 날 오래된'});
export const paneSortDefault = key => (String(key || '').startsWith('place:') ? 'new' : 'size');
const takenMs = p => { const t = Date.parse(p?.taken_at); return Number.isFinite(t) ? t : NaN; };
const idCmp = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
// 찍은 시각 비교(시각 모르는 것은 늘 뒤).
const byTaken = (a, b, dir) => { const x = takenMs(a), y = takenMs(b); if (Number.isNaN(x) || Number.isNaN(y)) return Number.isNaN(x) - Number.isNaN(y); return dir * (x - y); };
export function sortTidy(list, sort) {
  const out = (list || []).slice();
  if (sort === 'old') return out.sort((a, b) => byTaken(a, b, 1) || idCmp(a, b));
  if (sort === 'size') return out.sort((a, b) => bytesOfItem(b) - bytesOfItem(a) || byTaken(a, b, -1) || idCmp(a, b));
  return out.sort((a, b) => byTaken(a, b, -1) || idCmp(a, b));
}
// 묶음 정렬: 아낄 용량 큰 순(dupGroups 순서) · 찍은 날(묶음 첫 장).
export function sortDupGroups(groups, sort) {
  const out = (groups || []).slice();
  if (sort === 'new') return out.sort((a, b) => byTaken(a.items[0], b.items[0], -1) || idCmp(a, b));
  if (sort === 'old') return out.sort((a, b) => byTaken(a.items[0], b.items[0], 1) || idCmp(a, b));
  return out.sort((a, b) => b.bytes - a.bytes || byTaken(a.items[0], b.items[0], -1) || idCmp(a, b));
}
export const totalBytes = list => (list || []).reduce((n, p) => n + bytesOfItem(p), 0);
const bytesOfItem = p => (Number.isFinite(p?.size_bytes) && p.size_bytes > 0 ? p.size_bytes : 0);

// [정리 n]의 n: 할 거리가 있는 제안 줄 수(백업 안 됨 폴더·잡동사니 무리 중 숨기지 않은 것).
export function tidyCount({unbacked = [], junk = []} = {}, off = null) {
  return (unbacked.length ? 1 : 0) + (junk.some(g => !groupHidden(g, off)) ? 1 : 0);
}
// 지운 칸을 재료에서 뺀다(폰 휴지통·원드라이브 휴지통 뒤).
export function forgetIds(list, ids) {
  const gone = new Set(ids || []);
  return gone.size ? (list || []).filter(x => !gone.has(x.id)) : (list || []).slice();
}
// 화면 거르기(전체·★·동영상·스크린샷)를 정리 목록에도.
export function typeFilter(list, filter, isStarred = () => false) {
  if (filter === 'video') return list.filter(x => x.video);
  if (filter === 'shot') return list.filter(x => x.screenshot);
  if (filter === 'star') return list.filter(isStarred);
  return list.slice();
}

// ---- S46-20 ②: ③ 폰 공간 비우기 · ④ 같은 사진·비슷한 사진 묶음 ----
// ③ 후보: 원드라이브에 같은 사진이 확인된 폰 사진 중 1년 지난 것, 또는 한 달 지난 큰 동영상(50MB 이상). 별표 사진은 뺀다.
export const SPACE_DAYS = 365, SPACE_VIDEO_DAYS = 30, SPACE_VIDEO_BYTES = 50e6;
const bytesOf = p => (Number.isFinite(p.size_bytes) && p.size_bytes > 0 ? p.size_bytes : 0);
export function spacePlan(phItems, index, {now = Date.now(), isStarred = () => false} = {}) {
  const old = now - SPACE_DAYS * DAY_MS, vOld = now - SPACE_VIDEO_DAYS * DAY_MS;
  const items = [];
  let photos = 0, videos = 0;
  for (const p of phItems || []) {
    if (!index?.phoneHas?.has(p.id) || isStarred(p)) continue;
    const t = Date.parse(p.taken_at);
    if (!Number.isFinite(t)) continue;
    const bigVideo = p.video && bytesOf(p) >= SPACE_VIDEO_BYTES && t < vOld;
    if (t < old || bigVideo) { items.push(p); if (p.video) videos++; else photos++; }
  }
  return {items, photos, videos, bytes:items.reduce((n, p) => n + bytesOf(p), 0)};
}
// 재료를 읽은 지 오래됐으면(10분) 지우기 전에 다시 확인한다(원드라이브에 정말 있는지).
export const FRESH_MS = 10 * 60 * 1000;
export const scanFresh = (at, now = Date.now()) => Number.isFinite(at) && now - at < FRESH_MS;

// ④ 묶음(S47-19B 요청함 11/01 12:54·12:55에서 좁힘): 두 종류를 섞지 않는다.
// - 'copy' 같은 사진 여러 번 저장: 같은 크기·같은 가로세로(가로세로를 알 때만, 50KB 이상)·같은 종류(사진/동영상).
// - 'burst' 연사: 카메라 폴더(DCIM/… — 받은 사진·스크린샷 폴더 제외)에서 찍은 시각이 정확한(approx 아님) 사진만, 묶음 첫 장과 1초 안,
//   한 묶음 최대 BURST_MAX장. 예전처럼 줄줄이 엮지 않는다(받은 사진처럼 저장 시각이 붙은 것들이 큰 묶음이 되던 것).
//   같은 사진 묶음에 든 사진은 연사로 다시 묶지 않는다.
// 종류마다 아낄 용량 큰 순 GROUP_MAX묶음까지.
export const BURST_MS = 1000, BURST_MAX = 20, COPY_MIN_BYTES = 50e3, GROUP_MAX = 500;
const RECEIVED_RE = /(^|\/)(kakaotalk|telegram[^/]*|whatsapp[^/]*|line|download|downloads|screenshots?|screen ?recordings?)(\/|$)/i;
export const cameraFolder = f => /^DCIM\//i.test(f || '') && !RECEIVED_RE.test(f || '');
const groupOf = (items, kind) => {
  items.sort((a, b) => String(a.taken_at).localeCompare(String(b.taken_at)) || a.id.localeCompare(b.id));
  const keep = defaultKeep(items, kind);
  return {id:items[0].id, kind, items, keep, bytes:items.filter(p => p.id !== keep).reduce((n, p) => n + bytesOf(p), 0)};
};
const bigFirst = (a, b) => b.bytes - a.bytes || String(b.items[0].taken_at).localeCompare(String(a.items[0].taken_at));
export function dupGroups(phItems) {
  const list = (phItems || []).filter(p => p && p.id);
  // 같은 사진 여러 번 저장
  const bySize = new Map();
  for (const p of list) if (bytesOf(p) >= COPY_MIN_BYTES && p.width > 0 && p.height > 0) { const k = `${p.video ? 'v' : 'p'}:${p.size_bytes}:${p.width}x${p.height}`; (bySize.get(k) || bySize.set(k, []).get(k)).push(p); }
  const copies = [], inCopy = new Set();
  for (const same of bySize.values()) if (same.length > 1) { copies.push(groupOf(same.slice(), 'copy')); for (const p of same) inCopy.add(p.id); }
  // 연사
  const byFolder = new Map(), at = p => Date.parse(p.taken_at);
  for (const p of list) {
    if (p.video || p.screenshot || p.approx === true || inCopy.has(p.id) || !cameraFolder(p.folder) || !Number.isFinite(at(p))) continue;
    (byFolder.get(p.folder) || byFolder.set(p.folder, []).get(p.folder)).push(p);
  }
  const bursts = [];
  for (const f of byFolder.values()) {
    f.sort((a, b) => at(a) - at(b) || a.id.localeCompare(b.id));
    for (let i = 0; i < f.length;) {
      let j = i + 1;
      while (j < f.length && j - i < BURST_MAX && at(f[j]) - at(f[i]) <= BURST_MS) j++;
      if (j - i > 1) bursts.push(groupOf(f.slice(i, j), 'burst'));
      i = j;
    }
  }
  return [...copies.sort(bigFirst).slice(0, GROUP_MAX), ...bursts.sort(bigFirst).slice(0, GROUP_MAX)].sort(bigFirst);
}
// 묶음 숫자(뜻이 보이게): 묶음 n개 · 지울 수 있는 사진 m장(남길 것 말고) · 아낄 용량.
export function dupStats(groups) {
  const list = groups || [];
  return {groups:list.length, extra:list.reduce((n, g) => n + g.items.length - 1, 0), bytes:list.reduce((n, g) => n + g.bytes, 0)};
}
export const dupStatText = ({groups, extra, bytes}) => `묶음 ${groups}개 · 지울 수 있는 사진 ${extra}장${bytes ? ` · 아낄 용량 ${sizeText(bytes)}` : ''}`;
// 사진이 있는 곳 한 줄씩: "폰 · DCIM/Camera", "원드라이브 · 사진/2024"(경로 모르면 '폴더 모름'). odCopies = 같은 사진인 원드라이브 칸들, odPath = 원드라이브 칸 → 폴더 경로(모르면 '').
export const phonePath = f => String(f || '').replace(/\/+$/, '') || '폴더 모름';
export function whereLines(item, odCopies = [], odPath = () => '') {
  const out = [];
  if (item?.kind === 'phone') out.push(`폰 · ${phonePath(item.folder)}`);
  else if (item) out.push(`원드라이브 · ${odPath(item) || '폴더 모름'}`);
  for (const o of odCopies || []) if (o && o.id !== item?.id) out.push(`원드라이브 · ${odPath(o) || '폴더 모름'}`);
  return out;
}
// 같은 사진인 원드라이브 칸 모두(섞어 보기 같은 사진 규칙 sameMedia, 크기를 알 때만).
export function copiesFinder(odItems) {
  const bySize = new Map();
  for (const o of odItems || []) if (o && bytesOf(o) > 0 && o.id) (bySize.get(o.size_bytes) || bySize.set(o.size_bytes, []).get(o.size_bytes)).push(o);
  return p => (p && bytesOf(p) > 0 ? (bySize.get(p.size_bytes) || []).filter(o => sameMedia(p, o)) : []);
}
// 남길 것 기본값: 같은 사진은 카메라 폴더(DCIM) 것 → 가장 먼저 저장된 것, 연사는 가장 큰 파일(같으면 첫 장).
export function defaultKeep(items, kind) {
  if (kind === 'copy') return (items.find(p => /^DCIM\//.test(p.folder || '')) || items[0]).id;
  return items.reduce((best, p) => (bytesOf(p) > bytesOf(best) ? p : best), items[0]).id;
}
// 지울 것(남길 것 말고 전부). keeps = Map(묶음 id → 남길 칸 id), 명진이 고른 것이 기본값보다 앞선다.
export function dupTrashList(groups, keeps = new Map()) {
  const out = [];
  for (const g of groups || []) { const keep = g.items.some(p => p.id === keeps.get(g.id)) ? keeps.get(g.id) : g.keep; out.push(...g.items.filter(p => p.id !== keep)); }
  return out;
}
export const DUP_TEXT = Object.freeze({copy:'같은 사진', burst:'연사'});
// 묶는 기준 한 줄(명진 12:54 '어떤 원리로 같은 사진을 추리는지').
export const DUP_HOW = Object.freeze({copy:'파일 크기·가로세로가 똑같은 사진', burst:'카메라로 1초 안에 이어 찍은 사진'});

// ---- S47-16 PHOTO-폰지우기안전장치(요청함 10/31 22:52): [폰에서만 지우기]·[나머지 지우기] 전 원드라이브 사본 짝 ----
// 폰 사진마다 원드라이브에서 같은 크기(그리고 같은 이름 또는 찍은 시각)인 사본을 찾는다. 크기를 모르면 짝이 없다(지우지 않음).
// 지우기 전 서버(onedrive-photos copy-check)가 이 사본이 지금도 있고 크기가 같은지 다시 본다. 여기서는 짝만 만든다.
export const COPY_BATCH = 50, LOG_BATCH = 100;
export function copyFinder(odItems) {
  const bySize = new Map();
  for (const o of odItems || []) if (o && bytesOf(o) > 0 && o.id) (bySize.get(o.size_bytes) || bySize.set(o.size_bytes, []).get(o.size_bytes)).push(o);
  return p => (p && bytesOf(p) > 0 ? (bySize.get(p.size_bytes) || []).find(o => sameMedia(p, o)) || null : null);
}
// 답: {pairs:[{item(폰 칸), copy(원드라이브 칸)}], noCopy:[폰 칸]}.
export function copyPairs(items, odItems) {
  const find = copyFinder(odItems), pairs = [], noCopy = [];
  for (const p of items || []) { const o = p?.phoneId ? find(p) : null; if (o) pairs.push({item:p, copy:o}); else noCopy.push(p); }
  return {pairs, noCopy};
}
// 남긴 사진 안내(사본 없음·확인 못 함).
export function keptText(missing, unsure) {
  const out = [];
  if (missing > 0) out.push(`원드라이브에 없음 ${missing}장은 남겼어요`);
  if (unsure > 0) out.push(`원드라이브 확인 못 한 ${unsure}장은 남겼어요`);
  return out.join(' · ');
}
// 다음 사진 확인 때 사본이 사라진 경우의 경고 한 줄.
export const goneText = n => `폰에서 지운 ${n}장이 원드라이브에서도 지워졌어요. 원드라이브 휴지통(30일)에서 되살리세요. 동기화 앱이 양방향이면 업로드만으로 바꾸세요`;
export const SAFE_SYNC_TEXT = '원드라이브 동기화 앱이 업로드만일 때 안전해요';
