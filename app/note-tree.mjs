// NOTE-탐색기(명진 요청 2026-10-28 09:24·10:34): 노트 폴더 나무의 순수 부분(화면·저장소·네트워크 없음, node --test로 시험).
// 폴더는 app_note_folders 행(migration 20261028170000, 폴더 안 폴더 100단), 노트가 어느 폴더에 있는지는 노트 metadata:
//   metadata.folder_id = 폴더 id(새 화면이 적음), metadata.folder = 폴더 이름(옛 화면·되돌리기 대비, 늘 함께 적음).
// folder_id가 없는 노트(이 표가 생기기 전 노트)는 이름이 같은 맨 위 폴더에 있는 것으로 본다(DB가 그 이름들을 맨 위 폴더로 옮겨 담음).
// 폴더 순서·깊이·옮길 곳 규칙은 자료실 폴더와 같은 함수(library-tree.js)를 그대로 쓰고, 숫자는 folder-limits.mjs 한 곳.
import {folderIndent} from './folder-limits.mjs';
import {folderSiblings, folderSubtree, folderDepth} from './library-tree.js';
import {plainInline} from './note-preview.mjs';

const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isFolderId = v => typeof v === 'string' && UUID.test(v);
export const OUTSIDE = 'out';

// 노트 → 폴더 id(없으면 null = 폴더 밖). folder_id가 적혀 있으면 그것만 본다(그 폴더가 없으면 폴더 밖).
export function noteFolderId(note, folders) {
  const meta = plain(note?.metadata) ? note.metadata : {};
  if (meta.folder_id !== undefined && meta.folder_id !== null) return isFolderId(meta.folder_id) && folders.some(f => f.id === meta.folder_id) ? meta.folder_id : null;
  const name = typeof meta.folder === 'string' ? meta.folder : '';
  if (!name) return null;
  return folders.filter(f => !f.parent_id && f.name === name).sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0))[0]?.id ?? null;
}

// 표가 아직 없을 때(DB 적용 전): 노트에 적힌 이름으로 맨 위 폴더만 읽기 전용으로 만든다(id는 'name:<이름>').
export function foldersFromNames(notes) {
  const names = [...new Set(notes.map(n => plain(n?.metadata) && typeof n.metadata.folder === 'string' ? n.metadata.folder.trim() : '').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  return names.map((name, i) => ({id: 'name:' + name, parent_id: null, name, sort_order: (i + 1) * 1024, legacy: true}));
}
export function noteFolderIdLegacy(note, folders) {
  const name = plain(note?.metadata) && typeof note.metadata.folder === 'string' ? note.metadata.folder.trim() : '';
  return name && folders.some(f => f.id === 'name:' + name) ? 'name:' + name : null;
}

// 노트 줄 제목: 직접 쓴 제목 → (AI 요약 제목 metadata.ai_title, 다음 단계) → 본문 첫 줄. 기호 없이 한 줄.
export function noteLineTitle(note) {
  const own = String(note?.title || '').trim();
  if (own) return own;
  const ai = plain(note?.metadata) && typeof note.metadata.ai_title === 'string' ? note.metadata.ai_title.trim() : '';
  if (ai) return ai;
  const first = String(note?.raw_text || '').split('\n').map(l => plainInline(l.replace(/^\s{0,3}(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+|>\s?)/, ''))).find(Boolean) || '';
  if (first) return first;
  const file = (note?.attachments || [])[0];
  return file ? String(file.name || file.title || '첨부') : '제목 없음';
}
// 날짜 칸: 올해면 '10.28', 다른 해면 '25.10.28'(서울 시간).
export function noteLineDate(value, now = new Date()) {
  const d = new Date(value); if (Number.isNaN(d.getTime())) return '';
  const part = date => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(date).map(p => [p.type, p.value]));
  const a = part(d), b = part(now);
  return a.year === b.year ? `${a.month}.${a.day}` : `${a.year.slice(2)}.${a.month}.${a.day}`;
}

// 폴더별 노트 수(아래 폴더 포함)와 폴더 → 노트 목록.
export function placeNotes(notes, folders, folderOf) {
  const byFolder = new Map([[null, []]]);
  for (const f of folders) byFolder.set(f.id, []);
  for (const n of notes) { const id = folderOf(n); (byFolder.get(id) || byFolder.get(null)).push(n); }
  const total = new Map();
  const count = id => { if (total.has(id)) return total.get(id); total.set(id, 0); let c = (byFolder.get(id) || []).length; for (const k of folderSiblings(folders, {free: true, parentId: id})) c += count(k.id); total.set(id, c); return c; };
  for (const f of folders) count(f.id);
  return {byFolder, total};
}

// 화면에 그릴 줄(한 화면 나무, 폰): 맨 위 폴더 → (열린 폴더면) 그 안 폴더·노트 들여쓰기 → 맨 아래 '폴더 밖' 노트.
// root: 들어간 폴더 id(null = 맨 위). isOpen(id): 그 폴더가 열려 있나. 닫힌 폴더 안은 만들지 않는다(폴더가 많아도 느려지지 않게).
// 찾는 중(query)이면 맞는 노트가 든 폴더만 열어 보인다. foldersOnly: PC 왼쪽 나무(노트 없이 폴더만).
export function treeRows({folders, notes, folderOf, root = null, isOpen = () => false, matches = null, foldersOnly = false, sort = list => list}) {
  const {byFolder, total} = placeNotes(notes, folders, folderOf);
  const hits = matches ? new Map() : null;
  if (matches) {
    const up = id => { for (let cur = id, guard = 0; cur && guard < 200; guard++) { hits.set(cur, (hits.get(cur) || 0) + 1); cur = folders.find(f => f.id === cur)?.parent_id || null; } };
    for (const n of notes) if (matches(n)) up(folderOf(n));
  }
  const rows = [];
  const walk = (parent, depth) => {
    for (const f of folderSiblings(folders, {free: true, parentId: parent})) {
      if (hits && !hits.has(f.id)) continue;
      const open = hits ? true : isOpen(f.id);
      rows.push({type: 'folder', id: f.id, name: f.name, depth, indent: folderIndent(depth), count: total.get(f.id) || 0, open, hasChildren: folderSiblings(folders, {free: true, parentId: f.id}).length > 0});
      if (open) walk(f.id, depth + 1);
    }
    if (foldersOnly) return;
    if (parent === null && root === null) return; // 맨 위의 '폴더 밖' 노트는 맨 아래 따로
    const own = sort((byFolder.get(parent) || []).filter(n => !matches || matches(n)));
    for (const n of own) rows.push({type: 'note', id: n.id, note: n, depth, indent: folderIndent(depth)});
  };
  walk(root, 0);
  if (root === null && !foldersOnly) {
    const out = sort((byFolder.get(null) || []).filter(n => !matches || matches(n)));
    if (out.length) {
      const open = matches ? true : isOpen(OUTSIDE);
      rows.push({type: 'outside', id: OUTSIDE, name: '폴더 밖', depth: 0, indent: 0, count: out.length, open});
      if (open) for (const n of out) rows.push({type: 'note', id: n.id, note: n, depth: 1, indent: 1});
    }
  }
  return rows;
}
// PC 오른쪽: 지금 폴더(null = 맨 위: 맨 위 폴더 + 폴더 밖 노트)의 바로 아래 폴더 + 그 폴더 노트.
export function folderContents({folders, notes, folderOf, at = null, matches = null, sort = list => list}) {
  const {byFolder, total} = placeNotes(notes, folders, folderOf);
  if (matches) {
    // 찾는 중이면 폴더와 상관없이 맞는 노트 전부(줄마다 폴더 경로).
    return sort(notes.filter(matches)).map(n => ({type: 'note', id: n.id, note: n, depth: 0, indent: 0, path: folderPath(folders, folderOf(n)).map(f => f.name).join(' › ')}));
  }
  const rows = folderSiblings(folders, {free: true, parentId: at}).map(f => ({type: 'folder', id: f.id, name: f.name, depth: 0, indent: 0, count: total.get(f.id) || 0, open: false}));
  for (const n of sort(byFolder.get(at) || [])) rows.push({type: 'note', id: n.id, note: n, depth: 0, indent: 0});
  return rows;
}
// 위치 줄: 맨 위부터 그 폴더까지(돌고 도는 값이 섞여도 200번에서 멈춤).
export function folderPath(folders, id) {
  const out = [], seen = new Set();
  for (let f = folders.find(x => x.id === id); f && !seen.has(f.id) && out.length < 200; f = f.parent_id ? folders.find(x => x.id === f.parent_id) : null) { seen.add(f.id); out.unshift(f); }
  return out;
}
// 폴더를 옮길 수 있나: 자기·자기 아래로는 안 됨(DB 트리거가 다시 지킴), 합친 깊이가 한도 안.
export function canMoveFolder(folders, id, to, limit) {
  if (!id || id === to) return false;
  if (to && folderSubtree(folders, id).has(to)) return false;
  const height = (function h(x, seen = new Set()) { if (seen.has(x)) return 0; seen.add(x); const kids = folders.filter(f => f.parent_id === x); return 1 + (kids.length ? Math.max(...kids.map(k => h(k.id, seen))) : 0); })(id);
  return (to ? folderDepth(folders, to) : 0) + height <= limit;
}
// DB 거절(23514 + NOTE_FOLDER_*)을 일상어로.
export function noteFolderErrorText(e) {
  const m = String(e?.message || '');
  if (/NOTE_FOLDER_DEPTH/.test(m)) { const n = /limited to (\d+) levels/.exec(m)?.[1]; return `폴더는 ${n || 100}단까지만 만들 수 있어요.`; }
  if (/NOTE_FOLDER_CYCLE/.test(m)) return '폴더를 자기 안으로 옮길 수 없어요.';
  if (/name_check|23514/.test(m)) return '폴더 이름은 1~40자로 써 주세요.';
  return '저장하지 못했어요. 잠시 뒤 다시 해 주세요.';
}
