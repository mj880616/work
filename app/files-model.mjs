// FILES-클라우드탐색기 ④ 화면 모델(설계 docs/design/files-explorer.md, 명진 결정 F1~F9 11/02). DOM·네트워크 없음.
// 화면(files.js)은 여기서 계산한 값으로 그리기만 한다. 색인 줄 모양은 DB 읽기 함수 app_cloud_list·app_cloud_find와 Edge cloud-files sync 응답.

import {phoneErrorText} from './phone-files-model.mjs';

export const SOURCES = Object.freeze(['od', 'gd']);
// 'ph' = 이 폰 저장 공간(S49-51 FILES-통합 3단계, 폰 앱에서만). 클라우드 목록(SOURCES)에는 넣지 않는다 — 서버 색인·맞추기·쓰기는 클라우드 둘만.
export const SOURCE_NAME = Object.freeze({od: '원드라이브', gd: '구글 드라이브', ph: '이 폰'});
// 묶음(나무 맨 위): 최근(F9 폰 첫 화면) · 별표 · 큰 파일. 서버 app_cloud_find의 p_shelf와 같은 이름.
export const SHELVES = Object.freeze(['recent', 'starred', 'big']);
export const SHELF_NAME = Object.freeze({recent: '최근', starred: '별표', big: '큰 파일'});
// 폰 탭(좌우 밀기 순서). 첫 화면은 최근(F9).
export const PHONE_TABS = Object.freeze(['recent', 'folders', 'starred']);
export const PHONE_TAB_NAME = Object.freeze({recent: '최근', folders: '폴더', starred: '별표'});
// F2: 화면이 열려 있는 동안 2분마다 바뀐 것만(서버도 2분 안이면 클라우드를 부르지 않는다).
export const SYNC_EVERY_MS = 2 * 60 * 1000;
export const SHELF_LIMIT = 200;
export const FIND_LIMIT = 200;
export const FIND_WAIT_MS = 200;
export const QUERY_MAX = 200;
// F8: 클라우드 사이 옮기기는 한 번에 1개, 200MB까지. 같은 클라우드 안은 한 번에 200개까지(설계 3절 쓰기 규칙).
export const MOVE_ACROSS_MAX_BYTES = 200 * 1024 * 1024;
export const MOVE_SAME_MAX = 200;
// 미리보기: 글은 앞 200KB만, PDF는 앞 쪽부터 조금씩 그린다.
export const TEXT_PREVIEW_BYTES = 200 * 1024;
export const PDF_FIRST_PAGES = 3;

// Edge cloud-files의 미리보기 PDF 바꾸기 대상과 같은 규칙(supabase/functions/cloud-files/handler.ts OD_PDF_EXT·GD_EXPORT_MIME).
export const OD_PDF_EXT = /\.(docx?|dotx?|dotm|pptx?|ppsx?|xlsx?|xlsm|odt|odp|ods|rtf)$/i;
export const GD_EXPORT_MIME = /^application\/vnd\.google-apps\.(document|spreadsheet|presentation|drawing)$/;

const ext = name => { const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; };
const KIND_BY_EXT = {
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', heic: 'image', heif: 'image', bmp: 'image',
  mp4: 'video', mov: 'video', m4v: 'video', webm: 'video', avi: 'video', mkv: 'video',
  mp3: 'audio', m4a: 'audio', wav: 'audio', aac: 'audio', ogg: 'audio', flac: 'audio', amr: 'audio',
  pdf: 'pdf', hwp: 'hwp', hwpx: 'hwp',
  doc: 'word', docx: 'word', dot: 'word', dotx: 'word', dotm: 'word', odt: 'word', rtf: 'word',
  xls: 'excel', xlsx: 'excel', xlsm: 'excel', ods: 'excel', csv: 'excel',
  ppt: 'slide', pptx: 'slide', pps: 'slide', ppsx: 'slide', odp: 'slide',
  txt: 'text', md: 'text', log: 'text', json: 'text', xml: 'text',
  html: 'web', htm: 'web',
  zip: 'zip', '7z': 'zip', rar: 'zip', gz: 'zip', alz: 'zip', egg: 'zip',
};
export const KIND = Object.freeze({
  folder: {label: '폴더', icon: '📁'}, image: {label: '사진', icon: '▣'}, video: {label: '동영상', icon: '▶'},
  audio: {label: '소리', icon: '♪'}, pdf: {label: 'PDF', icon: 'P'}, hwp: {label: '한글', icon: '한'},
  word: {label: '워드', icon: 'W'}, excel: {label: '표', icon: '표'}, slide: {label: '발표', icon: '슬'},
  text: {label: '글', icon: '글'}, web: {label: '웹', icon: '<>'}, zip: {label: '압축', icon: '압'},
  gdoc: {label: '구글 문서', icon: 'G'}, file: {label: '파일', icon: '📄'},
});
// 종류: 폴더 → 구글 문서류(mime) → 확장자 → mime 앞부분 → 파일.
export function kindOf(row) {
  if (!row) return 'file';
  if (row.is_folder) return 'folder';
  const mime = String(row.mime || '').toLowerCase();
  if (mime.startsWith('application/vnd.google-apps.')) return 'gdoc';
  const byExt = KIND_BY_EXT[ext(row.name)];
  if (byExt) return byExt;
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('text/')) return 'text';
  return 'file';
}
export const kindLabel = row => KIND[kindOf(row)].label;
export const kindIcon = row => KIND[kindOf(row)].icon;

// 오른쪽 칸(폰은 전체 화면) 미리보기 길. image = 큰 썸네일, pdf = 원본을 pdf.js로, office = 서버가 PDF로 바꾼 것(F4),
// text = 앞 200KB 글, none = 이름·크기·위치만 + [열기]. 구글에 올린 오피스 파일은 서버가 바꾸지 않으므로 [열기]만(설계 Q4).
export function previewKind(row) {
  if (!row || row.is_folder) return 'none';
  const kind = kindOf(row), src = row.source;
  if (kind === 'image') return 'image';
  if (kind === 'pdf') return 'pdf';
  if (src === 'od' && OD_PDF_EXT.test(String(row.name || ''))) return 'office';
  if (src === 'gd' && GD_EXPORT_MIME.test(String(row.mime || ''))) return 'office';
  if (kind === 'text') return 'text';
  return 'none';
}

export function sizeText(bytes) {
  const n = Number(bytes);
  if (bytes === null || bytes === undefined || !Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n}B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 10 || i === 0 ? Math.round(v) : Math.round(v * 10) / 10}${units[i]}`;
}
// 원드라이브 개인 중요 보관소처럼 폴더도 파일도 아닌 잠긴 항목이 옛 색인에 '종류 없는 0B 파일'로 남아 있다. 서버는 이제 넣지 않고(Edge odRow),
// 화면은 옛 줄도 목록에서 뺀다(열어서 읽지 않음). 진짜 파일은 원드라이브가 늘 종류(mime)를 준다.
export const isLockedItem = r => !!r && r.source === 'od' && !r.is_folder && !r.mime && Number(r.size_bytes) === 0;
// 폴더 줄 개수: 그 폴더를 실제로 읽어 센 값(counts)이 있을 때만 글을 준다. 모르면 빈 글(색인 장수는 아직 안 읽은 폴더에서 0으로 나와 틀린다).
export function folderCountText(c) {
  if (!c || !Number.isFinite(c.files) || !Number.isFinite(c.folders)) return '';
  return c.folders > 0 ? (c.files > 0 ? `폴더 ${countText(c.folders)} · 파일 ${countText(c.files)}` : `폴더 ${countText(c.folders)}`) : `${countText(c.files)}개`;
}
export const countText = n => Number.isFinite(Number(n)) ? Number(n).toLocaleString('ko-KR') : '';

const pad = n => String(n).padStart(2, '0');
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// 바뀐 날: 오늘 09:12 / 어제 / 10/30 / 2025-10-30(다른 해).
export function dayText(iso, now = Date.now()) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms), today = new Date(now), y = new Date(now - 86400000);
  if (dayKey(d) === dayKey(today)) return `오늘 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (dayKey(d) === dayKey(y)) return '어제';
  if (d.getFullYear() === today.getFullYear()) return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
  return dayKey(d);
}
export function fullTime(iso) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  return `${dayKey(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
// 최근 묶음(폰 첫 화면): 바뀐 날짜별 머리 '오늘'·'어제'·'10/30'.
export function recentGroups(rows, now = Date.now()) {
  const out = [];
  for (const row of rows || []) {
    const ms = Date.parse(row.modified_at || '');
    const label = Number.isFinite(ms) ? dayText(row.modified_at, now).replace(/^오늘 .*/, '오늘') : '날짜 없음';
    const last = out[out.length - 1];
    if (last && last.label === label) last.rows.push(row); else out.push({label, rows: [row]});
  }
  return out;
}
// 맞춘 때 한 줄(머리 오른쪽 작게).
export function syncText(syncedAt, now = Date.now()) {
  const ms = typeof syncedAt === 'number' ? syncedAt : Date.parse(syncedAt || '');
  if (!Number.isFinite(ms)) return '';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return '방금 맞춤';
  if (s < 3600) return `${Math.floor(s / 60)}분 전 맞춤`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전 맞춤`;
  return `${Math.floor(s / 86400)}일 전 맞춤`;
}

// S50-14: 맞추기 단추 글자. 처음 목록 받기가 아직 안 끝났거나(scanning) 실패했으면 '방금 맞춤'을 띄우지 않는다
//   (예전에는 실패해도 '방금 맞춤'이 떠서 목록이 덜 찬 것을 알 수 없었다). 글줄 안 진행 표시는 '…' 한 글자(UI-로딩맨위).
export function syncLabel(status, syncedAt, now = Date.now(), sources = ['od', 'gd']) {
  const on = sources.map(s => status?.[s]).filter(x => x?.connected);
  if (on.some(x => x.error)) return {text: '맞추기 안 됨', title: '목록을 다 받지 못했어요. 누르면 다시 맞춥니다', state: 'error'};
  // S50-20: 처음 받는 중이면 받은 개수도(서버 status의 received, 내 파일만). 세지 못한 출처만 있으면 개수 없이.
  const scan = on.filter(x => x.scanning);
  if (scan.length) {
    const got = scan.map(x => x.received).filter(n => Number.isFinite(n) && n >= 0);
    const n = got.length ? got.reduce((a, b) => a + b, 0) : null;
    return {text: n === null ? '맞추기…' : `맞추기… ${countText(n)}개`, title: '처음 목록을 아직 다 받지 못했어요 — 끝날 때까지 일부 파일이 안 보일 수 있어요', state: 'scanning'};
  }
  return {text: syncText(syncedAt, now) || '맞추기', title: '지금 맞추기', state: 'ok'};
}
// sync 응답(출처마다 fresh·busy·more·done·error)을 화면이 들고 있는 상태(status 응답 모양)에 입힌다. 바꾼 새 객체를 돌려준다.
export function applySyncReply(status, reply, sources = ['od', 'gd']) {
  const out = {...(status || {})};
  for (const s of sources) {
    const r = reply?.[s], cur = out[s];
    if (!r || !cur) continue;
    if (r.error) out[s] = {...cur, error: String(r.error)};
    else if (r.more) out[s] = {...cur, scanning: true, error: null, ...(Number.isFinite(r.received) ? {received: r.received} : {})};
    else if (r.done || r.fresh) out[s] = {...cur, scanning: false, error: null, received: null};
  }
  return out;
}
// 모두 끝까지 맞췄을 때만 '맞춘 때'를 지금으로 옮긴다(이어 받을 쪽이 남았거나 실패한 출처가 있으면 그대로).
export const syncSettled = (reply, sources = ['od', 'gd']) => sources.every(s => !reply?.[s] || (!reply[s].more && !reply[s].error && !reply[s].busy));

// 정렬: 폴더 먼저, 그다음 고른 열. 같은 값이면 이름 → id(늘 같은 순서).
export const SORTS = Object.freeze(['name', 'modified', 'size']);
export const SORT_NAME = Object.freeze({name: '이름', modified: '바뀐 날', size: '크기'});
export function sortRows(rows, key = 'name', dir = 'asc') {
  const sign = dir === 'desc' ? -1 : 1;
  const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko', {numeric: true}) || String(a.item_id).localeCompare(String(b.item_id));
  const val = r => key === 'size' ? (Number.isFinite(Number(r.size_bytes)) && r.size_bytes !== null ? Number(r.size_bytes) : -1)
    : key === 'modified' ? (Date.parse(r.modified_at || '') || 0) : 0;
  return [...(rows || [])].sort((a, b) => {
    if (!!a.is_folder !== !!b.is_folder) return a.is_folder ? -1 : 1;
    if (key === 'name') return sign * byName(a, b);
    const d = val(a) - val(b);
    return d ? sign * d : byName(a, b);
  });
}
export const validSort = v => SORTS.includes(v) ? v : 'name';

export const rowKey = r => `${r.source}:${r.item_id}`;
// Edge sync 응답(changed·removed)을 지금 보는 폴더 줄에 입힌다. 이 폴더로 들어온 줄은 넣고, 나간 줄·휴지통·지운 줄은 뺀다.
// 줄에 없는 칸(폴더 장수·별표·자료실 표시)은 있던 값을 그대로 둔다. 바뀐 것이 없으면 같은 배열을 돌려준다(다시 그리지 않음).
export function applyChanges(rows, where, changed = [], removed = []) {
  if (!where || !Array.isArray(rows)) return rows;
  const gone = new Set((removed || []).map(r => `${r.source}:${r.id}`));
  const byKey = new Map(rows.map(r => [rowKey(r), r]));
  let touched = false;
  for (const key of gone) if (byKey.delete(key)) touched = true;
  for (const c of changed || []) {
    if (!c || c.source !== where.source) continue;
    const key = rowKey(c), had = byKey.get(key), inHere = (c.parent_id ?? null) === (where.parent ?? null) && !c.trashed;
    if (inHere) {
      byKey.set(key, {child_count: c.is_folder ? 0 : null, starred: false, library_doc_id: null, ...had, ...c});
      touched = true;
    } else if (had) { byKey.delete(key); touched = true; }
  }
  return touched ? [...byKey.values()] : rows;
}
// 바뀐 줄이 지금 보이는 폴더들의 장수에 닿는지(들어오거나 나갔을 수 있음). 닿으면 화면은 그 폴더 줄 목록을 서버에서 다시 읽는다.
export function touchesCounts(rows, where, changed = [], removed = []) {
  if (!where || !Array.isArray(rows)) return false;
  const folders = new Set(rows.filter(r => r.is_folder && r.source === where.source).map(r => r.item_id));
  if (!folders.size) return false;
  // 지운 줄이 지금 목록에 없으면 하위 폴더 안의 것일 수 있다. 바뀐 파일이 보이는 폴더 안으로 들어갔으면 그 폴더 장수가 바뀐다.
  const here = new Set(rows.map(rowKey));
  if ((removed || []).some(r => r.source === where.source && !here.has(`${r.source}:${r.id}`))) return true;
  return (changed || []).some(c => c && c.source === where.source && !c.is_folder && folders.has(c.parent_id));
}

// F8 옮기기 상한. across = 다른 클라우드로. 결과 {ok, reason}. 화면은 reason 글을 그대로 보인다.
export function moveCheck(items, {across = false} = {}) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return {ok: false, reason: '고른 것이 없습니다'};
  if (across) {
    if (list.length > 1) return {ok: false, reason: '다른 클라우드로는 한 번에 1개만 옮깁니다'};
    const it = list[0];
    if (it.is_folder) return {ok: false, reason: '다른 클라우드로는 폴더를 옮기지 않습니다'};
    const size = Number(it.size_bytes);
    if (!Number.isFinite(size) || it.size_bytes === null) return {ok: false, reason: '크기를 모르는 파일은 다른 클라우드로 옮기지 않습니다'};
    if (size > MOVE_ACROSS_MAX_BYTES) return {ok: false, reason: '다른 클라우드로는 200MB까지 옮깁니다'};
    return {ok: true, reason: ''};
  }
  if (list.length > MOVE_SAME_MAX) return {ok: false, reason: `한 번에 ${MOVE_SAME_MAX}개까지 옮깁니다`};
  if (new Set(list.map(r => r.source)).size > 1) return {ok: false, reason: '한 클라우드 안의 것만 함께 옮깁니다'};
  return {ok: true, reason: ''};
}

// 위치 줄: app_cloud_trail(가까운 것부터 depth 0)을 맨 위부터 이름 목록으로.
export function trailNames(source, trail) {
  const names = [...(trail || [])].sort((a, b) => b.depth - a.depth).map(t => String(t.name || ''));
  return [SOURCE_NAME[source] || '', ...names];
}
export function trailIds(trail) {
  return [...(trail || [])].sort((a, b) => b.depth - a.depth).map(t => t.item_id);
}
export const pathText = (source, folderPath) => [SOURCE_NAME[source] || '', ...(folderPath ? [folderPath] : [])].filter(Boolean).join(' › ');

// 폴더 나무 줄: 묶음 3개 → 연결된 클라우드 뿌리 → 펼친 폴더의 하위 폴더(읽어 둔 것만). 계산만 하고 그리기는 화면.
// children: Map(`${source}:${parentId || ''}` → 폴더 줄 목록), open: Set(같은 열쇠). 깊이는 40단계까지.
export const folderKey = (source, id) => `${source}:${id || ''}`;
export function treeRows({sources = SOURCES, children = new Map(), open = new Set(), order = (source, rows) => rows} = {}) {
  const out = SHELVES.map(shelf => ({type: 'shelf', shelf, key: 'shelf:' + shelf, depth: 0}));
  for (const source of sources) {
    const rootKey = folderKey(source, null), isOpen = open.has(rootKey);
    out.push({type: 'root', source, id: null, key: rootKey, depth: 0, open: isOpen, hasKids: true});
    if (!isOpen) continue;
    const walk = (parent, depth) => {
      if (depth > 40) return;
      for (const f of order(source, children.get(folderKey(source, parent)) || [])) { // FOLDER-순서·색 ③-2: 정한 순서(없으면 받은 순서 그대로)
        const key = folderKey(source, f.item_id), known = children.has(key), kids = known ? (children.get(key) || []).length > 0 : true;
        const o = open.has(key);
        out.push({type: 'folder', source, id: f.item_id, name: f.name, count: f.child_count, key, depth, open: o, hasKids: kids});
        if (o) walk(f.item_id, depth + 1);
      }
    };
    walk(null, 1);
  }
  return out;
}

// 주소 자리(새로고침 제자리, 라우터 setPlace). 값 모양은 라우터 규칙 [A-Za-z0-9_.:-]{1,80}.
// 원드라이브 id의 '!'는 ':'로 바꿔 적는다(두 클라우드 id에는 ':'가 없다: Edge isItemId·DB 검사).
export function placeOf(where) {
  if (!where) return {};
  if (where.shelf) return {shelf: where.shelf};
  const at = where.parent ? `${where.source}:${String(where.parent).replace(/!/g, ':')}` : where.source;
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(at) ? {at} : {at: where.source};
}
export function whereOf(place) {
  const shelf = place?.shelf, at = String(place?.at || '');
  if (SHELVES.includes(shelf)) return {shelf};
  const m = /^(od|gd)(?::(.+))?$/.exec(at);
  if (!m) return null;
  const parent = m[2] ? (m[1] === 'od' ? m[2].replace(/:/g, '!') : m[2]) : null;
  if (parent && !/^[A-Za-z0-9!_.-]{1,200}$/.test(parent)) return null;
  return {source: m[1], parent};
}

export function tabAt(tab, dir) {
  const i = PHONE_TABS.indexOf(tab);
  const j = i + (dir > 0 ? 1 : -1);
  return i >= 0 && j >= 0 && j < PHONE_TABS.length ? PHONE_TABS[j] : null;
}
export function cleanQuery(v) {
  const s = String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/ +/g, ' ').trim();
  return s.slice(0, QUERY_MAX);
}
// 찾기 결과 머리: '찾은 것 4 · 이름 3 · 자료실 글자 1'.
export function findSummary(rows) {
  const list = rows || [], name = list.filter(r => r.match_in === 'name').length, text = list.filter(r => r.match_in === 'text').length;
  return `찾은 것 ${list.length}${text ? ` · 이름 ${name} · 자료실 글자 ${text}` : ''}`;
}
// 서버 오류 코드 → 한 줄.
export function errorText(code) {
  const c = String(code || '');
  if (c.startsWith('phone_')) return phoneErrorText(c.slice(6));
  if (c === 'feature_required' || c === 'forbidden' || c === 'drive_owner_mismatch' || c === 'http_403') return '이 작업공간에서는 쓰지 않는 기능입니다';
  if (/not_connected|not_configured|reconnect|auth_expired|scope_missing|cloud_denied/.test(c)) return '클라우드 연결을 다시 해야 합니다';
  if (c === 'cloud_throttled') return '클라우드가 잠시 바쁩니다. 조금 뒤 다시 보세요';
  if (c === 'preview_unsupported' || c === 'media_unsupported') return '미리보기가 없는 파일입니다';
  if (c === 'preview_too_large') return '너무 커서 미리보기를 하지 않습니다';
  if (c === 'not_in_index' || c === 'not_found' || c === 'http_404') return '목록에 없는 파일입니다. 잠시 뒤 다시 보세요';
  return '불러오지 못했습니다';
}

// 실패 까닭 한 줄(작은 글자, '불러오지 못했습니다' 옆). 서버 글자를 그대로 보이지 않고 정해 둔 말만 쓴다(S49-26).
export function failReason(err) {
  const code = String(err?.code || ''), status = Number(err?.status) || 0, msg = String(err?.message || '');
  if (code === 'timeout') return '시간 초과';
  if (/statement timeout|canceling statement|57014/i.test(msg) || status === 408 || status === 504) return '서버 시간 초과';
  if (code === 'network_error') return '연결 끊김';
  if (status >= 500) return `서버 오류 ${status}`;
  if (status >= 400) return `요청 오류 ${status}`;
  return '';
}

// ---------- 쓰기(S48-45 ⑤·⑦) ----------
// 여러 개 고르기: Shift 누르고 고르면 보이는 순서에서 앞에 고른 줄부터 이 줄까지.
export function pickRange(keys, fromKey, toKey) {
  const list = Array.isArray(keys) ? keys : [];
  const a = list.indexOf(fromKey), b = list.indexOf(toKey);
  if (b < 0) return [];
  if (a < 0) return [toKey];
  return list.slice(Math.min(a, b), Math.max(a, b) + 1);
}
// 휴지통은 클라우드마다 따로 부른다(서버는 한 번에 한 클라우드·200개까지).
export function groupBySource(rows) {
  const out = [];
  for (const source of SOURCES) {
    const list = (rows || []).filter(r => r && r.source === source);
    for (let i = 0; i < list.length; i += MOVE_SAME_MAX) out.push({source, rows: list.slice(i, i + MOVE_SAME_MAX)});
  }
  return out;
}
// 쓰기 뒤 다시 읽을 나무 칸: 옮기기 전 부모들 + 옮길 곳.
export function touchedFolders(rows, dest = null) {
  const keys = new Set((rows || []).filter(Boolean).map(r => folderKey(r.source, r.parent_id ?? null)));
  if (dest?.source) keys.add(folderKey(dest.source, dest.parent ?? null));
  return [...keys];
}
// 끌어 놓기·붙여 넣기로 옮길 수 있는지: 같은 자리·자기 자신 폴더로는 아니다(아래로 들어가는 것은 서버가 다시 막음).
export function moveTargetOk(rows, dest) {
  const list = (rows || []).filter(Boolean);
  if (!list.length || !dest?.source) return false;
  if (list.some(r => r.source === dest.source && r.is_folder && r.item_id === (dest.parent ?? null))) return false;
  return !list.every(r => r.source === dest.source && (r.parent_id ?? null) === (dest.parent ?? null));
}
// 휴지통 확인 창 한 줄 + 되돌리는 곳(F1: 그 클라우드 휴지통).
export function trashAsk(rows) {
  const list = (rows || []).filter(Boolean);
  const text = list.length === 1 ? `'${list[0].name}'을(를) 휴지통으로 보낼까요?` : `${list.length}개를 휴지통으로 보낼까요?`;
  const where = [...new Set(list.map(r => r.source))].map(s => SOURCE_NAME[s]).join('·');
  return {text, note: `되돌리기는 ${where} 휴지통에서 합니다`};
}
// 쓰기 결과 한 줄.
export function writeDoneText(action, {done = 0, failed = 0, kept = false} = {}) {
  const verb = {rename: '이름을 바꿨습니다', mkdir: '폴더를 만들었습니다', move: '옮겼습니다', trash: '휴지통으로 보냈습니다', across: '다른 클라우드로 옮겼습니다'}[action] || '했습니다';
  if (action === 'across' && kept) return '복사는 끝났지만 원본은 그대로 남았습니다';
  if (failed && done) return `${done}개 ${verb} · ${failed}개 못 함`;
  if (failed) return `${failed}개 못 했습니다`;
  return action === 'move' || action === 'trash' ? `${done}개 ${verb}` : verb;
}
// 쓰기 오류 코드 → 한 줄(읽기 오류는 errorText).
export function writeErrorText(code) {
  const c = String(code || '');
  if (c === 'name_taken') return '같은 이름이 이미 있습니다';
  if (c === 'name_invalid') return '쓸 수 없는 이름입니다';
  if (c === 'move_into_self') return '폴더를 자기 안으로 옮길 수 없습니다';
  if (c === 'dest_invalid') return '옮길 곳이 맞지 않습니다';
  if (c === 'too_large') return '다른 클라우드로는 200MB까지 옮깁니다';
  if (c === 'across_folder') return '다른 클라우드로는 폴더를 옮기지 않습니다';
  if (c === 'across_unsupported') return '구글 문서는 다른 클라우드로 옮기지 않습니다';
  if (c === 'size_unknown') return '크기를 모르는 파일은 다른 클라우드로 옮기지 않습니다';
  if (c === 'changed_since_index' || c === 'size_mismatch') return '그사이 파일이 바뀌었습니다. 맞춘 뒤 다시 해 보세요';
  if (c === 'verify_failed') return '옮긴 파일이 원본과 달라 원본을 그대로 두었습니다';
  if (c === 'upload_failed') return '보내지 못했습니다. 원본은 그대로입니다';
  if (c === 'not_owner') return '내 파일이 아니라 옮길 수 없습니다';
  if (c === 'copy_into_self') return '폴더를 자기 안으로 복사할 수 없습니다';
  if (c === 'copy_failed') return '복사하지 못했습니다. 원본은 그대로입니다';
  if (c === 'folder_too_big') return '폴더 안이 200개가 넘어 통째로 복사하지 않습니다. 안을 열어 골라 주세요';
  // 올리기(2-④)
  if (c === 'file_mismatch') return '같은 파일이 아니에요(이름·크기가 달라요). 처음 올리던 파일을 골라 주세요';
  if (c === 'upload_mismatch') return '올린 파일을 클라우드에서 확인하지 못했어요. [다시]로 이어 올려 주세요';
  if (c === 'origin_invalid') return '이 주소에서는 올릴 수 없어요';
  if (c === 'job_not_resumable' || c === 'job_not_found') return '이 전송은 이어 올릴 수 없어요';
  if (c === 'big_not_confirmed') return '200MB가 넘어 묻지 않고는 올리지 않아요';
  return errorText(c);
}
// ⑦ 같은 파일 보기: 같은 해시(같은 클라우드 안 — 원드라이브 sha1·구글 md5라 클라우드 사이는 비교하지 않음)인 다른 줄. 자기 자신·휴지통 뺌.
export const TWIN_LIMIT = 20;
export function twinRows(rows, self) {
  if (!self?.hash) return [];
  return (rows || []).filter(r => r && r.hash === self.hash && !r.trashed && !(r.source === self.source && r.item_id === self.item_id))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko') || String(a.item_id).localeCompare(String(b.item_id)));
}

// ---------- FILES-통합 2-① 복사·옮기기(받을 곳 창, 명진 결정 H-3·H-4·H-5, 11/04) ----------
export const XFER_MODES = Object.freeze(['copy', 'move']);
export const XFER_VERB = Object.freeze({copy: '복사', move: '옮기기'});
// 클라우드 사이 한 파일 기본 상한(H-4). 넘는 파일은 묻고, 이 판에서는 '다음 판(2-②)에서 됩니다'로 멈춘다.
export const XFER_BIG_BYTES = MOVE_ACROSS_MAX_BYTES;
export const XFER_BIG_HOW = '서버가 10MB씩 나눠 이어 보내요. 화면을 닫아도 계속되고, 끊기면 끊긴 곳부터 다시. 폰 데이터는 쓰지 않아요.';
export const RECENT_DEST_MAX = 3;
export const RECENT_DEST_NAME_MAX = 40;
const gdDoc = r => r?.source === 'gd' && /^application\/vnd\.google-apps\./.test(String(r?.mime || ''));
// 받을 곳으로 보낼 수 있는지 줄마다 가른다. {ok: 보낼 줄, blocked: [{row, reason}], reason: 하나도 못 보낼 때 한 줄}.
//   같은 저장소: 복사는 파일·폴더(폴더째, H-5), 옮기기는 지금 규칙(같은 자리·자기 안 빼고 200개까지는 move가 나눠 보냄).
//   다른 저장소: 파일만(폴더는 막고 안내), 크기를 모르는 것·구글 문서는 막음. 200MB 넘는 것은 여기서 막지 않는다(묻는 창이 따로, big()).
export function xferPlan(rows, dest, mode = 'copy') {
  const list = (rows || []).filter(Boolean), ok = [], blocked = [];
  if (!dest?.source) return {ok, blocked, reason: '받을 곳을 고르세요'};
  const verb = mode === 'move' ? '옮겨요' : '복사돼요';
  for (const r of list) {
    const across = r.source !== dest.source;
    if (across && r.is_folder) blocked.push({row: r, reason: `폴더는 같은 저장소 안에서만 통째로 ${verb}. 다른 저장소로는 폴더를 열어 파일을 골라 주세요`});
    else if (across && gdDoc(r)) blocked.push({row: r, reason: '구글 문서는 다른 저장소로 보내지 않습니다'});
    else if (across && (r.size_bytes === null || r.size_bytes === undefined || !Number.isFinite(Number(r.size_bytes)))) blocked.push({row: r, reason: '크기를 모르는 파일은 다른 저장소로 보내지 않습니다'});
    else if (!across && r.is_folder && r.item_id === (dest.parent ?? null)) blocked.push({row: r, reason: `폴더를 자기 안으로 ${mode === 'move' ? '옮길' : '복사할'} 수 없습니다`});
    else if (mode === 'move' && !across && (r.parent_id ?? null) === (dest.parent ?? null)) blocked.push({row: r, reason: '이미 이 폴더에 있습니다'});
    else ok.push(r);
  }
  const reason = ok.length ? '' : blocked[0]?.reason || '고른 것이 없습니다';
  return {ok, blocked, reason};
}
// 200MB 넘는 클라우드 사이 파일인가(H-4).
export const xferBig = (r, dest) => !!r && !!dest && r.source !== dest.source && Number(r.size_bytes) > XFER_BIG_BYTES;
// 같은 이름(대소문자 무시 — 원드라이브 규칙)이 받을 곳에 있는 줄. destRows = 받을 폴더의 색인 줄.
//   같은 폴더로 복사하면 자기 자신도 같은 이름이다(옮기기는 같은 폴더로 가는 것을 xferPlan이 먼저 막는다).
export function sameNameRows(rows, destRows) {
  const names = new Set();
  for (const d of destRows || []) if (d && !d.trashed) names.add(String(d.name).toLowerCase());
  return (rows || []).filter(r => r && names.has(String(r.name).toLowerCase()));
}
// 같은 이름 묻는 한 줄(H-3). mode copy·move·down(받기).
export function sameNameAsk(mode) {
  return `같은 이름이 있어요. 그래도 ${mode === 'move' ? '옮길까요' : mode === 'down' ? '받을까요' : mode === 'up' ? '올릴까요' : '복사할까요'}?`;
}
// 200MB 넘는 파일 묻는 한 줄(H-4). mode 'up' = 올리기.
export const bigAsk = (r, mode = '') => `200MB가 넘어요(${sizeText(r?.size_bytes)}). 그래도 ${mode === 'up' ? '올릴까요' : '보낼까요'}?`;
// 받을 곳 창 제목·버튼.
export const destTitle = (n, mode) => `${n}개 ${mode === 'move' ? '옮길' : '복사할'} 곳`;
export const destButton = mode => `여기에 ${mode === 'move' ? '옮기기' : '복사'}`;
// 받을 곳 이름(칩·창 아래 줄): 맨 위면 저장소 이름, 아니면 폴더 이름(40자로 자름).
export function destName(dest, folderName = '') {
  const n = dest?.parent ? String(folderName || '').trim() : SOURCE_NAME[dest?.source] || '';
  return [...(n || SOURCE_NAME[dest?.source] || '')].slice(0, RECENT_DEST_NAME_MAX).join('');
}
// 최근 보낸 곳(서버 view_prefs.files_dest_recent, 모든 기기 같게): 방금 보낸 곳을 맨 앞에, 같은 곳은 하나만, 3개까지.
export function pushRecentDest(list, dest, name) {
  if (!dest?.source || !SOURCES.includes(dest.source)) return Array.isArray(list) ? list.slice(0, RECENT_DEST_MAX) : [];
  const id = dest.parent || '';
  if (!/^[A-Za-z0-9!_.-]{0,120}$/.test(id)) return Array.isArray(list) ? list.slice(0, RECENT_DEST_MAX) : [];
  const nm = destName(dest, name) || SOURCE_NAME[dest.source];
  const rest = (Array.isArray(list) ? list : []).filter(d => d && !(d.source === dest.source && d.id === id));
  return [{source: dest.source, id, name: nm}, ...rest].slice(0, RECENT_DEST_MAX);
}
export const recentDestOf = d => d && SOURCES.includes(d.source) ? {source: d.source, parent: d.id || null} : null;
// 전송 줄(하단바 위 얇은 줄, 시안 ⑤ 아래 줄): '2/5 보내는 중'. 가는 막대 폭은 끝난 몫.
export const xferLine = (at, total) => `${Math.min(at, total)}/${total} 보내는 중`;
export const xferPercent = (done, total) => total > 0 ? Math.max(0, Math.min(100, Math.round(done / total * 100))) : 0;
// 끝 한 줄.
export function xferDoneText(mode, {done = 0, failed = 0, skipped = 0} = {}) {
  const verb = mode === 'move' ? '옮김' : '복사함';
  const parts = [done ? `${done}개 ${verb}` : '', skipped ? `${skipped}개 건너뜀` : '', failed ? `${failed}개 못 함` : ''].filter(Boolean);
  return parts.join(' · ') || `${mode === 'move' ? '옮긴' : '복사한'} 것 없음`;
}

// ---- 전송 목록(FILES-통합 2-②, 서버 작업표 app_cloud_jobs — 시안 ⑤⑧) ----
// 한 줄 = 사람이 시작한 복사·옮기기 한 건. 서버(Edge cloud-files job_list)가 준 줄을 그대로 그린다(화면은 기억하지 않음, 다시 열면 서버에서 다시 읽음).
export const JOB_ACTIVE = Object.freeze(['queued', 'running']);
export const jobActive = j => !!j && JOB_ACTIVE.includes(j.status);
export const jobsActive = list => (list || []).some(jobActive);
// 실패 까닭: 서버가 정해 둔 말(code)만 받아 한 줄 글로. 모르는 말은 '연결이 끊겼어요'.
const JOB_REASON = Object.freeze({
  cloud_unavailable: '연결이 끊겼어요', cloud_throttled: '클라우드가 잠시 바빠요', no_space: '받을 곳 공간이 부족해요',
  name_invalid: '이름 규칙에 맞지 않아요', too_large: '너무 커요(2GB까지)', verify_failed: '받은 것이 원본과 달라 지웠어요',
  changed_since_index: '원본이 그사이 바뀌었어요', not_in_index: '원본을 찾지 못했어요', not_found: '원본을 찾지 못했어요',
  size_unknown: '크기를 모르는 파일이에요', across_unsupported: '구글 문서는 다른 저장소로 보내지 않아요',
  across_folder: '폴더는 같은 저장소 안에서만 통째로 보내요', folder_too_big: '폴더 안이 너무 많아요(200개까지)',
  copy_into_self: '폴더를 자기 안으로 보낼 수 없어요', dest_invalid: '받을 곳을 찾지 못했어요', name_taken: '같은 이름이 있어요',
  upload_failed: '받을 곳에 올리지 못했어요', copy_failed: '클라우드가 복사하지 못했어요', session_expired: '이어 올리기 자리가 끝났어요. [다시]는 처음부터',
  od_not_connected: '원드라이브 연결이 필요해요', od_auth_expired: '원드라이브를 다시 연결해 주세요', gd_not_connected: '구글 드라이브 연결이 필요해요',
  cloud_denied: '클라우드가 허락하지 않았어요', drive_owner_mismatch: '이 드라이브는 쓸 수 없어요', feature_required: '파일 기능이 꺼졌어요',
  too_many_steps: '너무 오래 걸려 멈췄어요', big_not_confirmed: '200MB가 넘어 묻지 않고는 보내지 않아요',
});
export const jobReason = code => JOB_REASON[code] || JOB_REASON.cloud_unavailable;
export const jobPercent = j => {
  if (!j) return 0;
  if (j.status === 'done') return 100;
  const size = Number(j.size_bytes);
  return size > 0 ? Math.max(0, Math.min(100, Math.floor(Number(j.sent_bytes || 0) / size * 100))) : 0;
};
// 줄 오른쪽 한 낱말.
export function jobStatusText(j) {
  if (!j) return '';
  if (j.status === 'running') return j.big || j.origin === 'device' ? `${jobPercent(j)}%` : '보내는 중';
  return {queued: '기다림', paused: '멈춤', done: '끝', failed: '실패', skipped: '건너뜀'}[j.status] || '';
}
// 줄 아래 작은 글: '원드라이브 → 구글 드라이브 · 240MB' + (같은 이름이면 '이름 (2)로'·실패면 까닭).
export function jobLine(j) {
  if (!j) return '';
  const from = j.origin === 'device' ? '이 기기' : SOURCE_NAME[j.src_source] || '';
  const to = SOURCE_NAME[j.dest_source] || '';
  const parts = [`${from} → ${to}${j.kind === 'move' ? ' 옮기기' : ''}`];
  if (j.size_bytes) parts.push(sizeText(j.size_bytes));
  if (j.status === 'failed') parts.push(jobReason(j.error_code));
  else if (j.status === 'skipped') parts.push('같은 이름이라 건너뜀');
  else if (j.status === 'done' && j.result_name && j.result_name !== j.name) parts.push(`'${j.result_name}'로`);
  else if (j.status === 'done' && j.kept_original) parts.push('원본은 남겼어요');
  return parts.join(' · ');
}
// 하단바 위 전송 줄: 지금 묶음(가장 오래된 기다림·보내는 중·멈춤 줄 이후에 시작한 것) 기준 'n/N 보내는 중 · 48%'.
//   보내는 것이 없고 멈춘 것만 있으면 'N개 멈춤', 실패만 남았으면 'N개 못 보냄'. 아무것도 없으면 null(줄 숨김).
export function jobStrip(jobs) {
  const list = (jobs || []).filter(Boolean);
  const open = list.filter(j => jobActive(j) || j.status === 'paused');
  const failed = list.filter(j => j.status === 'failed').length;
  if (!open.length) return failed ? {text: `${failed}개 못 보냄`, percent: 0, failed, name: ''} : null;
  const since = open.map(j => String(j.created_at || '')).sort()[0];
  const batch = list.filter(j => String(j.created_at || '') >= since);
  const ended = batch.filter(j => ['done', 'failed', 'skipped'].includes(j.status)).length;
  const running = batch.find(j => j.status === 'running') || batch.find(jobActive);
  const bytes = batch.reduce((n, j) => n + (Number(j.size_bytes) || 0), 0);
  const sent = batch.reduce((n, j) => n + (j.status === 'done' ? Number(j.size_bytes) || 0 : Number(j.sent_bytes) || 0), 0);
  const percent = bytes > 0 ? Math.min(100, Math.floor(sent / bytes * 100)) : xferPercent(ended, batch.length);
  if (!running) return {text: `${open.length}개 멈춤`, percent, failed, name: '', paused: true};
  return {text: `${Math.min(batch.length, ended + 1)}/${batch.length} 보내는 중`, percent, failed, name: running.name};
}
// 목록 머리: '전송 · 2/5'.
export function jobsTitle(jobs) {
  const s = jobStrip(jobs);
  const m = s && /^(\d+\/\d+)/.exec(s.text);
  return m ? `전송 · ${m[1]}` : '전송';
}
// 줄 단추: 기다림·보내는 중 = [멈춤], 멈춤 = [이어 하기], 실패 = [다시]. 기기가 낀 줄(origin device)은 그 기기 화면이 잇는다(서버는 잇지 않음).
export function jobAction(j) {
  if (!j) return '';
  if (jobActive(j)) return 'pause';
  // 올리기(2-④): 멈춤·실패는 이 기기가 같은 파일로 잇는다([이어 올리기]).
  if (j.origin === 'device') return j.status === 'paused' || j.status === 'failed' ? 'reup' : '';
  if (j.status === 'paused') return 'resume';
  if (j.status === 'failed') return 'retry';
  return '';
}
// 노트북·PC(H-6): 기기가 낀 전송(origin device — PC에서 올리기, 2-④)은 화면을 닫으면 '일시 정지'로 남고 다시 열면 남은 조각부터.
//   다시 열었을 때 그 줄을 어떻게 볼지: 보내는 중이었던 것은 멈춤으로(이 기기가 다시 시작해야 함), 나머지는 그대로.
export const deviceJobOnReopen = j => j && j.origin === 'device' && jobActive(j) ? {...j, status: 'paused'} : j;
// 서버 목록을 새것 → 옛것 순서로(서버도 같은 순서로 준다). 같은 id는 새 줄이 이긴다.
export function mergeJobs(old, fresh) {
  const m = new Map((old || []).map(j => [j.id, j]));
  for (const j of fresh || []) if (j?.id) m.set(j.id, j);
  return [...m.values()].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || String(b.id).localeCompare(String(a.id)));
}
// 서버 목록이 바뀌며 '끝'이 된 줄(이번에 끝난 것)만.
export function newlyDone(old, fresh) {
  const was = new Map((old || []).map(j => [j.id, j.status]));
  return (fresh || []).filter(j => j?.status === 'done' && was.has(j.id) && was.get(j.id) !== 'done');
}

// ---------- FILES-통합 2-④ 올리기(기기 → 클라우드, S49-33, 설계 docs/design/files-unified-plan.md J절 H-3·H-4·H-6) ----------
// PC: 목록 칸에 바탕화면 파일을 끌어 놓기(시안 ⑦ 점선 '여기 놓으면 ○○에 올리기'), 폰·폴드: 위 줄 [올리기] → 고르기 창.
// 서버(Edge upload_open)가 받을 클라우드의 이어 올리기 자리를 열어 주고 브라우저가 그 자리로 5MB씩 직접 보낸다(파일이 서버를 거치지 않음).
export const UPLOAD_MAX = 200;                              // 한 번에 올리는 파일 수(고르기 상한과 같음)
export const UPLOAD_MAX_BYTES = 2 * 1024 * 1024 * 1024;     // 한 파일 2GB까지(H-4 추천 상한, 서버도 같음)
export const UPLOAD_BIG_HOW = '이 기기가 5MB씩 올려요. 화면을 닫으면 멈추고, 다시 열어 같은 파일을 고르면 남은 조각부터 올려요.';
// 브라우저 제약(H-6): 다시 연 화면은 파일을 기억하지 못한다.
export const UPLOAD_REOPEN_TEXT = '브라우저는 화면을 닫으면 파일을 잊어요. 같은 파일을 다시 고르면 남은 조각부터 올려요.';
export const upDropText = name => `여기 놓으면 ${name || '이 폴더'}에 올리기`;
export const upStartText = n => `${n}개 올리기 시작 · 아래 전송 줄을 누르면 목록`;
// 고른 파일({name,size}) 거르기: 이름 규칙(공용 checkFileBase는 화면이 넘김)·2GB·수 상한. {ok, blocked:[{file, reason}], reason}.
export function uploadPlan(files, nameOk = () => true) {
  const list = [...(files || [])].filter(Boolean), ok = [], blocked = [];
  for (const f of list) {
    const size = Number(f.size);
    if (!Number.isSafeInteger(size) || size < 0) blocked.push({file: f, reason: '크기를 모르는 파일은 올리지 않아요'});
    else if (size > UPLOAD_MAX_BYTES) blocked.push({file: f, reason: `${f.name}: 2GB까지 올려요`});
    else if (!nameOk(String(f.name || ''))) blocked.push({file: f, reason: `${f.name}: 쓸 수 없는 이름이에요`});
    else if (ok.length >= UPLOAD_MAX) blocked.push({file: f, reason: `한 번에 ${UPLOAD_MAX}개까지 올려요`});
    else ok.push(f);
  }
  return {ok, blocked, reason: ok.length ? '' : blocked[0]?.reason || '고른 파일이 없어요'};
}
// 200MB 넘는 파일(H-4: 한 번 묻기).
export const upBig = f => Number(f?.size) > XFER_BIG_BYTES;
// 받을 폴더에 같은 이름(대소문자 무시)이 있는 파일.
export function upSameName(files, destRows) {
  const names = new Set((destRows || []).filter(d => d && !d.trashed).map(d => String(d.name).toLowerCase()));
  return (files || []).filter(f => f && names.has(String(f.name).toLowerCase()));
}
// 이어 올리기: 다시 고른 파일이 그 줄과 같은가(이름·크기 — 서버도 다시 본다).
export const sameUpFile = (j, f) => !!j && !!f && String(f.name) === String(j.name) && Number(f.size) === Number(j.size_bytes);
// 이어 올릴 조각: [start, end) — 끝 조각은 짧다. size 0이면 없음.
export function upPiece(offset, size, chunk) {
  if (!(size > offset) || !(chunk > 0)) return null;
  return {start: offset, end: Math.min(size, offset + chunk)};
}
// 기기 줄 아래 작은 글 덧붙임: 이 화면이 그 파일을 쥐고 있지 않으면 다시 고르라는 한 줄.
export function deviceHint(j, hasFile) {
  if (!j || j.origin !== 'device' || hasFile) return '';
  return j.status === 'paused' || j.status === 'failed' ? '이어 올리려면 같은 파일을 다시 골라 주세요' : '';
}
// 클라우드가 마지막 조각 응답으로 준 새 파일 id(원드라이브 id·구글 id). 모양이 다르면 null(서버가 이름으로 찾음).
export function upResultId(d) {
  const id = d && typeof d === 'object' ? d.id : null;
  return typeof id === 'string' && /^[A-Za-z0-9!_.-]{1,200}$/.test(id) ? id : null;
}

// ---------- 별표(2-④): 고른 것이 모두 별표면 빼기, 아니면 넣기 ----------
export const starWant = rows => !(rows || []).filter(Boolean).every(r => r.starred);
export const starLabel = rows => (starWant(rows) ? '☆ 별표' : '★ 별표 빼기');
// 서버가 바꾼 별표를 줄 목록에 입힌다(같은 줄이면 같은 배열을 돌려준다).
export function applyStars(rows, source, ids, on) {
  const set = new Set(ids || []);
  let hit = false;
  const next = (rows || []).map(r => {
    if (r?.source !== source || !set.has(r.item_id) || !!r.starred === on) return r;
    hit = true;
    return {...r, starred: on};
  });
  return hit ? next : rows;
}
