// S46-20 사진 정리 제안(요청함 10/31 11:04, 시안 확정 10/31 13:2x): 사진 메뉴 [정리] 칸의 순수 규칙(화면·네트워크 없음, 단위 시험 대상).
// - 재료: 폰 사진 전부(앱 다리 page, 끈 폴더 포함)와 원드라이브 사진 전부(서버 library). 모두 이 화면 메모리에만 둔다(기기·서버 저장 없음).
// - 같은 사진 판정은 섞어 보기의 '같은 사진이면 한 장' 규칙(photo-sources-model.mjs sameMedia·dupFinder)을 그대로 쓴다.
// - 제안은 보여 주기만 한다. 지우기·숨기기는 명진이 눌러야만(이 파일은 목록만 만든다).
import {dupFinder} from './photo-sources-model.mjs';

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
