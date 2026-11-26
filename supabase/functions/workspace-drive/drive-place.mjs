// S69-20 ①(사용자 11/24 08:44 "자료실에 자료들이 어디에 업로드되고 있는 거야? 왜 표시가 없지?"):
// 자료실 머리에 '구글 드라이브 · 웹2 › 자료실 열기 ↗' 한 줄을 보이기 위한 서버 쪽 판단(workspace-drive GET ?action=drive-place).
// - 폴더는 서버가 app_drive_settings에 적어 둔 id(library_folder_id)로만 찾는다(화면 값 안 씀).
// - 이름은 지금 드라이브에 있는 이름을 읽는다(사용자처럼 드라이브에서 이름을 바꿔도 그 이름). 폴더 이름·id만 읽고, 파일 내용은 열지 않는다.
// - 위로 거슬러 올라가며 이름을 모으되, 부모가 없는 폴더(= '내 드라이브' 자체)와 읽을 수 없는 폴더에서 멈춘다.
// - 아직 자료를 올린 적이 없거나(폴더 없음), 드라이브 연결이 없거나, 폴더가 지워졌으면 place:null(화면은 줄을 그리지 않음).
// DOM·네트워크 없음: 드라이브 읽기(getMeta)는 부르는 쪽이 넣는다(단위 시험 tests/library-drive-place.test.mjs).

export const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;
export const PLACE_DEPTH = 6;
export const folderUrl = id => `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`;
export const metaUrl = id => `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,parents,trashed,mimeType&supportsAllDrives=true`;
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** 요청 모양 검사: GET ?action=drive-place 하나만(다른 값은 받지 않음 — 폴더는 서버가 정한다). */
export function parsePlaceRequest(url) {
  const keys = [...url.searchParams.keys()];
  return keys.length === 1 && url.searchParams.get('action') === 'drive-place';
}

/**
 * libraryFolderId: app_drive_settings.library_folder_id(서버가 읽은 값). getMeta(id) → {id,name,parents,trashed,mimeType} 또는 null(읽을 수 없음).
 * 답: {folder_id, url, path:[맨 위 … 자료실]} 또는 null.
 */
export async function drivePlace(libraryFolderId, getMeta) {
  if (typeof libraryFolderId !== 'string' || !DRIVE_ID.test(libraryFolderId)) return null;
  const lib = await safeMeta(getMeta, libraryFolderId);
  if (!lib || lib.trashed === true || (lib.mimeType && lib.mimeType !== FOLDER_MIME)) return null;
  const path = [cleanName(lib.name) || '자료실'];
  let cur = lib;
  for (let depth = 1; depth < PLACE_DEPTH; depth++) {
    const parent = Array.isArray(cur.parents) ? cur.parents[0] : null;
    if (typeof parent !== 'string' || !DRIVE_ID.test(parent)) break;
    const meta = await safeMeta(getMeta, parent);
    // 부모가 없는 폴더는 '내 드라이브' 자체 — 경로에 넣지 않는다. 읽을 수 없는 폴더(권한 밖)에서도 멈춘다.
    if (!meta || !Array.isArray(meta.parents) || !meta.parents.length) break;
    path.unshift(cleanName(meta.name) || '폴더');
    cur = meta;
  }
  return { folder_id: libraryFolderId, url: folderUrl(libraryFolderId), path };
}

async function safeMeta(getMeta, id) {
  try {
    const m = await getMeta(id);
    return m && typeof m === 'object' && m.id === id ? m : null;
  } catch { return null; }
}
const cleanName = name => typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) : '';
