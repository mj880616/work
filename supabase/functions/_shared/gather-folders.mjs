// S69-22: 앱 폴더 한곳에 모으기 서버 쪽 판단.
// - S70-29(2026-11-25 명진 '다 없애 1회용 기능'·조사 문서 7번 '자동으로 바꿈', S69-22 '누를 때만' 결정을 명진이 바꿈):
//   내 프로필 [한곳으로 모으기] 버튼은 지웠다. 서버가 '맨 위 앱 폴더'를 처음 만들 때(ensureRoot — workspace-drive·library-files·meeting-files·
//   meeting-transcribe) gatherIntoNewRoot로 같은 모으기를 한 번 한다. 실패해도 그 기능(올리기 등)은 멈추지 않는다(최선만, 숫자만 기록).
//   workspace-drive POST ?action=gather-folders는 세기(dry_run — 내 프로필 칸의 위치 한 줄)만 남는다.
// - 옮기는 것: 내 드라이브 맨 위에 있는 '앱이 만든 폴더'(표 _shared/app-folders.mjs GATHER_KINDS)만. 맨 위 앱 폴더 바로 아래로.
// - 부모(parents)만 바꾼다: 폴더·파일 id와 링크는 그대로, 지우지 않음, 안의 파일은 건드리지 않음. 폴더·파일 내용은 열지 않는다(이름·id·표식만).
// - 맨 위 앱 폴더가 공유된 폴더면 옮기지 않는다(안의 자료가 함께 공유되므로). 표식이 없던 옛 폴더는 옮기면서 표식을 붙인다.
// - 한 번에 GATHER_MAX_MOVES개까지. 남으면 left > 0 — 화면이 다시 부른다(이어서 하기). 같은 요청을 또 보내도 이미 옮긴 것은 다시 찾지 않는다.
// - S69-41: 같은 누름에서 옛 이름도 맞춘다 — 맨 위 앱 폴더(옛 기본 이름일 때만)와, 맨 위·맨 위 앱 폴더 바로 아래에서 표식(또는 옛 이름)으로
//   알아본 앱 폴더의 옛 이름('Web2 바구니'·'노조+ 백업'·'노조+ 읽기용 사본' 등)을 새 이름으로. 이름(name)과 표식만 바꾸고 부모·내용은 그대로.
//   이미 새 이름이거나 사람이 바꾼 이름은 두고, 사람이 만든 폴더(표식도 옛 이름도 아님)는 쿼리에 걸리지 않는다. 표식이 없던 옛 폴더는 표식을 같이 붙인다.
// - S69-42: 이름 바꾸기는 기능이 쓸 때와 같은 부품(app-folders.mjs renameIfOld) 하나로 한다. 같은 자리에 새 이름 폴더가 이미 있으면
//   합치지 않고 두고 rename_dup으로 센다(세기 dry_run도 같은 확인을 해서 '바꿀 것'에 넣지 않는다).
// DOM·네트워크 없음: 드라이브 호출(drive)은 부르는 쪽이 넣는다(단위 시험 tests/app-folders.test.mjs).
import { gatherKindOf, gatherQuery, isDriveId, markFor, privateOwnedFolder, renameIfOld, renameQuery, renameTarget } from './app-folders.mjs';
import { ROOT_FOLDER_NAME, rootRenameTo } from './brand-folders.mjs';

export const GATHER_MAX_MOVES = 10;
export const RENAME_MAX = 10;
const GATHER_MAX_PAGES = 5;
const DRIVE = 'https://www.googleapis.com/drive/v3/files';

/** 요청 모양: POST ?action=gather-folders, 몸통 {} 또는 {dry_run:true}. 폴더 id 같은 다른 값은 받지 않는다(서버가 정함). */
export function parseGatherRequest(url, body) {
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1 || url.searchParams.get('action') !== 'gather-folders') return null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const extra = Object.keys(body).filter(k => k !== 'dry_run');
  if (extra.length) return null;
  if (body.dry_run !== undefined && typeof body.dry_run !== 'boolean') return null;
  return { dryRun: body.dry_run === true };
}

export class GatherError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

async function readJson(r) { return r && typeof r.json === 'function' ? await r.json().catch(() => null) : null; }

/** 내 드라이브 맨 위에 있는 모으기 후보(이름·id·종류만). */
export async function gatherCandidates(drive, rootId) {
  const found = [];
  const pages = new Set();
  let pageToken = '';
  for (let page = 0; page < GATHER_MAX_PAGES; page++) {
    const p = new URLSearchParams({ q: gatherQuery(), spaces: 'drive', pageSize: '100', orderBy: 'createdTime', fields: 'nextPageToken,incompleteSearch,files(id,name,parents,ownedByMe,appProperties)' });
    if (pageToken) p.set('pageToken', pageToken);
    const r = await drive(`${DRIVE}?${p}`, {});
    const d = r?.ok ? await readJson(r) : null;
    if (!d || !Array.isArray(d.files) || d.incompleteSearch === true) throw new GatherError(502, 'drive_list_failed');
    for (const f of d.files) {
      if (!isDriveId(f?.id) || f.id === rootId || f.ownedByMe !== true) continue;
      if (!Array.isArray(f.parents) || f.parents.length !== 1 || !isDriveId(f.parents[0])) continue;
      const k = gatherKindOf(f);
      if (k && !found.some(x => x.id === f.id)) found.push({ id: f.id, parent: f.parents[0], kind: k.kind, marked: k.marked });
    }
    pageToken = typeof d.nextPageToken === 'string' ? d.nextPageToken : '';
    if (!pageToken || pages.has(pageToken)) break;
    pages.add(pageToken);
  }
  return found;
}

/** 맨 위 앱 폴더 확인: 내 것·휴지통 아님·나만 봄. 이름은 확인창 글에만 쓴다. */
export async function checkAppRoot(drive, rootId) {
  if (!isDriveId(rootId)) throw new GatherError(409, 'app_root_missing');
  const r = await drive(`${DRIVE}/${encodeURIComponent(rootId)}?fields=id,name,mimeType,ownedByMe,trashed,permissions(type,role)`, {});
  const f = r?.ok ? await readJson(r) : null;
  if (!f || f.id !== rootId) throw new GatherError(409, 'app_root_unreadable');
  if (!privateOwnedFolder(f)) throw new GatherError(409, 'app_root_shared');
  return { id: rootId, name: typeof f.name === 'string' ? f.name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120) : '' };
}

const countKinds = list => list.reduce((a, x) => (a[x.kind] = (a[x.kind] || 0) + 1, a), {});

/** 이름 맞추기 후보(맨 위 또는 맨 위 앱 폴더 바로 아래, 내 폴더, 표식·옛 이름). 답: [{id, kind, name(새 이름), mark}]. */
export async function renameCandidates(drive, rootId) {
  const found = [];
  const pages = new Set();
  let pageToken = '';
  for (let page = 0; page < GATHER_MAX_PAGES; page++) {
    const p = new URLSearchParams({ q: renameQuery(rootId), spaces: 'drive', pageSize: '100', orderBy: 'createdTime', fields: 'nextPageToken,incompleteSearch,files(id,name,parents,ownedByMe,appProperties)' });
    if (pageToken) p.set('pageToken', pageToken);
    const r = await drive(`${DRIVE}?${p}`, {});
    const d = r?.ok ? await readJson(r) : null;
    if (!d || !Array.isArray(d.files) || d.incompleteSearch === true) throw new GatherError(502, 'drive_list_failed');
    for (const f of d.files) {
      if (!isDriveId(f?.id) || f.id === rootId || f.ownedByMe !== true) continue;
      const t = renameTarget(f);
      if (t && !found.some(x => x.id === f.id)) found.push({ id: f.id, ...t, from: f.name, parents: Array.isArray(f.parents) ? f.parents : null });
    }
    pageToken = typeof d.nextPageToken === 'string' ? d.nextPageToken : '';
    if (!pageToken || pages.has(pageToken)) break;
    pages.add(pageToken);
  }
  return found;
}

/** 이름 맞추기 한 차례(맨 위 앱 폴더 먼저, 그다음 후보 RENAME_MAX개). dryRun이면 세기만. 답: {renamed, failed, dup, left, rootName}. */
async function renameRound(drive, root, dryRun) {
  const out = { renamed: 0, failed: 0, dup: 0, left: 0, rootName: root.name };
  const add = (r, onRenamed) => { if (r === 'renamed') { out.renamed++; onRenamed?.(); } else if (r === 'dup') out.dup++; else if (r === 'failed') out.failed++; };
  if (rootRenameTo(root.name)) add(await renameIfOld({ drive, kind: 'root', file: { id: root.id, name: root.name }, dryRun }), () => { if (!dryRun) out.rootName = ROOT_FOLDER_NAME; });
  const renames = await renameCandidates(drive, root.id);
  const batch = dryRun ? renames : renames.slice(0, RENAME_MAX);
  for (const c of batch) add(await renameIfOld({ drive, kind: c.kind, file: { id: c.id, name: c.from, parents: c.parents }, mark: c.mark, dryRun }));
  out.left = renames.length - batch.length;
  return out;
}

/**
 * rootId: app_drive_settings.root_folder_id(서버가 읽은 값, 없으면 부르는 쪽이 먼저 만들어 넘김). dryRun: 세기만.
 * 답: {root_name, root_url, count, kinds, rename, rename_dup} (dry_run) 또는 {root_name, root_url, moved, failed, left, kinds, renamed, rename_failed, rename_left, rename_dup}.
 * 순서: 옮기기 → 이름 맞추기(맨 위 앱 폴더 먼저). 옮기기가 남았으면(left > 0) 이름 맞추기는 다음 부름에서 한다.
 */
export async function gatherFolders({ drive, rootId, dryRun = false }) {
  const root = await checkAppRoot(drive, rootId);
  const list = await gatherCandidates(drive, rootId);
  const root_url = `https://drive.google.com/drive/folders/${rootId}`;
  if (dryRun) {
    // 세기는 바꿀 수 있는 것만(같은 이름이 이미 있는 것·드라이브 확인 실패는 '바꿀 것'에서 뺀다 — 실패는 누를 때 다시 본다).
    const r = await renameRound(drive, root, true);
    return { root_name: root.name, root_url, count: list.length, kinds: countKinds(list), rename: r.renamed, rename_dup: r.dup };
  }
  const now = list.slice(0, GATHER_MAX_MOVES);
  let moved = 0, failed = 0;
  const done = [];
  for (const c of now) {
    const p = new URLSearchParams({ addParents: rootId, removeParents: c.parent, fields: 'id,parents' });
    const mark = c.marked ? null : markFor(c.kind);
    const r = await drive(`${DRIVE}/${encodeURIComponent(c.id)}?${p}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mark ? { appProperties: mark } : {}),
    }).catch(() => null);
    const d = r?.ok ? await readJson(r) : null;
    if (d?.id === c.id && Array.isArray(d.parents) && d.parents.length === 1 && d.parents[0] === rootId) { moved++; done.push(c); }
    else failed++;
  }
  const left = list.length - now.length;
  let renamed = 0, rename_failed = 0, rename_left = 0, rename_dup = 0, root_name = root.name;
  if (!left) {
    const r = await renameRound(drive, root, false);
    ({ renamed, failed: rename_failed, left: rename_left, dup: rename_dup } = r);
    root_name = r.rootName;
  }
  return { root_name, root_url, moved, failed, left, kinds: countKinds(done), renamed, rename_failed, rename_left, rename_dup };
}

export const NEW_ROOT_ROUNDS = 3; // 처음 만들 때 한 번에 이어서 부르는 수(한 번에 GATHER_MAX_MOVES개씩 — 보통 앱 폴더는 몇 개뿐).

/**
 * S70-29: 맨 위 앱 폴더를 방금 만들었을 때 서버가 저절로 한 번 모은다(옮기기 → 옛 이름 맞추기). 절대 throw하지 않는다.
 * drive: (url, init) => Response(토큰을 붙여 부르는 쪽이 만든다). 답: {moved, failed, renamed} 또는 null(맨 위 폴더 확인 실패 등).
 */
export async function gatherIntoNewRoot({ drive, rootId, rounds = NEW_ROOT_ROUNDS }) {
  if (!isDriveId(rootId) || typeof drive !== 'function') return null;
  const sum = { moved: 0, failed: 0, renamed: 0 };
  try {
    for (let i = 0; i < rounds; i++) {
      const r = await gatherFolders({ drive, rootId });
      sum.moved += r.moved; sum.failed += r.failed; sum.renamed += r.renamed;
      if ((!r.left && !r.rename_left) || (!r.moved && !r.renamed)) break;
    }
    return sum;
  } catch { return sum.moved || sum.renamed ? sum : null; }
}
