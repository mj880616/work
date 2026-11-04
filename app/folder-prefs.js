// FOLDER-순서·색 ③-2 (S49-50): [파일]·사진 폴더 화면이 함께 쓰는 색·순서 저장소 하나(같은 목적의 읽기·쓰기를 화면마다 따로 만들지 않음).
// 값의 주인은 서버 표 app_folder_prefs. 여기는 화면이 그릴 때 바로 묻는 읽기 사본(Map)과, 바꾸면 서버에 쓰고 사본을 고치는 두 가지뿐이다(기기 저장 없음).
// 다른 화면·기기가 바꾼 것은 화면을 열 때·창으로 돌아올 때 load()로 다시 읽어 같아진다.
import {prefsMapFrom, prefKey, prefStepPlan, colorOf, orderByPrefs} from './folder-look-model.mjs';
import {readFolderPrefs, applyFolderPrefs} from './folder-prefs-data.js';
let map = new Map(), scope = '', listeners = new Set();
const ctx = rt => { const c = rt?.context?.read?.(); return {scope: `${c?.user?.id || ''}:${c?.workspace?.id || ''}`, ws: c?.workspace?.id || ''}; };
const emit = () => { for (const fn of [...listeners]) try { fn(); } catch { /* 한 화면의 그리기 실패가 다른 화면을 막지 않는다 */ } };
export const folderLook = {
  color: (source, key) => colorOf({color: map.get(prefKey(source, key))?.color}),
  order: (source, key) => map.get(prefKey(source, key))?.sort_order ?? null,
  // 형제 목록을 정한 순서대로(없는 폴더는 원래 순서 뒤). getKey = 그 줄의 폴더 id.
  sort: (source, list, getKey) => orderByPrefs(list, row => map.get(prefKey(source, getKey(row)))?.sort_order ?? null),
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  // 서버에서 다시 읽는다. 바뀐 것이 있으면 true(구독 화면이 다시 그린다). 읽기 실패는 지금 사본을 그대로 둔다.
  async load(rt = window.KPTURuntime) {
    const c = ctx(rt);
    if (!c.ws) return false;
    if (c.scope !== scope) { map = new Map(); scope = c.scope; }
    try {
      const next = prefsMapFrom(await readFolderPrefs(rt.api, c.ws));
      const same = next.size === map.size && [...next].every(([k, v]) => map.get(k)?.color === v.color && map.get(k)?.sort_order === v.sort_order);
      if (same) return false;
      map = next; emit(); return true;
    } catch { return false; }
  },
  async setColor(rt, source, key, color) {
    const c = ctx(rt);
    if (!c.ws) throw new Error('작업공간을 확인하지 못했어요.');
    if (folderLook.color(source, key) === color) return false; // 이미 그 색이면 저장하지 않는다
    await applyFolderPrefs(rt.api, c.ws, source, [{k: key, c: color}]);
    const was = map.get(prefKey(source, key)) || {color: null, sort_order: null};
    map = new Map(map).set(prefKey(source, key), {...was, color}); emit();
    return true;
  },
  // 한 칸 위(-1)·아래(+1). keys = 지금 보이는 형제 열쇠 순서. 움직일 곳이 없으면 false.
  async step(rt, source, keys, key, dir) {
    const c = ctx(rt);
    if (!c.ws) throw new Error('작업공간을 확인하지 못했어요.');
    const plan = prefStepPlan(keys, key, dir, k => folderLook.order(source, k));
    if (!plan.length) return false;
    await applyFolderPrefs(rt.api, c.ws, source, plan);
    const next = new Map(map);
    for (const p of plan) next.set(prefKey(source, p.k), {color: next.get(prefKey(source, p.k))?.color ?? null, sort_order: p.o});
    map = next; emit();
    return true;
  }
};
