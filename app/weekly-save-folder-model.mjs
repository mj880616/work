// S69-67 WEEKLY-저장폴더(명진 11/24 20:12 "주간보고에서 한글파일 만들기를 하든, 내가 수정해서 올리기를 하든 그 파일은 공공팀, 주간보고 폴더로"):
// 주간 보고 [확정]으로 만든 파일과 [올리기]한 수정 최종본을 넣을 자료실 폴더를 정하는 규칙의 유일한 곳. 순수 함수만(화면·네트워크 없음).
// 폴더 이름·경로는 코드에 박지 않는다(AGENTS.md 5절). 폴더는 사람마다 서버에 저장(app_profiles.weekly_folder, migration 20261124203000).
// 처음 물을 때 권할 폴더는 이름이 아니라 '지난 주간보고 자료가 가장 많이 든 폴더'로 짐작한다(명진은 지난 확정본을 이미 그 폴더에 모아 둠).
// 시험: tests/weekly-save-folder-model.test.mjs
import {isFolderId, liveParent} from './org-files-folder-model.mjs';

export {isFolderId};
// 저장된 폴더 id가 지금 보이는 폴더(휴지통 제외)에 있을 때만 그 폴더. 없으면 null(다시 묻는다).
export const liveWeeklyFolder = (id, folders) => liveParent(id, folders);

// 권할 폴더: 지난 주간보고 자료(docIds, 방금 저장한 것 제외)가 든 폴더 중 가장 많은 것. 2개 이상 들어 있고 같은 수 1등이 하나일 때만.
// items = [{document_id, folder_id}], folders = 보이는 폴더 [{id,…}]. 반환 폴더 줄 | null.
export function guessWeeklyFolder({folders, items, docIds, skip = ''} = {}) {
  const list = Array.isArray(folders) ? folders : [], ids = new Set((docIds || []).filter(id => id && id !== skip));
  const count = new Map();
  for (const it of items || []) {
    if (!it || !ids.has(it.document_id) || !list.some(f => f?.id === it.folder_id)) continue;
    count.set(it.folder_id, (count.get(it.folder_id) || 0) + 1);
  }
  let best = null, top = 0, tie = false;
  for (const [id, n] of count) { if (n > top) { best = id; top = n; tie = false; } else if (n === top) tie = true; }
  if (!best || top < 2 || tie) return null;
  return list.find(f => f.id === best) || null;
}

// 화면에 보일 폴더 길('02. 공공팀 › 주간보고'). 부모가 없거나(휴지통) 고리가 있으면 거기서 멈춘다.
export function folderPath(folder, folders) {
  const list = Array.isArray(folders) ? folders : [], names = [], seen = new Set();
  for (let f = folder; f && !seen.has(f.id) && names.length < 100; f = list.find(x => x?.id === f.parent_id)) { seen.add(f.id); names.unshift(String(f.name || '')); }
  return names.filter(Boolean).join(' › ');
}

// 이 저장을 어디에 넣을지. saved = 저장된 폴더 id(null = 안 정함), off = 서버 칸이 아직 없음.
// 반환 {kind:'off'} 지금처럼 | {kind:'put', folder} 그 폴더에 | {kind:'ask', guess} 처음 한 번 묻기(guess = 권할 폴더|null).
export function planWeeklyFolder({off = false, saved = null, folders, guess = null} = {}) {
  if (off) return {kind: 'off'};
  const folder = liveWeeklyFolder(saved, folders);
  if (folder) return {kind: 'put', folder};
  return {kind: 'ask', guess: guess && liveWeeklyFolder(guess.id, folders) ? guess : null};
}

export const WEEKLY_FOLDER_TEXT = Object.freeze({
  ask: path => `주간 보고 파일을 ‘${path}’ 폴더에 모을까요?`,
  askPick: '주간 보고 파일을 모을 자료실 폴더를 선택할까요?',
  put: path => `주간 보고 파일을 ‘${path}’ 폴더에 넣었어요.`,
  chosen: path => `앞으로 주간 보고 파일은 ‘${path}’ 폴더에 넣어요.`,
  saveFailed: '저장 폴더를 저장하지 못했어요. 다시 시도해 주세요.',
  putFailed: '주간 보고 파일을 폴더에 넣지 못했어요. 자료실에서 옮겨 주세요.',
});
