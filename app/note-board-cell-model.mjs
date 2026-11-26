// S71-56 NOTE-보드 표·파일 칸(사용자 결정 2026-11-26 21:11 "텍스트, 첨부한 사진, 심지어는 첨부한 파일 도 다 뻗을 수 있었으면", "표도 넣을 수 있고 모든 것에서",
// "관계망 형성이 되어야해"): 노트 › 보드의 표 칸·파일 칸 계산(화면 없음, 시험 가능). 그리는 곳은 note-board.js 하나, 저장은 note-board-links-data.js.
// - 두 칸 모두 글 상자 표(app_note_board_texts)의 한 줄 — 다른 칸과 같이 가지(부모·자식)·관계선·접기·자동 배치·고르기·맞추기·찾기·내보내기에 들어간다.
//   서버 칸(migration 20261127050000_note_board_cells): 종류 kind 'table'·'file', 글 body는 빈 글('').
// - 표: cells = 줄 × 칸 글자 표(네모 — 모든 줄의 칸 수가 같음). 줄 1~ROWS_MAX, 칸 1~COLS_MAX, 칸 글은 CELL_MAX자, 전체 JSON BYTES_MAX바이트(서버 check와 같음).
//   새 표는 3×3 빈 표. 칸 글에는 줄바꿈만(다른 제어 문자는 지움). 그릴 때는 늘 글자로만(escape — 부르는 쪽).
// - 파일: 칸은 가리키는 곳만 가진다 — 자료실 자료 file_doc, 또는 노트 첨부 file_note + file_drive(드라이브 파일 번호). 원본은 드라이브 그대로(복사·이동 없음).
//   다른 작업공간 id는 서버(좁히기 정책)가 거절하고, 화면도 내 자료·내 노트 첨부 목록에서만 고른다.
// - 기기 저장 없음.
export const CELL_KINDS = Object.freeze(['table', 'file']);
export const isCellKind = k => CELL_KINDS.includes(k);
export const ROWS_MAX = 30, COLS_MAX = 12, CELL_MAX = 500, BYTES_MAX = 20000;
export const TABLE_ROWS = 3, TABLE_COLS = 3;
export const TABLE_W = 300, FILE_W = 220; // 새 칸 폭(판 px)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DRIVE = /^[A-Za-z0-9_-]{1,255}$/;
export const isUuid = v => typeof v === 'string' && UUID.test(v);
export const isDriveId = v => typeof v === 'string' && DRIVE.test(v);

// 칸 글 하나: 줄바꿈만 남기고 다른 제어 문자는 지운다. 길면 자른다.
export function cleanCell(v) {
  const s = typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, '') : '';
  return [...s].slice(0, CELL_MAX).join('');
}
const bytes = cells => new TextEncoder().encode(JSON.stringify(cells)).length;
export const fitsBytes = cells => bytes(cells) <= BYTES_MAX;
// 서버 줄의 cells → 네모 글자 표 또는 null(모양이 틀리면 그리지 않는다 — 서버가 이미 막지만 한 번 더).
export function parseCells(v) {
  if (!Array.isArray(v) || v.length < 1 || v.length > ROWS_MAX) return null;
  const cols = Array.isArray(v[0]) ? v[0].length : 0;
  if (cols < 1 || cols > COLS_MAX) return null;
  for (const row of v) if (!Array.isArray(row) || row.length !== cols || row.some(c => typeof c !== 'string')) return null;
  return v.map(row => row.map(c => [...c].slice(0, CELL_MAX).join('')));
}
export const newCells = (rows = TABLE_ROWS, cols = TABLE_COLS) => Array.from({length:rows}, () => Array.from({length:cols}, () => ''));
export const tableSize = cells => ({rows:cells?.length || 0, cols:cells?.[0]?.length || 0});
const copy = cells => cells.map(r => r.slice());
// 줄·칸 더하기(at 뒤에, 없으면 맨 끝)·빼기(at, 없으면 맨 끝). 한도를 넘거나 하나만 남으면 null(바꿀 것 없음).
export function addRow(cells, at = null) {
  const {rows, cols} = tableSize(cells); if (rows >= ROWS_MAX) return null;
  const i = Number.isInteger(at) ? Math.min(Math.max(at + 1, 0), rows) : rows, out = copy(cells);
  out.splice(i, 0, Array.from({length:cols}, () => ''));
  return out;
}
export function removeRow(cells, at = null) {
  const {rows} = tableSize(cells); if (rows <= 1) return null;
  const i = Number.isInteger(at) && at >= 0 && at < rows ? at : rows - 1, out = copy(cells);
  out.splice(i, 1);
  return out;
}
export function addCol(cells, at = null) {
  const {cols} = tableSize(cells); if (cols >= COLS_MAX) return null;
  const i = Number.isInteger(at) ? Math.min(Math.max(at + 1, 0), cols) : cols;
  return cells.map(r => { const n = r.slice(); n.splice(i, 0, ''); return n; });
}
export function removeCol(cells, at = null) {
  const {cols} = tableSize(cells); if (cols <= 1) return null;
  const i = Number.isInteger(at) && at >= 0 && at < cols ? at : cols - 1;
  return cells.map(r => { const n = r.slice(); n.splice(i, 1); return n; });
}
export function setCell(cells, r, c, value) {
  if (!cells?.[r] || c < 0 || c >= cells[r].length) return cells;
  const out = copy(cells); out[r][c] = cleanCell(value); return out;
}
// 표 안 Tab: 다음 칸(줄 끝이면 다음 줄 첫 칸). 마지막 칸이면 grow(줄 더하기 — 한도 안일 때). Shift+Tab: 앞 칸(첫 칸이면 그대로).
export function stepCell(cells, r, c, back = false) {
  const {rows, cols} = tableSize(cells);
  if (back) return c > 0 ? {r, c:c - 1} : r > 0 ? {r:r - 1, c:cols - 1} : {r, c};
  if (c < cols - 1) return {r, c:c + 1};
  if (r < rows - 1) return {r:r + 1, c:0};
  return rows < ROWS_MAX ? {r:r + 1, c:0, grow:true} : {r, c};
}
// 찾기·내보내기·화면 읽기용 글: 줄은 줄바꿈, 칸은 ' | '. 빈 표면 ''.
export function tableText(cells) {
  return (cells || []).map(r => r.map(c => c.replace(/\s+/g, ' ').trim()).join(' | ')).filter(l => l.replace(/[ |]/g, '')).join('\n');
}
// 처음 글이 있는 칸(이름 대신 쓰는 짧은 글).
export const tableTitle = cells => { for (const r of cells || []) for (const c of r) if (c.trim()) return c.trim().replace(/\s+/g, ' '); return ''; };

// ---- 파일 칸 ----
// 서버 줄 → 가리키는 곳 {kind:'doc', doc} 또는 {kind:'att', note, drive}. 틀리면 null.
export function fileRef(row) {
  if (!row) return null;
  if (isUuid(row.file_doc) && !row.file_note) return {kind:'doc', doc:row.file_doc};
  if (isUuid(row.file_note) && isDriveId(row.file_drive) && !row.file_doc) return {kind:'att', note:row.file_note, drive:row.file_drive};
  return null;
}
export const fileKey = ref => (ref?.kind === 'doc' ? `doc:${ref.doc}` : ref?.kind === 'att' ? `att:${ref.note}/${ref.drive}` : '');
// 고르기 창·끌어 놓기에서 온 것({kind:'doc', ref} 또는 {kind:'att', ref:'노트id/드라이브번호'}) → 서버에 보낼 칸. 틀리면 null.
export function fileFields(pick) {
  if (pick?.kind === 'doc' && isUuid(pick.ref)) return {file_doc:pick.ref};
  if (pick?.kind === 'att' && typeof pick.ref === 'string') {
    const [note, drive, more] = pick.ref.split('/');
    if (more === undefined && isUuid(note) && isDriveId(drive)) return {file_note:note, file_drive:drive};
  }
  return null;
}
// 새 칸 서버 줄(판 자리 at = 왼쪽 위).
export const tableSpec = (board_id, at, z = 0) => ({board_id, kind:'table', shape:'rect', body:'', cells:newCells(), x:Math.round(at.x), y:Math.round(at.y), w:TABLE_W, z});
export function fileSpec(board_id, pick, at, z = 0) {
  const f = fileFields(pick); if (!f) return null;
  return {board_id, kind:'file', shape:'rect', body:'', ...f, x:Math.round(at.x), y:Math.round(at.y), w:FILE_W, z};
}
// 파일 종류(아이콘·글자): 이름 끝(확장자)을 먼저, 사진은 mime도.
const EXT = {pdf:'pdf', hwp:'hwp', hwpx:'hwp', doc:'word', docx:'word', xls:'sheet', xlsx:'sheet', csv:'sheet', ppt:'slide', pptx:'slide', txt:'text', md:'text',
  html:'web', htm:'web', zip:'zip', jpg:'image', jpeg:'image', png:'image', gif:'image', webp:'image', heic:'image', heif:'image', bmp:'image', mp4:'video', mov:'video', mp3:'audio', m4a:'audio', wav:'audio'};
export const FILE_TYPE_NAMES = Object.freeze({pdf:'PDF', hwp:'한글', word:'워드', sheet:'표 계산', slide:'발표', text:'글', web:'웹 문서', zip:'압축', image:'사진', video:'동영상', audio:'소리', other:'파일'});
export function fileType(name = '', mime = '') {
  const ext = String(name).toLowerCase().match(/\.([a-z0-9]{1,5})$/)?.[1];
  if (ext && EXT[ext]) return EXT[ext];
  const m = String(mime || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m === 'application/pdf') return 'pdf';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  return 'other';
}
export const isHwpName = name => /\.hwpx?$/i.test(String(name || ''));
// 크기 글: 1234 → '1.2KB'. 모르면 ''.
export function sizeText(n) {
  const v = Number(n); if (!Number.isFinite(v) || v <= 0) return '';
  if (v < 1024) return `${Math.round(v)}B`;
  const units = ['KB', 'MB', 'GB']; let x = v / 1024, i = 0;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
  return `${x >= 10 ? Math.round(x) : Math.round(x * 10) / 10}${units[i]}`;
}
// 고르기 창 [노트 첨부] 줄: 내 노트(잠긴 노트 빼고)의 첨부, 찾기 글이 있으면 이름에 든 것만. 최근 고친 노트 먼저, 최대 max개.
export function pickAttachments(notes, query = '', {hidden = () => false, titleOf = n => n?.title || '', max = 300} = {}) {
  const q = String(query || '').trim().toLowerCase(), out = [];
  const list = [...(notes || [])].filter(n => n && !hidden(n) && Array.isArray(n.attachments) && n.attachments.length)
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  for (const n of list) for (const f of n.attachments) {
    if (!isUuid(n.id) || !isDriveId(f?.drive_file_id)) continue;
    const name = String(f.file_name || f.name || '파일');
    if (q && !name.toLowerCase().includes(q) && !String(titleOf(n)).toLowerCase().includes(q)) continue;
    out.push({kind:'att', ref:`${n.id}/${f.drive_file_id}`, title:name, date:String(titleOf(n) || '').slice(0, 24)});
    if (out.length >= max) return out;
  }
  return out;
}
