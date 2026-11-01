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
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)}MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))}KB`;
}
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

// ④ 묶음: 같은 사진 여러 번 저장(같은 크기·같은 가로세로 — 가로세로를 알 때만, 50KB 이상) = 'copy', 연사(같은 폴더에서 1초 안에 이어 찍은 사진, 동영상·스크린샷 제외) = 'burst'.
export const BURST_MS = 1000, COPY_MIN_BYTES = 50e3, GROUP_MAX = 500;
export function dupGroups(phItems) {
  const list = (phItems || []).filter(p => p && p.id);
  const parent = new Map(list.map(p => [p.id, p.id]));
  const find = id => { let r = id; while (parent.get(r) !== r) r = parent.get(r); for (let x = id; parent.get(x) !== r;) { const n = parent.get(x); parent.set(x, r); x = n; } return r; };
  const kinds = new Map();
  const join = (a, b, kind) => { const ra = find(a.id), rb = find(b.id); if (ra !== rb) parent.set(rb, ra); kinds.set(find(a.id), kinds.get(ra) === 'copy' || kinds.get(rb) === 'copy' || kind === 'copy' ? 'copy' : 'burst'); };
  // 같은 사진 여러 번 저장
  const bySize = new Map();
  for (const p of list) if (bytesOf(p) >= COPY_MIN_BYTES && p.width > 0 && p.height > 0) { const k = `${p.video ? 'v' : 'p'}:${p.size_bytes}:${p.width ?? ''}x${p.height ?? ''}`; (bySize.get(k) || bySize.set(k, []).get(k)).push(p); }
  for (const same of bySize.values()) for (let i = 1; i < same.length; i++) join(same[0], same[i], 'copy');
  // 연사
  const byFolder = new Map();
  for (const p of list) if (!p.video && !p.screenshot && p.folder && Number.isFinite(Date.parse(p.taken_at))) (byFolder.get(p.folder) || byFolder.set(p.folder, []).get(p.folder)).push(p);
  for (const f of byFolder.values()) {
    f.sort((a, b) => Date.parse(a.taken_at) - Date.parse(b.taken_at) || a.id.localeCompare(b.id));
    for (let i = 1; i < f.length; i++) if (Date.parse(f[i].taken_at) - Date.parse(f[i - 1].taken_at) <= BURST_MS) join(f[i - 1], f[i], 'burst');
  }
  const groups = new Map();
  for (const p of list) { const r = find(p.id); (groups.get(r) || groups.set(r, []).get(r)).push(p); }
  const out = [];
  for (const [r, items] of groups) {
    if (items.length < 2) continue;
    items.sort((a, b) => String(a.taken_at).localeCompare(String(b.taken_at)) || a.id.localeCompare(b.id));
    const kind = kinds.get(find(r)) || 'burst';
    out.push({id:r, kind, items, keep:defaultKeep(items, kind), bytes:0});
  }
  for (const g of out) g.bytes = g.items.filter(p => p.id !== g.keep).reduce((n, p) => n + bytesOf(p), 0);
  return out.sort((a, b) => b.bytes - a.bytes || String(b.items[0].taken_at).localeCompare(String(a.items[0].taken_at))).slice(0, GROUP_MAX);
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
