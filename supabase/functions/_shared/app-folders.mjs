// S69-22(명진 11/24 08:54 "앱과 자동 수집이 쓰고 있는것좀 한 폴더에 몰아두면 안되니"):
// 서버가 사용자 드라이브에 만드는 앱 폴더를 '맨 위 앱 폴더'(app_drive_settings.root_folder_id — 명진 '웹2', 새 사용자 'WORK ON+') 한 곳 아래로 모은다.
//
// 규칙(이 파일 하나가 기준):
// - 맨 위 앱 폴더는 이름이 아니라 저장한 id(root_folder_id)로만 찾는다. 이름은 바꾸지 않는다(사용자 드라이브 존중).
// - 앱 폴더(바구니·백업·편집 백업·읽기용 사본)는 '내 드라이브 맨 위' 또는 '맨 위 앱 폴더 바로 아래' 둘 중 어디에 있어도 같은 폴더로 찾는다
//   (topParentsClause). 그래서 [앱 폴더 한곳에 모으기]로 옮긴 뒤에도 새 폴더를 또 만들지 않는다.
// - 찾기는 저장한 id(바구니 basket_folder_id) 또는 appProperties 표식(kptu_backup·kptu_summary·kptu_app_folder)으로.
//   표식이 없는 옛 폴더(편집 백업)만 이름으로 한 번 찾고, 찾으면 표식을 적어 둔다(다음부터는 표식).
// - 새로 만들 때는 맨 위 앱 폴더 id를 알면 그 아래, 모르면(자료실을 아직 안 쓴 새 사용자) 지금처럼 내 드라이브 맨 위
//   (createParentFor). 맨 위 앱 폴더를 이 함수들이 몰래 만들지는 않는다 — 맨 위 앱 폴더가 처음 생길 때 서버가 모은다
//   (S70-29, gather-folders.mjs gatherIntoNewRoot — 옛 [한곳으로 모으기] 버튼은 지움).
// - 앱 코드 밖(명진 Apps Script·PC 텔레그램 수집기)이 쓰는 폴더는 모으지 않는다(NOT_GATHERED — 옮기면 그쪽이 깨질 수 있음).
// - S69-41: [한곳으로 모으기]는 표식(또는 저장한 id)으로 알아본 앱 폴더의 옛 이름('Web2 바구니'·'노조+ 백업' 등)만 새 이름으로 바꾼다
//   (renameQuery·renameTarget). 사람이 직접 바꾼 이름·사람이 만든 폴더는 건드리지 않는다. 이름 글자는 brand-folders.mjs 한 곳.
// DOM·네트워크 없음(단위 시험 tests/app-folders.test.mjs).
import { FOLDER_NAMES, knownFolderNames, renameTo, rootRenameTo } from './brand-folders.mjs';

/** 드라이브 파일 id 모양(쿼리 글자 안에 그대로 넣어도 되는 글자만). 'root' 별칭은 id가 아니다. */
export const isDriveId = v => typeof v === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(v);

/** 표식 열쇠: 이 파일이 새로 붙이는 앱 폴더 표식(바구니·편집 백업). 기존 표식(kptu_backup·kptu_summary)은 그대로 쓴다. */
export const APP_FOLDER_MARK = 'kptu_app_folder';

/** 앱 폴더가 놓일 수 있는 부모: 내 드라이브 맨 위('root')와 맨 위 앱 폴더(들). */
export function topParents(rootIds) {
  const list = (Array.isArray(rootIds) ? rootIds : [rootIds]).filter(isDriveId);
  return ['root', ...new Set(list)];
}

/** Drive 검색(q)에 넣는 부모 조건: ('root' in parents or '<맨 위 앱 폴더>' in parents). */
export function topParentsClause(rootIds) {
  return '(' + topParents(rootIds).map(id => `'${id}' in parents`).join(' or ') + ')';
}

/** 새 앱 폴더를 만들 부모: 맨 위 앱 폴더 id를 알면 그것, 아니면 'root'(지금 동작). */
export const createParentFor = rootId => isDriveId(rootId) ? rootId : 'root';

/** 폴더의 부모 목록이 '맨 위 또는 맨 위 앱 폴더 바로 아래'인지. rootIdOfDrive: 쿼리로 확인한 내 드라이브 맨 위 id(모르면 null). */
export function placedAtTop(parents, rootIds, rootIdOfDrive = null) {
  if (!Array.isArray(parents) || parents.length !== 1 || typeof parents[0] !== 'string') return false;
  const ok = new Set(topParents(rootIds).filter(id => id !== 'root'));
  if (isDriveId(rootIdOfDrive)) ok.add(rootIdOfDrive);
  return ok.has(parents[0]);
}

// ---- [앱 폴더 한곳에 모으기] 대상 표 --------------------------------------------------------------------------------
// 모두 '서버(앱)가 만든 폴더'. kind = 표식 값(새로 붙이는 것은 APP_FOLDER_MARK). names = 표식이 없는 옛 폴더를 찾을 이름(없으면 표식만).
export const GATHER_KINDS = Object.freeze([
  // _shared/drive-upload.ts 바구니 원본 폴더(저장한 id basket_folder_id, 첫 찾기만 이름)
  Object.freeze({ kind: 'basket', label: '바구니', mark: { key: APP_FOLDER_MARK, value: 'basket' }, names: knownFolderNames('basket') }),
  // record-backup '내 기록 백업' 맨 위(표식 kptu_backup=root)
  Object.freeze({ kind: 'record_backup', label: '기록 백업', mark: { key: 'kptu_backup', value: 'root' }, names: Object.freeze([]) }),
  // _shared/hwp-edit.ts 한글 덮어쓰기 전 사본(옛 폴더는 이름, 이제 표식 kptu_app_folder=edit_backup)
  Object.freeze({ kind: 'edit_backup', label: '편집 백업', mark: { key: APP_FOLDER_MARK, value: 'edit_backup' }, names: knownFolderNames('edit_backup') }),
  // drive-summary 읽기용 사본(표식 kptu_summary=folder + kptu_workspace=kptu-work)
  Object.freeze({ kind: 'copy', label: '읽기용 사본', mark: { key: 'kptu_summary', value: 'folder' }, names: Object.freeze([]) }),
]);

// 앱이 옮기지 않는 것(보고·안내용). 앱 코드 밖이 쓰거나 앱이 만들지 않은 것.
export const NOT_GATHERED = Object.freeze([
  Object.freeze({ name: 'Telegram업무자료', why: 'PC 텔레그램 수집기가 씀(저장소 밖 코드라 이름·위치로 찾는지 확인 불가) — 옮기면 수집이 깨질 수 있음' }),
  Object.freeze({ name: 'AI 업무수집', why: '명진 Apps Script(통화 전사·수집 점검)가 씀 — 저장소의 수집 코드는 폴더 주소(id)로 찾지만 실제 붙인 스크립트는 확인 불가' }),
  Object.freeze({ name: '음성 녹음 백업', why: '휴대폰 녹음 백업 앱·Apps Script가 씀(저장소 밖)' }),
  Object.freeze({ name: '요청함 문서·Apps Script 파일·web2-phone-key-백업', why: '앱이 만들지 않음. id로 쓰이니 명진이 손으로 옮겨도 됨' }),
]);

const quoted = name => String(name).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const markClause = m => `appProperties has { key='${m.key}' and value='${m.value}' }`;

/** 모으기 후보 찾기 쿼리: 내 드라이브 맨 위('root' in parents)에 있는 내 폴더 중 표식 또는 옛 이름이 맞는 것. */
export function gatherQuery() {
  const any = GATHER_KINDS.flatMap(k => [markClause(k.mark), ...k.names.map(n => `name = '${quoted(n)}'`)]);
  return `'root' in parents and 'me' in owners and trashed = false and mimeType = 'application/vnd.google-apps.folder' and (${any.join(' or ')})`;
}

/** 찾은 폴더 하나의 종류(표식 먼저, 없으면 이름). 읽기용 사본은 작업공간 표식까지 맞아야 한다. 모르면 null. */
export function gatherKindOf(file) {
  const props = file && typeof file.appProperties === 'object' && file.appProperties ? file.appProperties : {};
  for (const k of GATHER_KINDS) {
    if (props[k.mark.key] !== k.mark.value) continue;
    if (k.kind === 'copy' && props.kptu_workspace !== 'kptu-work') continue;
    return { kind: k.kind, marked: true };
  }
  for (const k of GATHER_KINDS) if (k.names.includes(file?.name)) return { kind: k.kind, marked: false };
  return null;
}

/** 옮길 때 같이 붙일 표식(표식이 없던 옛 폴더만). */
export function markFor(kind) {
  const k = GATHER_KINDS.find(x => x.kind === kind);
  return k && k.mark.key === APP_FOLDER_MARK ? { [k.mark.key]: k.mark.value } : null;
}

/** 맨 위 앱 폴더가 '나만 보는 폴더'인지(공유된 폴더 아래로 옮기면 안의 자료가 함께 공유되므로 옮기지 않는다). */
export function privateOwnedFolder(f) {
  return !!f && isDriveId(f.id) && f.mimeType === 'application/vnd.google-apps.folder' && f.ownedByMe === true && f.trashed === false &&
    Array.isArray(f.permissions) && f.permissions.length === 1 && f.permissions[0]?.type === 'user' && f.permissions[0]?.role === 'owner';
}

// ---- 바구니 폴더 알아보기(_shared/drive-upload.ts·basket-file-origin.ts가 함께 쓴다) -------------------------------------
// S69-41: 예전에는 이름('Web2 바구니')으로만 찾고 확인했다. 이제 표식(kptu_app_folder=basket) 또는 알려진 이름(옛·새)으로 찾고 확인한다.
// 그래서 [한곳으로 모으기]가 이름을 'WORK ON+ 바구니'로 바꾼 뒤에도 같은 폴더를 찾는다(저장한 id basket_folder_id가 먼저).
export const BASKET_MARK = Object.freeze({ key: APP_FOLDER_MARK, value: 'basket' });
export const BASKET_NAMES = knownFolderNames('basket');
/** Drive 검색(q)의 바구니 조건: (표식 또는 알려진 이름). */
export const basketFolderClause = () => '(' + [markClause(BASKET_MARK), ...BASKET_NAMES.map(n => `name = '${quoted(n)}'`)].join(' or ') + ')';
/** 폴더 하나가 바구니 폴더로 보이나(표식 또는 알려진 이름). 공유·자리 확인은 부르는 쪽이 따로 한다. */
export function isBasketFolder(f) {
  const props = f && typeof f.appProperties === 'object' && f.appProperties ? f.appProperties : {};
  return props[BASKET_MARK.key] === BASKET_MARK.value || BASKET_NAMES.includes(f?.name);
}

// ---- [한곳으로 모으기]의 이름 맞추기(S69-41) ----------------------------------------------------------------------------
/** 이름 맞추기 후보 찾기 쿼리: 맨 위 또는 맨 위 앱 폴더 바로 아래의 내 폴더 중 표식 또는 옛 이름이 맞는 것. */
export function renameQuery(rootId) {
  const any = GATHER_KINDS.flatMap(k => [markClause(k.mark), ...k.names.map(n => `name = '${quoted(n)}'`)]);
  return `${topParentsClause(rootId)} and 'me' in owners and trashed = false and mimeType = 'application/vnd.google-apps.folder' and (${any.join(' or ')})`;
}

/** 찾은 폴더 하나 → {kind, name: 새 이름, mark: 같이 붙일 표식|null} 또는 null(앱 폴더가 아니거나 이미 새 이름·사람이 바꾼 이름). */
export function renameTarget(file) {
  const k = gatherKindOf(file);
  if (!k || !FOLDER_NAMES[k.kind]) return null;
  const name = renameTo(k.kind, file?.name);
  return name ? { kind: k.kind, name, mark: k.marked ? null : markFor(k.kind) } : null;
}

// ---- 쓸 때 이름 맞추기(S69-42) ------------------------------------------------------------------------------------------
// 명진 11/24 15:49 "중단없이 꾸준히 … 폴더명을 바꿔서 기능이 고장나면 안되고": 기능(바구니·백업·편집 백업·읽기용 사본)이 앱 폴더를
// 저장한 id·표식으로 찾은 뒤, 그 폴더 이름이 옛 이름이면 새 이름으로 바꾼다. 이름(name)과 표식만 바꾸고 id·자리·안 파일은 그대로.
// 같은 자리(부모)에 새 이름 폴더가 이미 있으면 합치지 않고 그대로 둔다('dup'). 이름 바꾸기는 덤이다: 실패해도 부르는 기능은 그대로 간다.
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
// 드라이브가 준 id(쿼리·주소에 넣어도 되는 글자만). 'root' 별칭도 부모로는 받는다.
const SAFE_ID = /^[A-Za-z0-9_-]{1,200}$/;

/** 이 폴더(이름)의 새 이름. kind 'root'는 맨 위 앱 폴더(옛 기본 이름일 때만). 옛 이름이 아니면 null. */
export const renameNameFor = (kind, name) => kind === 'root' ? rootRenameTo(name) : renameTo(kind, name);

/** 같은 자리에 같은 이름 폴더가 있는지 묻는 Drive 검색(q). */
export const sameNameQuery = (name, parentId) =>
  `name = '${quoted(name)}' and '${quoted(parentId)}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`;

/**
 * drive(url, init) → Response(인증 머리말은 부르는 쪽이 붙인다). file: {id, name, parents?}. mark: 같이 붙일 표식(appProperties)|null.
 * 인증: drive가 init.headers에 Authorization을 더해 보낸다. dryRun: 바꾸지 않고 바꿀 수 있는지만('renamed'는 '바꿀 수 있음').
 * 답: 'renamed' | 'dup'(같은 자리에 새 이름이 이미 있음) | 'skip'(옛 이름 아님·id 모양 틀림) | 'failed'(드라이브 실패 — 다음에 쓸 때 다시).
 */
export async function renameIfOld({ drive, kind, file, mark = null, dryRun = false }) {
  const to = renameNameFor(kind, file?.name);
  if (!to || typeof file?.id !== 'string' || !SAFE_ID.test(file.id)) return 'skip';
  try {
    let parents = Array.isArray(file.parents) ? file.parents : null;
    if (!parents) {
      const r = await drive(`${DRIVE_FILES}/${encodeURIComponent(file.id)}?fields=id,parents`, {});
      const d = r?.ok ? await r.json().catch(() => null) : null;
      parents = d?.id === file.id && Array.isArray(d.parents) ? d.parents : null;
    }
    if (!parents || parents.length !== 1 || typeof parents[0] !== 'string' || !SAFE_ID.test(parents[0])) return 'failed';
    const p = new URLSearchParams({ q: sameNameQuery(to, parents[0]), spaces: 'drive', pageSize: '10', fields: 'incompleteSearch,files(id)' });
    const listed = await drive(`${DRIVE_FILES}?${p}`, {});
    const found = listed?.ok ? await listed.json().catch(() => null) : null;
    if (!found || !Array.isArray(found.files) || found.incompleteSearch === true) return 'failed';
    if (found.files.some(f => f?.id !== file.id)) return 'dup';
    if (dryRun) return 'renamed';
    const r = await drive(`${DRIVE_FILES}/${encodeURIComponent(file.id)}?fields=id,name`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mark ? { name: to, appProperties: mark } : { name: to }),
    });
    const d = r?.ok ? await r.json().catch(() => null) : null;
    return d?.id === file.id && d?.name === to ? 'renamed' : 'failed';
  } catch {
    return 'failed';
  }
}
