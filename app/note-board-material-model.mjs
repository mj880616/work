// S71-54 NOTE-주제재료잇기(사용자 결정 2026-11-26 19:58~59):
// 생각지도 주제(보드 글 상자)마다 이어 둔 '재료' 계산 한 곳(화면 없음, 시험 가능).
// - 저장: 새 표 없이 기존 연결선 표 app_note_board_links의 kind 'material' 줄(migration 20261127020000). 끝 하나는 늘 주제 상자(from_text),
//   다른 끝은 노트(mat_note) · 자료실 자료(mat_doc) · 웹 주소(mat_url) 중 하나(노트 재료가 선 끝 칸 to_note가 아닌 까닭은 migration 머리말). 이름(label)은 이을 때 이름(1~40자) — 화면은 지금 노트·자료 이름이 있으면 그걸 쓴다.
//   선으로 그리지 않는다(주제 아래 작은 칩). 읽기·쓰기는 note-board-links-data.js 한 곳.
// - 웹 주소는 http:// · https:// 만(javascript: · data: · file: 등은 거절), 빈칸·제어 문자 없음, 2000자까지(서버 check와 같은 규칙).
// - 기기 저장 없음.
export const MATERIAL = 'material';
// 끌어 놓기 종류: 노트 목록 줄(보드에 이미 있는 노트도) · 자료실 자료 줄. 주제 위에 놓으면 재료(note-board.js), 다른 곳은 지금 그대로.
export const NOTE_REF_DRAG = 'application/x-kptu-note-ref';
export const DOC_REF_DRAG = 'application/x-kptu-doc-ref';
export const MATERIAL_KINDS = Object.freeze(['note', 'doc', 'link']);
export const MATERIAL_CHIPS = 3; // 주제 아래 칩 수(넘으면 '+n')
export const MATERIAL_LIMIT = 50; // 주제 하나의 재료 수(화면에서만 막음)
export const URL_MAX = 2000;
export const TITLE_MAX = 40; // 서버 label check와 같음
export const CHIP_CHARS = 12; // 칩 제목 줄임(글자 수)
export const KIND_NAMES = Object.freeze({note:'노트', doc:'자료', link:'링크'});
const BOARD_RE = /^(all|b[0-9a-z]{6,12})$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const id = v => (typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : null);

// 붙여 넣은 주소 → 저장할 주소(http/https만, 아니면 null). 앞뒤 빈칸만 지우고, 가운데 빈칸·제어 문자가 있으면 거절(고쳐 쓰지 않음).
// 'www.'로 시작하면 https://를 붙인다(사람이 흔히 붙여 넣는 꼴).
export function safeUrl(raw) {
  let s = typeof raw === 'string' ? raw.trim() : '';
  if (!s || s.length > URL_MAX || /\s/.test(s) || CONTROL.test(s)) return null;
  if (/^www\.[^/]+\./i.test(s)) s = 'https://' + s;
  if (!/^https?:\/\//i.test(s)) return null;
  let u; try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.hostname || u.username || u.password) return null; // 주소에 로그인 정보를 넣지 않는다
  const href = u.href;
  return href.length >= 10 && href.length <= URL_MAX && /^https?:\/\/[^\s\u0000-\u001f\u007f]+$/.test(href) ? href : null;
}
// 재료 이름(이을 때 남기는 이름): 한 줄 · 제어 문자 없음 · 40자. 비면 null.
export function cleanTitle(raw) {
  const s = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (!s) return null;
  return [...s.replace(/[\u0000-\u001f\u007f-\u009f]/g, '')].slice(0, TITLE_MAX).join('').trim() || null;
}
// 주소를 사람이 읽는 짧은 꼴(칩·목록): 'example.org/글/12'. 이름이 없을 때 쓴다(주소 그대로 — 바꾸지 않고 앞쪽만 떼어 보임).
export function urlLabel(url) {
  try { const u = new URL(url); return (u.hostname.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname) + u.search).slice(0, 200); } catch { return String(url || ''); }
}
export const shorten = (s, n = CHIP_CHARS) => { const c = [...String(s || '')]; return c.length > n ? c.slice(0, n).join('') + '…' : c.join(''); };

// 서버 줄 → 재료(모양이 틀리면 null). 주소는 다시 검사한다(서버가 거른 것이지만 그릴 때도 http/https만).
export function parseMaterial(row) {
  if (!row || typeof row !== 'object' || row.kind !== MATERIAL) return null;
  const mid = id(row.id), board = typeof row.board_id === 'string' && BOARD_RE.test(row.board_id) ? row.board_id : null, text = id(row.from_text);
  if (!mid || !board || !text) return null;
  const note = id(row.mat_note), doc = id(row.mat_doc), url = typeof row.mat_url === 'string' ? safeUrl(row.mat_url) : null;
  if ([note, doc, url].filter(Boolean).length !== 1) return null;
  const title = typeof row.label === 'string' && row.label.trim() && !CONTROL.test(row.label) ? [...row.label].slice(0, TITLE_MAX).join('') : null;
  return {id:mid, board_id:board, text, kind:note ? 'note' : doc ? 'doc' : 'link', ref:note || doc || url, title, pending:!!row.pending};
}
// 서버로 보낼 줄(새 재료). 틀리면 null.
export function materialBody({board_id, text, kind, ref, title = null}) {
  if (typeof board_id !== 'string' || !BOARD_RE.test(board_id) || !id(text) || !MATERIAL_KINDS.includes(kind)) return null;
  const label = cleanTitle(title);
  if (kind === 'link') { const url = safeUrl(ref); return url ? {board_id, kind:MATERIAL, from_text:text, mat_url:url, label} : null; }
  if (!id(ref)) return null;
  return {board_id, kind:MATERIAL, from_text:text, [kind === 'note' ? 'mat_note' : 'mat_doc']:ref, label};
}
export const materialKey = m => `${m.text}|${m.kind}|${m.ref}`;
// 주제 하나의 재료(이은 차례). list: 한 보드의 재료.
export const materialsOf = (list, textId) => list.filter(m => m.text === textId);
// 칩: 앞 MATERIAL_CHIPS개 + 나머지 수.
export function chipsOf(list, max = MATERIAL_CHIPS) { return {shown:list.slice(0, max), more:Math.max(0, list.length - max)}; }
// 보이는 이름: 노트·자료는 지금 이름(없으면 이을 때 이름), 링크는 이을 때 이름 또는 주소. locked(노트 잠김)면 '잠긴 노트'.
export function materialName(m, {noteTitle = () => null, docTitle = () => null, locked = () => false} = {}) {
  if (m.kind === 'note') return locked(m.ref) ? '잠긴 노트' : noteTitle(m.ref) || m.title || '노트';
  if (m.kind === 'doc') return docTitle(m.ref) || m.title || '자료';
  return m.title || urlLabel(m.ref);
}
// 반대 방향: 이 노트·자료를 재료로 둔 주제들(보드 · 주제 id). 같은 주제는 한 번.
export function topicsFor(all, kind, ref) {
  const seen = new Set(), out = [];
  for (const m of all) if (m.kind === kind && m.ref === ref && !seen.has(m.text)) { seen.add(m.text); out.push({board:m.board_id, text:m.text}); }
  return out;
}
// 끌어 놓은 것 → 재료 후보. dt: {types, getData(type)}. noteType: 노트 목록 줄의 끌기 종류, docType: 자료실 줄의 끌기 종류.
// 주소(text/uri-list · text/plain 한 줄)는 http/https만. 아니면 null(지금처럼 카드로 놓거나 무시).
export function dropMaterial(dt, {noteType, docType} = {}) {
  if (!dt) return null;
  const types = [...(dt.types || [])], get = t => { try { return dt.getData(t) || ''; } catch { return ''; } };
  if (noteType && types.includes(noteType)) { const v = get(noteType).trim(); if (id(v)) return {kind:'note', ref:v}; }
  if (docType && types.includes(docType)) { const v = get(docType).trim(); if (id(v)) return {kind:'doc', ref:v}; }
  if (types.includes('Files')) return null; // 파일은 지금처럼(사진 넣기 등) — 주소로 보지 않는다
  const uri = types.includes('text/uri-list') ? get('text/uri-list').split(/\r?\n/).map(s => s.trim()).find(s => s && !s.startsWith('#')) : '';
  const plain = !uri && types.includes('text/plain') ? get('text/plain').trim() : '';
  const url = safeUrl(uri || plain);
  if (!url) return null;
  // 브라우저 주소창·링크를 끌면 text/x-moz-url(주소\n제목) 또는 text/html(<a>제목</a>)이 함께 온다 — 제목은 글자만 읽는다(그리지 않음).
  let title = null;
  if (types.includes('text/x-moz-url')) title = cleanTitle(get('text/x-moz-url').split(/\r?\n/)[1] || '');
  if (!title && types.includes('text/html')) { const m = /<a\b[^>]*>([^<]{1,200})<\/a>/i.exec(get('text/html')); if (m) title = cleanTitle(m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")); }
  if (title && safeUrl(title) === url) title = null;
  return {kind:'link', ref:url, title};
}
// 내보내기(PDF·HTML) 글: 주제 아래 재료 이름 줄(종류 · 이름). 주소는 그대로 적는다(누르지 않는 글).
export function exportLines(list, names) {
  return list.map(m => `${KIND_NAMES[m.kind]} · ${names(m)}${m.kind === 'link' && names(m) !== m.ref ? ` (${m.ref})` : ''}`);
}
// ---- 고르기 창(note-board-material-pick.js)의 목록 계산 ----
const fold = s => String(s || '').toLowerCase().replace(/\s+/g, '');
export const PICK_SHOW = 60; // 한 번에 보이는 줄 수
// 노트: 찾는 말이 없으면 최근 고친 순, 있으면 제목·본문에 든 것(빈칸 무시). 잠긴 노트는 넣지 않는다(제목을 보이지 않음).
export function pickNotes(notes, query, {titleOf, hidden = () => false, show = PICK_SHOW} = {}) {
  const q = fold(query), out = [];
  const list = notes.filter(n => n && !hidden(n)).slice().sort((a, b) => (Date.parse(b.updated_at || '') || 0) - (Date.parse(a.updated_at || '') || 0));
  for (const n of list) {
    const title = titleOf(n);
    if (q && !fold(title).includes(q) && !fold(n.raw_text).includes(q)) continue;
    out.push({kind:'note', ref:n.id, title, date:String(n.updated_at || '').slice(0, 10)});
    if (out.length >= show) break;
  }
  return out;
}
const docName = d => String(d?.title || d?.file_name || '자료');
// 자료실: 찾는 말이 있으면 이름(제목·파일 이름)에 든 것, 없으면 최근(올린 순) 또는 폴더 안(folder 보기: folder = 지금 폴더 id 또는 null = 맨 위).
// itemFolder: 자료 id → 폴더 id. siblings(all, parentId): 그 폴더 아래 폴더(자료실 나무와 같은 순서).
export function pickDocs(docs, query, {view = 'recent', folder = null, folders = [], itemFolder = new Map(), siblings = null, show = PICK_SHOW} = {}) {
  const q = fold(query);
  if (q || view !== 'folder') {
    const rows = [];
    for (const d of docs) { if (q && !fold(docName(d)).includes(q) && !fold(d.file_name).includes(q)) continue; rows.push({kind:'doc', ref:d.id, title:docName(d), date:String(d.created_at || '').slice(0, 10)}); if (rows.length >= show) break; }
    return {folders:[], rows, path:[]};
  }
  const kids = siblings ? siblings(folders, folder) : folders.filter(f => (f.parent_id || null) === (folder || null));
  const rows = docs.filter(d => (itemFolder.get(d.id) || null) === (folder || null)).slice(0, show).map(d => ({kind:'doc', ref:d.id, title:docName(d), date:String(d.created_at || '').slice(0, 10)}));
  const path = []; let at = folder; const byId = new Map(folders.map(f => [f.id, f]));
  for (let i = 0; at && i < 100; i++) { const f = byId.get(at); if (!f) break; path.unshift({id:f.id, name:String(f.name || '폴더')}); at = f.parent_id || null; }
  return {folders:kids.map(f => ({id:f.id, name:String(f.name || '폴더')})), rows, path};
}
