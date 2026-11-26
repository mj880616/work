// S71-02 MTG-회의자료폴더없애기(사용자 11/26 10:17 "회의별 폴더를 자료실 제자리로 옮기고 회의자료 폴더는 지워"):
// 회의 자료가 드는 구글 드라이브 자리 한 곳. meeting-files(회차 폴더)·meeting-transcribe('회의 녹음' 폴더)가 같이 쓴다.
//
// 규칙(이 파일 하나가 기준):
// - 새 회차 폴더와 '회의 녹음' 폴더는 자료실 드라이브 폴더(app_drive_settings.library_folder_id) 바로 아래에 만든다.
//   예전 '맨 위 앱 폴더/회의자료' 폴더(meetings_folder_id)는 새로 만들지 않는다. 칸은 지우지 않고(데이터 보존) 쓰기도 하지 않는다.
// - 자료실 폴더가 아직 없는 새 사용자는 자료실 폴더를 만드는 기존 길(library-files ensureLibrary: 맨 위 앱 폴더 → '자료실', 맞춤 표시 MIRROR_MARK)과
//   같은 모양으로 만든다. 맨 위 앱 폴더를 처음 만들면 부르는 쪽이 넣은 gather(앱 폴더 모으기, 최선만)를 한 번 부른다.
// - 저장한 폴더 id가 휴지통·없음이면 다시 만들고 설정을 고친다(회차 폴더 id·자료실 폴더 id). 드라이브에 묻는 수는
//   회차 올리기 한 번에 폴더 확인 한 번(저장한 회차 폴더가 살아 있으면 그것만). 새 회차·다시 만들 때만 자료실 확인이 한 번 더.
// - '회의 녹음'은 자료실 폴더 아래에서 이름으로 찾는다(같은 이름 폴더 중 가장 먼저 만든 것). 화면 자료실 맨 위 '회의 녹음' 폴더
//   (meeting-transcribe recordingLibraryFolder)와 드라이브 자리가 같아진다.
//   예전 자리('회의자료/회의 녹음')만 있는 사람은 그 폴더를 계속 쓴다(읽기만 — 녹음 조각·합친 녹음은 '이 폴더 바로 아래' 검사로 지우고 되살리므로
//   폴더 id가 바뀌면 진행 중인 녹음이 깨진다). 그 폴더를 자료실 아래로 옮기면(폴더 id 그대로) 다음부터 자료실 쪽에서 찾는다.
// - '회의 녹음' 폴더에는 앱 표식(appProperties kptu_meeting=recordings)을 붙인다. 드라이브 가져오기가 앱 표식 폴더 안은 빼므로
//   (library-files/drive-import.mjs appMarked) 녹음 조각·아직 저장하지 않은 녹음이 자료실 자료로 끌려 들어가지 않는다. 표식 없는 옛 폴더는 찾을 때 한 번 붙인다(실패해도 그냥 씀).
// - 다루는 값은 폴더 id·코드의 고정 이름뿐(파일 내용은 열지 않음).
// DOM·Deno 없음(단위 시험 tests/security/meeting-drive-place.test.mjs). drive = (url, init) => Response(토큰은 부르는 쪽이 붙임), db = 아래 모양.
import { ROOT_FOLDER_NAME } from './brand-folders.mjs';
import { MIRROR_MARK } from './library-mirror.mjs';

export const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const LIBRARY_FOLDER_NAME = '자료실';
export const RECORDING_FOLDER = '회의 녹음';
export const MEETING_MARK = 'kptu_meeting';
// 드라이브가 '이 앱은 그 폴더를 쓸 수 없음'으로 답하는 이유(_shared/drive-trash.ts와 같은 표). 이때는 없는 폴더로 보고 다시 만든다.
const GONE_REASONS = new Set(['forbidden', 'insufficientFilePermissions', 'appNotAuthorizedToFile', 'notFound']);

export const isDriveId = v => typeof v === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(v);

export class PlaceFail extends Error {
  constructor(stage) { super('meeting drive place ' + stage); this.stage = stage; }
}

async function reasonOf(r) {
  try { const d = await r.json(); const x = d?.error?.errors?.[0]?.reason; return typeof x === 'string' ? x : ''; } catch { return ''; }
}

/** 폴더가 살아 있나(휴지통 아님·폴더 맞음). 없음·이 앱이 못 씀 → false. 잠깐 실패(5xx·한도 등) → PlaceFail(다시 만들지 않음). */
export async function folderAlive(drive, id) {
  if (!isDriveId(id)) return false;
  let r;
  try { r = await drive(`${DRIVE_FILES}/${encodeURIComponent(id)}?fields=id,trashed,mimeType`, {}); }
  catch { throw new PlaceFail('drive_folder_check'); }
  if (r.status === 404) return false;
  if (r.status === 403 && GONE_REASONS.has(await reasonOf(r))) return false;
  if (!r.ok) throw new PlaceFail('drive_folder_check');
  const d = await r.json().catch(() => null);
  if (!d || d.id !== id || typeof d.trashed !== 'boolean') throw new PlaceFail('drive_folder_check');
  return d.trashed === false && d.mimeType === FOLDER_MIME;
}

export async function createFolder(drive, name, parent, appProperties = null) {
  const body = { name, mimeType: FOLDER_MIME, ...(parent ? { parents: [parent] } : {}), ...(appProperties ? { appProperties } : {}) };
  let r;
  try { r = await drive(`${DRIVE_FILES}?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw new PlaceFail('drive_folder_create'); }
  const d = await r.json().catch(() => null);
  if (!r.ok || !isDriveId(d?.id)) throw new PlaceFail('drive_folder_create');
  return d.id;
}

/** 폴더 바로 아래 같은 이름 폴더(휴지통 아님, 가장 먼저 만든 것) → {id, appProperties} | null. name은 코드의 고정 이름만. */
export async function findChildFolder(drive, parent, name) {
  if (!isDriveId(parent)) return null;
  const q = `'${parent}' in parents and name = '${name}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
  let r;
  try { r = await drive(`${DRIVE_FILES}?q=${encodeURIComponent(q)}&fields=files(id,appProperties)&pageSize=1&orderBy=createdTime`, {}); }
  catch { throw new PlaceFail('drive_folder_find'); }
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new PlaceFail('drive_folder_find');
  const f = d?.files?.[0];
  return isDriveId(f?.id) ? { id: f.id, appProperties: f.appProperties || null } : null;
}

async function markRecordings(drive, folder) {
  if (folder.appProperties?.[MEETING_MARK]) return;
  try {
    await drive(`${DRIVE_FILES}/${encodeURIComponent(folder.id)}?fields=id`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appProperties: { [MEETING_MARK]: 'recordings' } }),
    });
  } catch { /* 표식은 최선만 — 폴더는 그대로 쓴다 */ }
}

/**
 * 자료실 드라이브 폴더 id. 저장한 값이 없으면(새 사용자) 맨 위 앱 폴더 → '자료실'을 만들고 설정에 적는다.
 * verify=true면 저장한 값이 휴지통·없음인지 한 번 확인하고, 그러면 다시 만든다(맨 위 앱 폴더도 같은 확인).
 * ctx = { drive, db: { settings() → {root_folder_id, library_folder_id, meetings_folder_id}|null, save(patch) }, gather?(rootId) }
 */
export async function meetingLibraryFolder(ctx, { verify = true, settings } = {}) {
  const s = settings ?? (await ctx.db.settings()) ?? {};
  const lib = s.library_folder_id;
  if (isDriveId(lib) && (!verify || await folderAlive(ctx.drive, lib))) return lib;
  let root = isDriveId(s.root_folder_id) ? s.root_folder_id : null;
  // 자료실 폴더가 저장돼 있었는데 죽었으면 맨 위 앱 폴더도 확인한다(새 사용자처럼 저장값이 없으면 기존 길 그대로 확인 없이).
  if (root && isDriveId(lib) && !(await folderAlive(ctx.drive, root))) root = null;
  if (!root) {
    root = await createFolder(ctx.drive, ROOT_FOLDER_NAME, null);
    await ctx.db.save({ root_folder_id: root });
    try { await ctx.gather?.(root); } catch { /* 모으기는 최선만 */ }
  }
  const made = await createFolder(ctx.drive, LIBRARY_FOLDER_NAME, root, { [MIRROR_MARK]: '1' });
  await ctx.db.save({ library_folder_id: made });
  return made;
}

/**
 * 회의 회차 폴더 id. round = { get() → 저장한 폴더 id|null, save(id) }, label = 회차 폴더 이름.
 * 저장한 회차 폴더가 살아 있으면 그것(드라이브 확인 한 번). 아니면 자료실 폴더 바로 아래 새로 만들고 저장한다.
 */
export async function meetingRoundFolder(ctx, { round, label }) {
  const stored = await round.get();
  if (isDriveId(stored) && await folderAlive(ctx.drive, stored)) return stored;
  const parent = await meetingLibraryFolder(ctx, { verify: true });
  const id = await createFolder(ctx.drive, label, parent);
  await round.save(id);
  return id;
}

/**
 * '회의 녹음' 폴더 id(자료실 폴더 바로 아래). create=false면 없을 때 null.
 * 찾는 차례: 자료실 아래 → 예전 자리('회의자료' 아래, 읽기만) → (create) 자료실 아래 새로 만들기(자료실이 죽었으면 자료실부터 다시).
 */
export async function meetingRecordingFolder(ctx, { create }) {
  const s = (await ctx.db.settings()) ?? {};
  if (isDriveId(s.library_folder_id)) {
    const found = await findChildFolder(ctx.drive, s.library_folder_id, RECORDING_FOLDER);
    if (found) { await markRecordings(ctx.drive, found); return found.id; }
  }
  if (isDriveId(s.meetings_folder_id)) {
    const old = await findChildFolder(ctx.drive, s.meetings_folder_id, RECORDING_FOLDER);
    if (old) return old.id;
  }
  if (!create) return null;
  const lib = await meetingLibraryFolder(ctx, { verify: true, settings: s });
  return await createFolder(ctx.drive, RECORDING_FOLDER, lib, { [MEETING_MARK]: 'recordings' });
}
