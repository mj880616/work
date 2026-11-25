// S69-67 WEEKLY-저장폴더(명진 11/24 20:12 "주간보고에서 한글파일 만들기를 하든, 내가 수정해서 올리기를 하든 그 파일은 공공팀, 주간보고 폴더로"):
// 주간 보고 [확정]으로 만든 파일과 [올리기]한 수정 최종본을 넣을 자료실 폴더를 정하는 규칙의 유일한 곳. 순수 함수만(화면·네트워크 없음).
// 폴더 이름·경로는 코드에 박지 않는다(AGENTS.md 5절). 폴더는 사람마다 서버에 저장(app_profiles.weekly_folder, migration 20261124203000).
// 처음 물을 때 권할 폴더는 이름이 아니라 '지난 주간보고 자료가 가장 많이 든 폴더'로 짐작한다(명진은 지난 확정본을 이미 그 폴더에 모아 둠).
// S70-11 WEEKLY-저장폴더나누기(명진 11/25 09:44 "주간보고 안에 … 주간보고, 팀 보고 취합 폴더 만들어놨어 관련 기능에서 파일 만들 때 알아서 저기 안에 넣어요"):
// 저장 폴더를 자료 종류별 둘로 나눈다 — 'personal'(내 주간 보고 = 개인 확정본) → weekly_folder, 'confirmed'(팀 보고 취합 = 팀 확정본) → weekly_team_folder
// (migration 20261125193000). 팀 칸이 아직 없는 서버면(legacy) 개인 쪽은 S69-67 그대로(두 종류 자료로 짐작, 다시 묻지 않음), 팀 쪽은 아무것도 안 함.
// 정해 둔 폴더 아래에 하위 폴더가 생겼고 그 종류의 바로 앞 자료가 그 하위 폴더 쪽에 있으면(사람이 지난 자료를 옮겨 둠) 다음 저장 때 한 번 다시 묻는다.
// [예]로 그 하위 폴더를 정하거나, [다른 폴더]로 원래 폴더를 다시 고르면(이번 자료가 원래 폴더에 들어가 '바로 앞 자료'가 됨) 다시 묻지 않는다.
// 시험: tests/weekly-save-folder-model.test.mjs
import {isFolderId, liveParent} from './org-files-folder-model.mjs';

export {isFolderId};
// 종류 → 내 프로필 칸 이름. 종류는 자료 분류 역할(document-categories.js CATEGORY_ROLE_KEYS)과 같은 글자다.
export const WEEKLY_FOLDER_COLUMNS = Object.freeze({personal: 'weekly_folder', confirmed: 'weekly_team_folder'});
export const isWeeklyKind = k => Object.hasOwn(WEEKLY_FOLDER_COLUMNS, k);
// 저장된 폴더 id가 지금 보이는 폴더(휴지통 제외)에 있을 때만 그 폴더. 없으면 null(다시 묻는다).
export const liveWeeklyFolder = (id, folders) => liveParent(id, folders);

const listOf = folders => (Array.isArray(folders) ? folders : []).filter(f => f && isFolderId(f.id));
// 폴더 id가 root 아래(root 자신 제외, 몇 단이든)에 있나. 고리가 있어도 멈춘다.
export function isInside(id, root, folders) {
  const list = listOf(folders), seen = new Set();
  if (!id || !root || id === root) return false;
  for (let f = list.find(x => x.id === id); f && !seen.has(f.id) && seen.size < 200; f = list.find(x => x.id === f.parent_id)) {
    seen.add(f.id);
    if (f.parent_id === root) return true;
  }
  return false;
}
export const hasChildFolders = (id, folders) => !!id && listOf(folders).some(f => f.parent_id === id);

// 권할 폴더: 지난 주간보고 자료(docIds, 방금 저장한 것 제외)가 든 폴더 중 가장 많은 것. min개 이상 들어 있고 같은 수 1등이 하나일 때만.
// within이 있으면 그 폴더 아래(하위 폴더들)만 센다. items = [{document_id, folder_id}], folders = 보이는 폴더 [{id,…}]. 반환 폴더 줄 | null.
export function guessWeeklyFolder({folders, items, docIds, skip = '', within = null, min = 2} = {}) {
  const list = listOf(folders), ids = new Set((docIds || []).filter(id => id && id !== skip));
  const count = new Map();
  for (const it of items || []) {
    if (!it || !ids.has(it.document_id) || !list.some(f => f.id === it.folder_id)) continue;
    if (within && !isInside(it.folder_id, within, list)) continue;
    count.set(it.folder_id, (count.get(it.folder_id) || 0) + 1);
  }
  let best = null, top = 0, tie = false;
  for (const [id, n] of count) { if (n > top) { best = id; top = n; tie = false; } else if (n === top) tie = true; }
  if (!best || top < min || tie) return null;
  return list.find(f => f.id === best) || null;
}

// 팀 보고 취합 이름으로 권하기(지난 팀 자료가 없을 때만): 내 주간 보고 폴더 곁(그 폴더에 하위 폴더가 있으면 그 아래, 없으면 그 부모 아래)의 폴더 중
// 이름에 '취합'이 든 것, 없으면 '팀'이 든 것이 하나뿐일 때 그 폴더. 내 주간 보고 폴더 자신은 뺀다. 이름 글자는 사람이 지은 폴더 이름을 읽기만 한다.
export function guessTeamByName({folders, personal = null} = {}) {
  const list = listOf(folders), mine = liveWeeklyFolder(personal, list);
  if (!mine) return null;
  const near = hasChildFolders(mine.id, list) ? mine.id : mine.parent_id;
  if (!near) return null;
  const pool = list.filter(f => f.id !== mine.id && isInside(f.id, near, list));
  for (const word of ['취합', '팀']) {
    const hit = pool.filter(f => String(f.name || '').includes(word));
    if (hit.length === 1) return hit[0];
    if (hit.length > 1) return null;
  }
  return null;
}

// 화면에 보일 폴더 길('02. 공공팀 › 주간보고'). 부모가 없거나(휴지통) 고리가 있으면 거기서 멈춘다.
export function folderPath(folder, folders) {
  const list = Array.isArray(folders) ? folders : [], names = [], seen = new Set();
  for (let f = folder; f && !seen.has(f.id) && names.length < 100; f = list.find(x => x?.id === f.parent_id)) { seen.add(f.id); names.unshift(String(f.name || '')); }
  return names.filter(Boolean).join(' › ');
}

// 이 종류의 바로 앞 자료(방금 저장한 것 제외)가 든 폴더 id. docIds는 새것부터.
export function lastFolderOf({items, docIds, skip = ''} = {}) {
  const at = new Map((items || []).filter(Boolean).map(it => [it.document_id, it.folder_id]));
  for (const id of docIds || []) if (id && id !== skip && at.has(id)) return at.get(id) || null;
  return null;
}

// 이 저장을 어디에 넣을지(S69-67 모양 그대로 — 부르는 쪽이 짐작을 넘김). saved = 저장된 폴더 id(null = 안 정함), off = 서버 칸이 아직 없음.
// 반환 {kind:'off'} 지금처럼 | {kind:'put', folder} 그 폴더에 | {kind:'ask', guess} 처음 한 번 묻기(guess = 권할 폴더|null).
export function planWeeklyFolder({off = false, saved = null, folders, guess = null} = {}) {
  if (off) return {kind: 'off'};
  const folder = liveWeeklyFolder(saved, folders);
  if (folder) return {kind: 'put', folder};
  return {kind: 'ask', guess: guess && liveWeeklyFolder(guess.id, folders) ? guess : null};
}

// S70-11: 종류별로 어디에 넣을지 한 번에 정한다.
// kind = 'personal'|'confirmed', saved = 그 종류 칸 값, personal = 내 주간 보고 칸 값(팀 이름 권하기의 기준), legacy = 팀 칸이 아직 없는 서버.
// docIds = 그 종류의 지난 자료 id(새것부터, legacy면 두 종류 모두), items = 그 자료들의 폴더 연결 줄, skip = 방금 저장한 자료.
// 반환 {kind:'off'} | {kind:'put', folder} | {kind:'ask', guess, again}(again = 정해 둔 폴더 아래 하위 폴더 때문에 다시 묻기).
export function planWeeklySave({kind = 'personal', saved = null, personal = null, legacy = false, folders, items, docIds, skip = ''} = {}) {
  if (!isWeeklyKind(kind) || (legacy && kind !== 'personal')) return {kind: 'off'};
  const list = listOf(folders), folder = liveWeeklyFolder(saved, list);
  if (folder) {
    if (legacy || !hasChildFolders(folder.id, list)) return {kind: 'put', folder};
    const last = lastFolderOf({items, docIds, skip});
    if (!last || !isInside(last, folder.id, list)) return {kind: 'put', folder};
    const guess = guessWeeklyFolder({folders: list, items, docIds, skip, within: folder.id, min: 1});
    return {kind: 'ask', guess: guess && !hasChildFolders(guess.id, list) ? guess : null, again: true};
  }
  let guess = guessWeeklyFolder({folders: list, items, docIds, skip});
  if (!legacy && guess && hasChildFolders(guess.id, list)) guess = guessWeeklyFolder({folders: list, items, docIds, skip, within: guess.id, min: 1}) || guess;
  if (!guess && kind === 'confirmed') guess = guessTeamByName({folders: list, personal});
  return {kind: 'ask', guess: guess || null, again: false};
}

// 안내 글. legacy(팀 칸 없는 서버)는 S69-67 글 그대로('주간 보고 파일'), 나뉜 뒤는 종류 이름('내 주간 보고'·'팀 보고 취합').
const NAME = Object.freeze({personal: '내 주간 보고', confirmed: '팀 보고 취합'});
export const WEEKLY_KIND_NAME = NAME;
// 받침에 맞춘 조사(는/은, 를/을). 종류 이름 끝 글자만 본다.
const batchim = w => { const c = String(w).slice(-1).charCodeAt(0) - 0xac00; return c >= 0 && c <= 11171 && c % 28 !== 0; };
const topic = kind => NAME[kind] + (batchim(NAME[kind]) ? '은' : '는');
const object = kind => NAME[kind] + (batchim(NAME[kind]) ? '을' : '를');
export const WEEKLY_FOLDER_TEXT = Object.freeze({
  ask: path => `주간 보고 파일을 ‘${path}’ 폴더에 모을까요?`,
  askPick: '주간 보고 파일을 모을 자료실 폴더를 선택할까요?',
  put: path => `주간 보고 파일을 ‘${path}’ 폴더에 넣었어요.`,
  chosen: path => `앞으로 주간 보고 파일은 ‘${path}’ 폴더에 넣어요.`,
  askKind: (kind, path) => `앞으로 ${topic(kind)} ‘${path}’ 폴더에 넣을까요?`,
  askPickKind: kind => `${object(kind)} 넣을 자료실 폴더를 선택할까요?`,
  putKind: (kind, path) => `${object(kind)} ‘${path}’ 폴더에 넣었어요.`,
  chosenKind: (kind, path) => `앞으로 ${topic(kind)} ‘${path}’ 폴더에 넣어요.`,
  menu: kind => `${NAME[kind]} 저장 폴더`,
  menuOn: (kind, name) => `이제 ${topic(kind)} ‘${name}’ 폴더에 넣어요 ·`,
  menuOff: (kind, name) => `‘${name}’ 폴더가 더 이상 ${NAME[kind]} 저장 폴더가 아니에요. 다음 저장 때 다시 물어요 ·`,
  menuFailed: '저장 폴더를 바꾸지 못했어요. 잠시 뒤 다시 해 주세요.',
  saveFailed: '저장 폴더를 저장하지 못했어요. 다시 시도해 주세요.',
  putFailed: '주간 보고 파일을 폴더에 넣지 못했어요. 자료실에서 옮겨 주세요.',
});
