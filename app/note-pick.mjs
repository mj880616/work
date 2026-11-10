// FORGET-노트고르기(요청함 11/09 13:34, 시안 docs/design/mockups/forget-note-pick.html, 명진 13:37·13:38 결정): 잊지 말기 [노트] 창의
// '넣을 노트 고르기'의 순수 부분(화면·네트워크 없음, node --test로 시험). 줄은 노트 화면과 같은 폴더 나무(note-tree.mjs treeRows·recentRows)다.
import {treeRows, recentRows, noteFolderId} from './note-tree.mjs';

// 고르기 창 줄: {recent: 최근 노트(찾는 중에는 없음), tree: 폴더 나무 + 그 안 노트(찾는 중에는 맞는 노트가 든 폴더만 펼침)}.
// family: 가족 줄 — AI가 읽지 않는 노트(ai_export_allowed=false)만 보인다(서버 읽기도 같은 조건, 저장 함수도 다시 확인).
export function pickSections({notes = [], folders = [], query = '', open = new Set(), family = false, recent = 5} = {}) {
  const list = (Array.isArray(notes) ? notes : []).filter(n => n?.id && (!family || n.ai_export_allowed === false));
  const folderOf = n => noteFolderId(n, folders);
  const q = String(query || '').trim().toLowerCase();
  const matches = q ? n => `${n.title || ''}\n${n.metadata?.ai_title || ''}\n${n.raw_text || ''}`.toLowerCase().includes(q) : null;
  const tree = treeRows({folders, notes: list, folderOf, root: null, isOpen: id => open.has(id), matches});
  return {recent: q ? [] : recentRows({folders, notes: list, folderOf, count: recent}), tree};
}

// 고른 노트의 마지막 두 줄(흐리게 보여 어디에 붙는지 알게). 앞에 더 있으면 more=true.
export function tailLines(note, count = 2) {
  if (!note) return {lines: [], more: false};
  const lines = String(note.raw_text || '').split(/\r?\n/).map(v => v.trim()).filter(Boolean);
  return {lines: lines.slice(-count).map(v => [...v].slice(0, 120).join('')), more: lines.length > count};
}

// 노트가 든 폴더 이름(없으면 '').
export function folderNameOf(note, folders = []) {
  const id = noteFolderId(note, folders);
  return (id && folders.find(f => f.id === id)?.name) || '';
}
