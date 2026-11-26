// S69-69 LIB-사각형폴더(사용자 11/24 20:18 "이렇게 드래그하면 다 선택이 돼야하는데"): 자료실 사각형 고르기가 폴더 줄도 폴더째 고른다.
// 고른 상태의 주인은 그대로 선택 모드(select-mode.js luPick) 하나 — 자료는 자료 id, 폴더는 'F:폴더 id' 열쇠로 같은 Set에 넣는다.
// 폴더째 하는 일: [폴더로 옮기기](폴더째 옮김)·[삭제](폴더째 휴지통). 폴더에 맞지 않는 일(분류·사업영역·담당조직 바꾸기)은 그 안 자료에(폴더 칸 네모 고르기와 같은 묶음).
// 화면 없이 시험하는 순수 함수만 둔다(tests/library-pick-folders.test.mjs).
import {folderFileText} from './folder-count.mjs';
import {pickCountText} from './library-twins.mjs';

export const PICK_FOLDER = 'F:';
export const isFolderPick = k => typeof k === 'string' && k.startsWith(PICK_FOLDER);
export const folderPick = id => PICK_FOLDER + id;

// 고른 열쇠 → {docs: 자료 id들, folders: 폴더 id들}(차례 그대로).
export function splitPicks(items) {
  const docs = [], folders = [];
  for (const k of items || []) (isFolderPick(k) ? folders : docs).push(isFolderPick(k) ? k.slice(PICK_FOLDER.length) : k);
  return {docs, folders};
}

// 고른 폴더 중 있는 폴더만, 위 폴더도 함께 고른 것은 뺀다(위 폴더를 옮기거나 지우면 함께 가므로 두 번 하지 않는다).
export function topPicked(folders, ids) {
  const by = new Map((folders || []).map(f => [f.id, f])), set = new Set(ids || []);
  return [...set].filter(id => {
    if (!by.has(id)) return false;
    for (let p = by.get(id).parent_id, g = 0; p && g < 200; p = by.get(p)?.parent_id, g++) if (set.has(p)) return false;
    return true;
  });
}

// 위 막대 개수 글자: 폴더가 없으면 지금 말투('N개 선택됨'), 있으면 폴더 줄 개수와 같은 말투('폴더 N · 파일 M 선택됨', 파일이 없으면 '폴더 N 선택됨').
export function pickCountLabel(folderCount, docCount, hidden = 0) {
  if (!(folderCount > 0)) return pickCountText(docCount, hidden);
  const base = `${folderFileText(folderCount, docCount)} 선택됨`;
  return hidden > 0 ? `${base} — 접힌 ${hidden}개 포함` : base;
}

// 고른 폴더들을 함께 옮길 수 있는 곳: 고른 폴더나 그 아래가 아니고, 옮긴 뒤 폴더 단 제한(maxDepth)을 넘지 않는 폴더.
// free=false(사업영역 묶기)면 고른 폴더들과 같은 사업영역 틀 안으로만.
// 반환 {ok(id): 그 폴더 안으로 옮길 수 있나, top: 맨 위로 옮길 수 있나(하나라도 위 폴더가 있으면)}.
export function folderMoveOk(folders, ids, {maxDepth = 100, free = true} = {}) {
  const list = folders || [], by = new Map(list.map(f => [f.id, f]));
  const picked = (ids || []).filter(id => by.has(id));
  const kids = new Map();
  for (const f of list) { const p = f.parent_id || null; if (!kids.has(p)) kids.set(p, []); kids.get(p).push(f.id); }
  const inside = new Set();
  const height = (id, g = 0) => { let h = 1; if (g < 200) for (const c of kids.get(id) || []) h = Math.max(h, 1 + height(c, g + 1)); return h; };
  const mark = id => { if (inside.has(id)) return; inside.add(id); for (const c of kids.get(id) || []) mark(c); }; // 이미 본 것은 다시 보지 않아 돌고 도는 일이 없다
  picked.forEach(mark);
  const depth = id => { let d = 0; for (let f = by.get(id), g = 0; f && g < 200; f = f.parent_id ? by.get(f.parent_id) : null, g++) d++; return d; };
  const tall = Math.max(0, ...picked.map(height));
  const frames = new Set(picked.map(id => by.get(id).project_id || null));
  const frameOk = id => free || (frames.size === 1 && frames.has(by.get(id)?.project_id || null));
  return {
    ok: id => by.has(id) && !inside.has(id) && frameOk(id) && depth(id) + tall <= maxDepth,
    top: (free || frames.size === 1) && picked.some(id => by.get(id).parent_id),
  };
}
