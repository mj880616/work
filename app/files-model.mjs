// FILES-클라우드탐색기 ④ 화면 모델(설계 docs/design/files-explorer.md, 명진 결정 F1~F9 11/02). DOM·네트워크 없음.
// 화면(files.js)은 여기서 계산한 값으로 그리기만 한다. 색인 줄 모양은 DB 읽기 함수 app_cloud_list·app_cloud_find와 Edge cloud-files sync 응답.

export const SOURCES = Object.freeze(['od', 'gd']);
export const SOURCE_NAME = Object.freeze({od: '원드라이브', gd: '구글 드라이브'});
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
  gdoc: {label: '구글 문서', icon: 'G'}, file: {label: '파일', icon: '·'},
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
  if ((removed || []).some(r => r.source === where.source)) return true;
  return (changed || []).some(c => c && c.source === where.source && !c.is_folder);
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
export function treeRows({sources = SOURCES, children = new Map(), open = new Set()} = {}) {
  const out = SHELVES.map(shelf => ({type: 'shelf', shelf, key: 'shelf:' + shelf, depth: 0}));
  for (const source of sources) {
    const rootKey = folderKey(source, null), isOpen = open.has(rootKey);
    out.push({type: 'root', source, id: null, key: rootKey, depth: 0, open: isOpen, hasKids: true});
    if (!isOpen) continue;
    const walk = (parent, depth) => {
      if (depth > 40) return;
      for (const f of children.get(folderKey(source, parent)) || []) {
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
  if (c === 'feature_required' || c === 'forbidden' || c === 'drive_owner_mismatch' || c === 'http_403') return '이 작업공간에서는 쓰지 않는 기능입니다';
  if (/not_connected|not_configured|reconnect|auth_expired|scope_missing|cloud_denied/.test(c)) return '클라우드 연결을 다시 해야 합니다';
  if (c === 'cloud_throttled') return '클라우드가 잠시 바쁩니다. 조금 뒤 다시 보세요';
  if (c === 'preview_unsupported' || c === 'media_unsupported') return '미리보기가 없는 파일입니다';
  if (c === 'preview_too_large') return '너무 커서 미리보기를 하지 않습니다';
  if (c === 'not_in_index' || c === 'not_found' || c === 'http_404') return '목록에 없는 파일입니다. 잠시 뒤 다시 보세요';
  return '불러오지 못했습니다';
}
