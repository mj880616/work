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
//   (createParentFor). 맨 위 앱 폴더를 이 함수들이 몰래 만들지는 않는다 — 나중에 [모으기]가 옮긴다.
// - 앱 코드 밖(명진 Apps Script·PC 텔레그램 수집기)이 쓰는 폴더는 모으지 않는다(NOT_GATHERED — 옮기면 그쪽이 깨질 수 있음).
// DOM·네트워크 없음(단위 시험 tests/app-folders.test.mjs).

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
  Object.freeze({ kind: 'basket', label: '바구니', mark: { key: APP_FOLDER_MARK, value: 'basket' }, names: Object.freeze(['Web2 바구니']) }),
  // record-backup '내 기록 백업' 맨 위(표식 kptu_backup=root)
  Object.freeze({ kind: 'record_backup', label: '기록 백업', mark: { key: 'kptu_backup', value: 'root' }, names: Object.freeze([]) }),
  // _shared/hwp-edit.ts 한글 덮어쓰기 전 사본(옛 폴더는 이름, 이제 표식 kptu_app_folder=edit_backup)
  Object.freeze({ kind: 'edit_backup', label: '편집 백업', mark: { key: APP_FOLDER_MARK, value: 'edit_backup' }, names: Object.freeze(['노조+ 편집 백업', 'WORK ON+ 편집 백업', 'Web2 편집 백업']) }),
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
