// SHARE-노트로(2026-11-28 19:01 사용자 결정 "공유한 글이 들어갈 폴더는 만들어 하나 '공유한 글' 폴더"):
// 폰 [공유]로 들어오는 새 노트가 들어갈 노트 폴더 하나를 정한다. 폴더는 이름으로 찾지 않는다 — 처음 공유 때 '공유한 글'을 한 번 만들고
// 그 폴더 id를 사람별 서버 화면 기억(view_prefs.share_folder, migration 20261128190000)에 둔다. 사용자가 이름을 바꾸거나 옮겨도 그 폴더로,
// 지워졌으면 다시 만든다. 저장소는 기존 것만 쓴다: 폴더 = note-folders-data.js(app_note_folders, owner RLS), 기억 = view-prefs.js(내 프로필 행).
// 순서: 새 id를 먼저 기억에 저장하고, 서버가 받았을 때만 그 id로 폴더를 만든다. 검사가 아직 그 칸을 모르는 서버(DB 적용 전)는 기억을 거절하므로
// 폴더를 만들지 않고 null(= 폴더 밖)을 돌려준다 — 공유할 때마다 같은 이름 폴더가 쌓이지 않는다. 기기 저장 없음.
export const SHARE_FOLDER_NAME = '공유한 글';
export const SHARE_FOLDER_KEY = 'share_folder';
export const FOLDER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 기억한 id가 지금 폴더 표에 있으면 그 폴더(이름은 지금 이름), 없으면 null. */
export function rememberedFolder(folders, savedId) {
  if (typeof savedId !== 'string' || !FOLDER_ID_RE.test(savedId)) return null;
  return (Array.isArray(folders) ? folders : []).find(f => f?.id === savedId) || null;
}
/** 맨 위 단 맨 끝 순서(노트 화면의 새 폴더와 같은 셈: 맨 위 형제 중 가장 큰 값 + 1). */
export const topOrder = folders => Math.max(-1, ...(Array.isArray(folders) ? folders : []).filter(f => !f?.parent_id).map(f => (Number.isFinite(f?.sort_order) ? f.sort_order : 0))) + 1;

/**
 * 공유 노트가 들어갈 폴더 {id, name} 또는 null(폴더 밖).
 * deps(시험용): readFolders() → {ready, folders}, createFolder({id, name, parent_id, sort_order}) → row, prefs {get, set, flush}, newId().
 */
export async function shareFolder({rt = globalThis.window?.KPTURuntime, deps = null} = {}) {
  const d = deps || await defaultDeps(rt);
  const read = await d.readFolders();
  if (!read?.ready) return null; // 폴더 표를 못 읽으면(적용 전·일시 실패) 폴더 밖
  const known = rememberedFolder(read.folders, d.prefs.get(SHARE_FOLDER_KEY));
  if (known) return {id: known.id, name: known.name};
  const id = d.newId();
  if (!FOLDER_ID_RE.test(id) || !d.prefs.set(SHARE_FOLDER_KEY, id, {rejectable: true})) return null;
  await d.prefs.flush();
  // 서버가 그 칸을 거절했으면 화면 기억이 이전 값으로 돌아간다(view-prefs.js 거절 처리). 그때는 폴더를 만들지 않는다.
  if (d.prefs.get(SHARE_FOLDER_KEY) !== id) return null;
  const row = await d.createFolder({id, name: SHARE_FOLDER_NAME, parent_id: null, sort_order: topOrder(read.folders)});
  return row?.id === id ? {id, name: row.name || SHARE_FOLDER_NAME} : null;
}

async function defaultDeps(rt) {
  const [{readNoteFolders, createNoteFolder}, {viewPrefs}] = await Promise.all([import('./note-folders-data.js'), import('./view-prefs.js')]);
  return {
    readFolders: () => readNoteFolders(rt),
    createFolder: row => createNoteFolder(row, rt),
    prefs: viewPrefs,
    newId: () => globalThis.crypto.randomUUID().toLowerCase(),
  };
}
