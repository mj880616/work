// S69-25 LIB-드라이브에서가져오기(명진 11/24 09:22 "구글드라이브에는 있는데 자료실에는 없는거를 일단 잡동사니에 다 올려놔봐"):
// 자료실 맨 위 ⋯ [드라이브에서 가져오기]. 로그인한 사람의 자기 작업공간·자기 구글 연결로만 그 사람 드라이브의 '내 소유 파일'을 훑어,
// 자료실(app_documents)에 아직 없는 것만 목록으로 돌려주고, 선택한 것을 자료 행으로 등록한다.
//   - 파일 내용은 열지 않는다(이름·크기·수정일·종류·id·폴더 이름만). 드라이브에서 복사·다시 올리기·옮기기·지우기를 하지 않는다.
//   - 등록 = 같은 드라이브 파일 id로 자료 행 하나(app_documents insert). 받는 폴더(잡동사니)에 넣는 일은 기존 넣기 뒤 트리거
//     (app_documents_receive_folder, migration 20261111181000)가 한다. 드라이브 위치 맞추기는 S69-20 [드라이브 폴더 맞추기]가 맡는다.
//   - 제목·분류는 파일 이름으로만(AI 없음 — 많은 파일을 한꺼번에 넣으므로 비용 0, 내용도 읽지 않음).
//   - 빼는 것: 폴더 자체, 앱이 쓰는 폴더 안 파일(설정에 저장된 앱 폴더 id·앱 표식 kptu_*·앱 폴더 이름 표), 파일이 아닌 구글 형식
//     (바로가기·Apps Script·양식·사이트 등), 0바이트. 구글 문서·시트·슬라이드는 링크형 자료(크기 없음)로 넣는다.
//   - S70-69: 비밀값 파일·비밀값 보관 폴더 안 파일(secret)과 앱 임시 문서·운영 문서(app)도 뺀다(_shared/drive-hidden-files.mjs).
//     목록에 안 나오고(개수만 종류로), 가져오기 때도 다시 확인해 거절하며, 비밀값 보관 폴더는 고를 폴더 목록에도 없다.
// S69-25b(명진 11/24 09:43 "드라이브 전체가 아니라 드라이브 안에서 공공운수노조 폴더 안에 있는 것만"): 드라이브 전체가 아니라
//   화면에서 고른 드라이브 폴더 하나(하위 폴더 포함) 안만 훑는다. 고르는 목록은 '내 드라이브' 바로 아래 내 폴더(앱 폴더 빼고).
//   폴더 이름을 코드에 박지 않는다. 고른 폴더는 서버가 다시 확인하고(내 소유·폴더·휴지통 아님·앱 폴더 아님), 가져오기 때도
//   파일마다 그 폴더 안(하위 포함)인지 부모를 따라 올라가 확인한다(화면이 보낸 id를 믿지 않음). 마지막에 고른 폴더는 화면이 view_prefs.drive_import_folder에 기억.
// 순수 규칙 + 주입받은 입출력(admin·fetch)만. 시험: tests/security/library-files-drive-import.test.mjs.
import { folderNames, knownFolderNames } from '../_shared/brand-folders.mjs';
// S69-45: 드라이브 id가 달라도 내용(md5 + 크기)이 자료실 자료와 같으면 목록에 '이미 있음(같은 내용)'(기본 선택에서 뺌). 규칙 한 곳은 same-content.mjs.
import { fileKey, folderInfo, hashable, lookupKeys, markSame } from './same-content.mjs';
// S70-69: 비밀값 파일(서명 열쇠·비밀번호 메모 등)·비밀값 보관 폴더·앱 임시 문서·운영 문서는 서버에서 뺀다(공용 거름 한 곳).
import { hiddenReason, isSecretFolder } from '../_shared/drive-hidden-files.mjs';

export const FOLDER_MIME = 'application/vnd.google-apps.folder';
// 링크형으로 넣는 구글 형식(내려받기 대신 드라이브에서 열기).
export const LINK_MIMES = Object.freeze({
  'application/vnd.google-apps.document': '구글 문서',
  'application/vnd.google-apps.spreadsheet': '구글 시트',
  'application/vnd.google-apps.presentation': '구글 슬라이드',
});
// 앱이 만드는 폴더 이름(이 이름의 폴더 안은 통째로 뺀다). 앱 표식(appProperties kptu_*)이 없는 옛 폴더도 이름으로 잡는다.
export const APP_FOLDER_NAMES = Object.freeze([
  // S69-41: 이름 글자는 brand-folders.mjs 한 곳(옛 이름 + 새 이름 'WORK ON+ …')
  ...knownFolderNames('basket'), ...knownFolderNames('copy'),
  '원장 백업',
  ...knownFolderNames('record_backup'), ...knownFolderNames('edit_backup'), ...folderNames('photo_trash'),
]);
// 앱 설정(app_drive_settings)의 *_folder_id 중 '사람 자료'가 드는 자리라 빼지 않는 것.
//   library_folder_id = 웹2 자료실 폴더(여기 있는데 자료실에 없는 파일은 가져올 대상), root_folder_id = 그 위 폴더(프로젝트 폴더 등 사람 자료).
export const KEEP_SETTING_KEYS = Object.freeze(['library_folder_id', 'root_folder_id']);
// 개인 서류로 보이는 이름: 기본 체크 해제 + 한 줄 표시(명진이 선택하면 넣음).
export const PERSONAL_RE = /주민\s*등록|신분증|운전\s*면허|면허증|여권|passport|외국인\s*등록|가족\s*관계|등본|초본|통장\s*사본|인감|진단서|건강\s*보험|보험\s*증권|재직\s*증명|원천\s*징수|소득\s*금액/i;
export const MEDIA_RE = /^(image|video)\//;

export const LIST_PAGE_SIZE = 1000;
export const LIST_MAX_PAGES = 30; // 최대 3만 개(넘으면 partial)
export const ITEMS_MAX = 5000;    // 한 번에 돌려주는 목록 최대(넘으면 more)
export const ADD_MAX = 50;        // 가져오기 한 번에(화면이 나눠 보냄)
export const FOLDERS_MAX = 3000;  // 고른 폴더 아래 하위 폴더 최대(넘으면 partial)
export const PARENTS_PER_QUERY = 40; // 한 번 묻는 부모 폴더 수(q 글자 길이 제한 안쪽)
export const ANCESTOR_MAX = 30;   // 가져오기 때 위로 따라 올라가는 단계 최대
export const SAME_LOOKUP_MAX = 600; // S69-45: 같은 내용 확인으로 드라이브에 묻는 기존 자료 수(넘으면 same_partial)
const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;
export const isDriveId = v => typeof v === 'string' && DRIVE_ID.test(v);

export const appMarked = f => !!f && typeof f.appProperties === 'object' && f.appProperties !== null && Object.keys(f.appProperties).some(k => k.startsWith('kptu_'));
export const isPersonalName = name => PERSONAL_RE.test(String(name || '').normalize('NFKC'));

// 파일 하나의 종류: 'file' | 'link' | null(가져오지 않음). 이유는 skip 칸 이름.
export function fileKind(f) {
  const mime = String(f?.mimeType || '');
  if (mime === FOLDER_MIME) return { kind: null, skip: 'folder' };
  if (mime.startsWith('application/vnd.google-apps.')) return LINK_MIMES[mime] ? { kind: 'link' } : { kind: null, skip: 'not_file' };
  const size = Number(f?.size);
  if (!Number.isFinite(size) || size <= 0) return { kind: null, skip: 'empty' };
  return { kind: 'file' };
}

// 자료실에 이미 등록된 드라이브 id(지금 파일 + 교체로 남긴 옛 파일). 휴지통 자료도 '이미 있음'.
export function registeredIds(rows) {
  const out = new Set();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (isDriveId(r?.file_id)) out.add(r.file_id);
    for (const p of Array.isArray(r?.previous_files) ? r.previous_files : []) if (isDriveId(p?.file_id)) out.add(p.file_id);
  }
  return out;
}
// 앱 설정 행 → 빼야 할 앱 폴더 id(바구니·회의 폴더 등). 자료실·맨 위 폴더는 남긴다.
export function appFolderIdsFrom(settings) {
  const out = new Set();
  for (const [k, v] of Object.entries(settings && typeof settings === 'object' ? settings : {})) {
    if (k.endsWith('_folder_id') && !KEEP_SETTING_KEYS.includes(k) && isDriveId(v)) out.add(v);
  }
  return out;
}

// 드라이브 목록(폴더 포함) → 자료실에 없는 파일 목록. files: Drive files.list 결과(id,name,mimeType,size,modifiedTime,parents,appProperties).
// S69-25b: rootName이 있으면 rootId 폴더(고른 폴더) 아래만 — 경로 머리는 그 폴더 이름이고, 위로 따라가 rootId에 닿지 않는 파일은 뺀다(outside).
//   ownedByMe가 거짓인 파일(남이 내 폴더에 올린 것)은 뺀다(others) — 가져오기 때 다시 확인(checkAddable)과 같은 기준.
export function planImport({ files, registered = new Set(), appFolderIds = new Set(), rootId = null, rootName = null }) {
  const scoped = typeof rootName === 'string' && !!rootId;
  const all = Array.isArray(files) ? files.filter(f => isDriveId(f?.id)) : [];
  const folders = new Map(all.filter(f => f.mimeType === FOLDER_MIME).map(f => [f.id, f]));
  const appNames = new Set(APP_FOLDER_NAMES);
  const pathMemo = new Map();
  const parentOf = f => (Array.isArray(f?.parents) && isDriveId(f.parents[0]) ? f.parents[0] : null);
  // 이 폴더(또는 그 위)가 조건에 맞는가(위로 따라 올라가며, 같은 요청 안에서 기억).
  const upward = (match, memo) => id => {
    const seen = [];
    let cur = id, hit = false;
    for (let depth = 0; cur && depth < 60; depth++) {
      if (memo.has(cur)) { hit = memo.get(cur); break; }
      seen.push(cur);
      const f = folders.get(cur);
      if (match(cur, f)) { hit = true; break; }
      if (!f) break;
      cur = parentOf(f);
    }
    for (const s of seen) memo.set(s, hit);
    return hit;
  };
  // 앱 폴더 / 비밀값 보관 폴더(S70-69).
  const appFolder = upward((cur, f) => appFolderIds.has(cur) || !!(f && (appMarked(f) || appNames.has(String(f.name || '').trim()))), new Map());
  const secretFolder = upward((cur, f) => !!(f && isSecretFolder(f)), new Map());
  // 폴더 경로 글자(내 드라이브 › 가 › 나). 남의 폴더 안(목록에 없는 부모)은 '다른 사람 폴더'.
  const pathOf = id => {
    const top = scoped ? rootName : '내 드라이브';
    if (!id || id === rootId) return top;
    if (pathMemo.has(id)) return pathMemo.get(id);
    const names = [];
    let cur = id, head = top;
    for (let depth = 0; cur && depth < 60; depth++) {
      if (cur === rootId) break;
      const f = folders.get(cur);
      if (!f) { head = '다른 사람 폴더'; break; }
      names.unshift(String(f.name || '이름 없음'));
      cur = parentOf(f);
      if (!cur) break;
    }
    const p = [head, ...names].join(' › ');
    pathMemo.set(id, p);
    return p;
  };
  // 고른 폴더 아래인가(부모를 따라 올라가 rootId에 닿는가).
  const underMemo = new Map();
  const under = id => {
    const seen = [];
    let cur = id, hit = false;
    for (let depth = 0; cur && depth < 60; depth++) {
      if (cur === rootId) { hit = true; break; }
      if (underMemo.has(cur)) { hit = underMemo.get(cur); break; }
      seen.push(cur);
      const f = folders.get(cur);
      if (!f) break;
      cur = parentOf(f);
    }
    for (const s of seen) underMemo.set(s, hit);
    return hit;
  };
  const skipped = scoped ? { registered: 0, app: 0, secret: 0, not_file: 0, empty: 0, others: 0 } : { registered: 0, app: 0, secret: 0, not_file: 0, empty: 0 };
  const items = [];
  for (const f of all) {
    const k = fileKind(f);
    const parent = parentOf(f);
    if (scoped && !(Array.isArray(f.parents) && f.parents.some(p => isDriveId(p) && under(p)))) continue; // 고른 폴더 밖은 목록에 없음
    if (!k.kind) { if (k.skip !== 'folder') skipped[k.skip]++; continue; }
    if (scoped && f.ownedByMe === false) { skipped.others++; continue; }
    if (registered.has(f.id)) { skipped.registered++; continue; }
    const hidden = hiddenReason(f);
    if (hidden === 'secret' || (Array.isArray(f.parents) && f.parents.some(p => isDriveId(p) && secretFolder(p)))) { skipped.secret++; continue; }
    if (hidden === 'app' || appMarked(f) || (parent && appFolder(parent))) { skipped.app++; continue; }
    const name = String(f.name || '이름 없음');
    items.push({
      id: f.id, name, path: pathOf(scoped ? f.parents.find(p => isDriveId(p) && under(p)) : parent), kind: k.kind,
      size: k.kind === 'file' ? Number(f.size) : null,
      modified: typeof f.modifiedTime === 'string' ? f.modifiedTime.slice(0, 10) : null,
      personal: isPersonalName(name), media: MEDIA_RE.test(String(f.mimeType || '')),
    });
  }
  items.sort((a, b) => a.path.localeCompare(b.path, 'ko') || a.name.localeCompare(b.name, 'ko'));
  const more = items.length > ITEMS_MAX;
  return { items: more ? items.slice(0, ITEMS_MAX) : items, total: items.length, more, skipped };
}

// 가져오기 직전 파일 하나 다시 확인(화면이 보낸 id를 믿지 않음): 내 소유·휴지통 아님·파일 종류·0바이트·앱 표식·앱 폴더 바로 안
// ·S70-69 비밀값 파일·앱 임시 문서·운영 문서(비밀값 보관 폴더 안인지는 add의 위로 따라가기가 본다).
export function checkAddable(f, { registered, appFolderIds }) {
  if (!f || !isDriveId(f.id)) return 'unreadable';
  if (registered.has(f.id)) return 'exists';
  if (f.trashed === true || f.ownedByMe !== true) return 'unreadable';
  const k = fileKind(f);
  if (!k.kind) return 'unreadable';
  const parent = Array.isArray(f.parents) ? f.parents[0] : null;
  if (appMarked(f) || (parent && appFolderIds.has(parent))) return 'unreadable';
  if (hiddenReason(f)) return 'unreadable';
  return 'ok';
}

// S69-25b: 고를 수 있는 폴더인가(내 소유·폴더·휴지통 아님·앱 폴더 아님·S70-69 비밀값 보관 폴더 아님). 'ok' | 'invalid'.
export function checkFolder(f, { appFolderIds }) {
  if (!f || !isDriveId(f.id) || f.mimeType !== FOLDER_MIME || f.trashed === true || f.ownedByMe !== true) return 'invalid';
  if (appMarked(f) || appFolderIds.has(f.id) || APP_FOLDER_NAMES.includes(String(f.name || '').trim())) return 'invalid';
  if (isSecretFolder(f)) return 'invalid';
  return 'ok';
}
// 고르는 목록: '내 드라이브' 바로 아래 내 폴더(앱 폴더 빼고), 이름 순.
export function pickableFolders(list, { appFolderIds }) {
  const out = [];
  for (const f of Array.isArray(list) ? list : []) if (checkFolder(f, { appFolderIds }) === 'ok') out.push({ id: f.id, name: String(f.name || '이름 없음') });
  return out.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

// 드라이브 전체 권한(연결 때 drive.file과 함께 묻는 그 권한)만. drive.file뿐이면 앱이 만든 파일만 보여 목록을 못 만든다 → scope_missing.
// 새 권한을 묻지 않는다(처리방침 표·구글 동의 화면 그대로).
const SCOPE_FULL = 'https://www.googleapis.com/auth/drive';
export const scopeCanList = scope => typeof scope === 'string' && scope.split(/\s+/).includes(SCOPE_FULL);

// 입출력 묶음. deps: {admin, fetch, token, workspaceId, userId, titleFor(name), classify(text), log(code), db?(로그인한 사람 토큰 — 같은 내용 자료의 폴더 이름)}
export function createDriveImport(deps) {
  const { admin, token, workspaceId, userId } = deps;
  const request = deps.fetch ?? globalThis.fetch;
  const log = deps.log ?? (code => console.error('library-files drive-import', { code }));
  const DRIVE = 'https://www.googleapis.com/drive/v3/files';
  const auth = { Authorization: `Bearer ${token}` };
  class ImportFail extends Error { constructor(code, status = 503) { super(code); this.code = code; this.status = status; } }

  async function driveJson(stage, url, init = {}) {
    let r;
    try { r = await request(url, { ...init, headers: { ...auth, ...(init.headers || {}) } }); } catch { log(stage + '_network'); throw new ImportFail('drive_unavailable'); }
    let d = {};
    try { d = await r.json(); } catch { d = {}; }
    if (r.status === 404) return null;
    if (r.status === 401 || r.status === 403) { log(stage + '_' + r.status); throw new ImportFail(r.status === 401 ? 'drive_auth_expired' : 'drive_denied', 424); }
    if (!r.ok) { log(stage + '_' + r.status); throw new ImportFail('drive_unavailable'); }
    return d;
  }
  async function scopeOk() {
    let r;
    try {
      r = await request('https://oauth2.googleapis.com/tokeninfo', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ access_token: token }) });
    } catch { log('tokeninfo_network'); throw new ImportFail('drive_unavailable'); }
    if (!r.ok) { log('tokeninfo_' + r.status); throw new ImportFail('drive_unavailable'); }
    let d = {};
    try { d = await r.json(); } catch { d = {}; }
    return scopeCanList(d?.scope);
  }
  let docRows = [];
  async function readRegistered() {
    const rows = [];
    for (let from = 0; from < 200000; from += 1000) {
      const { data, error } = await admin.from('app_documents').select('id,title,file_name,file_id,file_size,mime_type,previous_files').eq('workspace_id', workspaceId).range(from, from + 999);
      if (error) { log('registered_read'); throw new ImportFail('db_read'); }
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    docRows = rows;
    return registeredIds(rows);
  }
  // S69-45: 목록 파일과 내용이 같은 자료 찾기. 목록에 나온 파일 크기와 같은(또는 크기를 모르는) 자료만 드라이브에 묻는다(내용 열지 않음).
  //   자료 경로(폴더 이름)는 로그인한 사람 토큰(db, owner RLS)으로 읽는다 — 없으면 '자료실'.
  async function sameIndex(items, files) {
    const listed = new Map(files.map(f => [f.id, fileKey(f)]));
    const sizes = new Set(items.filter(it => it.kind === 'file').map(it => Number(it.size)));
    if (!sizes.size) return { docIndex: new Map(), listed, partial: false };
    const want = docRows.filter(d => hashable(d) && !listed.has(d.file_id) && (!(Number(d.file_size) > 0) || sizes.has(Number(d.file_size))));
    const { keys, partial } = await lookupKeys(want.map(d => d.file_id), { fetch: request, token, log, max: SAME_LOOKUP_MAX });
    for (const [k, v] of listed) if (!keys.has(k)) keys.set(k, v);
    let info = null, itemOf = new Map();
    if (deps.db) {
      try {
        const [{ data: folders }, { data: items2 }] = await Promise.all([
          deps.db.from('app_library_folders').select('id,parent_id,name').eq('workspace_id', workspaceId).limit(5000),
          deps.db.from('app_library_folder_items').select('document_id,folder_id').eq('workspace_id', workspaceId).limit(50000),
        ]);
        info = folderInfo(folders || []);
        itemOf = new Map((items2 || []).map(r => [r.document_id, r.folder_id]));
      } catch { info = null; }
    }
    const docIndex = new Map();
    for (const d of docRows) {
      const k = hashable(d) ? keys.get(d.file_id) : null;
      if (!k || docIndex.has(k)) continue;
      const fid = itemOf.get(d.id) || null;
      const path = !info ? '자료실' : fid && !info.visible.has(fid) ? '자료실 휴지통' : '자료실 › ' + info.pathOf(fid);
      docIndex.set(k, { title: String(d.title || d.file_name || '자료'), path });
    }
    return { docIndex, listed, partial };
  }
  async function readAppFolders() {
    const { data, error } = await admin.from('app_drive_settings').select('*').eq('workspace_id', workspaceId).maybeSingle();
    if (error) { log('settings_read'); throw new ImportFail('db_read'); }
    return appFolderIdsFrom(data);
  }

  const FOLDER_FIELDS = 'id,name,mimeType,trashed,ownedByMe,appProperties';
  // 고른 폴더 다시 확인(화면이 보낸 id를 믿지 않음). 아니면 ImportFail('folder_invalid', 400).
  async function chosenFolder(folderId, appFolderIds) {
    const f = await driveJson('folder', `${DRIVE}/${encodeURIComponent(folderId)}?fields=${FOLDER_FIELDS}`);
    if (checkFolder(f, { appFolderIds }) !== 'ok') throw new ImportFail('folder_invalid', 400);
    return f;
  }

  // S69-25b: 고르는 목록 — '내 드라이브' 바로 아래 내 폴더(앱 폴더 빼고).
  async function folders() {
    if (!(await scopeOk())) return { ok: false, code: 'scope_missing' };
    const appFolderIds = await readAppFolders();
    const list = [];
    let pageToken = '';
    for (let page = 0; page < 5; page++) {
      const p = new URLSearchParams({
        q: `'root' in parents and mimeType = '${FOLDER_MIME}' and 'me' in owners and trashed = false`, spaces: 'drive', corpora: 'user', pageSize: String(LIST_PAGE_SIZE),
        fields: `nextPageToken,files(${FOLDER_FIELDS})`,
      });
      if (pageToken) p.set('pageToken', pageToken);
      const d = await driveJson('folders', `${DRIVE}?${p}`);
      if (Array.isArray(d?.files)) list.push(...d.files);
      pageToken = typeof d?.nextPageToken === 'string' ? d.nextPageToken : '';
      if (!pageToken) break;
    }
    return { ok: true, folders: pickableFolders(list, { appFolderIds }) };
  }

  // 고른 폴더 아래(하위 포함)만 훑는다: 부모 폴더 몇십 개씩 묶어 그 바로 아래를 묻고, 나온 폴더를 다음 차례에 묻는다.
  async function list(folderId) {
    if (!(await scopeOk())) return { ok: false, code: 'scope_missing' };
    const [registered, appFolderIds] = await Promise.all([readRegistered(), readAppFolders()]);
    const top = await chosenFolder(folderId, appFolderIds);
    const files = [], seen = new Set([top.id]);
    let queue = [top.id], partial = false, pages = 0;
    while (queue.length) {
      const batch = queue.slice(0, PARENTS_PER_QUERY);
      queue = queue.slice(PARENTS_PER_QUERY);
      let pageToken = '';
      for (;;) {
        if (pages >= LIST_MAX_PAGES) { partial = true; queue = []; break; }
        pages++;
        // id는 isDriveId로 이미 걸렀다(따옴표·공백 없음).
        const p = new URLSearchParams({
          q: `(${batch.map(x => `'${x}' in parents`).join(' or ')}) and trashed = false`, spaces: 'drive', corpora: 'user', pageSize: String(LIST_PAGE_SIZE),
          fields: 'nextPageToken,incompleteSearch,files(id,name,mimeType,size,md5Checksum,modifiedTime,parents,appProperties,ownedByMe)',
        });
        if (pageToken) p.set('pageToken', pageToken);
        const d = await driveJson('list', `${DRIVE}?${p}`);
        for (const f of Array.isArray(d?.files) ? d.files : []) {
          if (!isDriveId(f?.id)) continue;
          files.push(f);
          if (f.mimeType === FOLDER_MIME && !seen.has(f.id)) {
            if (seen.size >= FOLDERS_MAX) { partial = true; continue; }
            seen.add(f.id); queue.push(f.id);
          }
        }
        if (d?.incompleteSearch) partial = true;
        pageToken = typeof d?.nextPageToken === 'string' ? d.nextPageToken : '';
        if (!pageToken) break;
      }
    }
    const plan = planImport({ files, registered, appFolderIds, rootId: top.id, rootName: String(top.name || '고른 폴더') });
    const idx = await sameIndex(plan.items, files);
    const marked = markSame(plan.items, idx.listed, idx.docIndex);
    return { ok: true, folder: { id: top.id, name: String(top.name || '고른 폴더') }, ...plan, items: marked.items, same: marked.same, same_partial: idx.partial, partial };
  }

  async function add(folderId, ids) {
    const [registered, appFolderIds] = await Promise.all([readRegistered(), readAppFolders()]);
    const top = await chosenFolder(folderId, appFolderIds);
    const result = { added: 0, exists: 0, unreadable: 0, failed: 0 };
    // 폴더 id → 고른 폴더 아래인가(앱 폴더면 거짓). 같은 요청 안에서 기억.
    const underMemo = new Map([[top.id, Promise.resolve(true)]]);
    const under = (fid, depth = 0) => {
      if (!isDriveId(fid) || depth > ANCESTOR_MAX) return Promise.resolve(false);
      if (!underMemo.has(fid)) underMemo.set(fid, (async () => {
        if (appFolderIds.has(fid)) return false;
        const f = await driveJson('parent', `${DRIVE}/${encodeURIComponent(fid)}?fields=id,name,mimeType,parents,appProperties`);
        if (!f || f.mimeType !== FOLDER_MIME || appMarked(f) || APP_FOLDER_NAMES.includes(String(f.name || '').trim()) || isSecretFolder(f)) return false;
        for (const p of Array.isArray(f.parents) ? f.parents : []) if (await under(p, depth + 1)) return true;
        return false;
      })());
      return underMemo.get(fid);
    };
    const queue = [...ids];
    const one = async id => {
      if (registered.has(id)) { result.exists++; return; }
      const f = await driveJson('get', `${DRIVE}/${encodeURIComponent(id)}?fields=id,name,mimeType,size,modifiedTime,parents,appProperties,trashed,ownedByMe,webViewLink`);
      const why = checkAddable(f, { registered, appFolderIds });
      if (why !== 'ok') { result[why]++; return; }
      let inside = false;
      for (const p of Array.isArray(f.parents) ? f.parents : []) if (await under(p)) { inside = true; break; }
      if (!inside) { result.unreadable++; return; } // 고른 폴더 밖
      const name = String(f.name || '이름 없음'), link = !!LINK_MIMES[f.mimeType];
      const title = deps.titleFor(name);
      const auto = deps.classify(title + ' ' + name);
      registered.add(f.id); // 같은 요청 안에서 두 번 넣지 않음
      const { error } = await admin.from('app_documents').insert({
        workspace_id: workspaceId, project_id: null, meeting_id: null, title, category: auto.category, source: auto.source || null,
        document_date: auto.document_date || null, description: null, tags: auto.tags,
        drive_url: typeof f.webViewLink === 'string' && f.webViewLink ? f.webViewLink : (link ? `https://drive.google.com/open?id=${f.id}` : `https://drive.google.com/file/d/${f.id}/view`),
        file_id: f.id, file_name: name, mime_type: f.mimeType || 'application/octet-stream', file_size: link ? null : Number(f.size),
        visibility: 'private', uploaded_by: userId, auto_classified: true, classification_note: '드라이브에서 가져옴 · 파일명 기반 자동분류',
      });
      if (error) { log('insert_' + (error.code || 'x')); registered.delete(f.id); result.failed++; return; }
      result.added++;
    };
    const workers = Array.from({ length: Math.min(5, queue.length) }, async () => { while (queue.length) await one(queue.shift()); });
    await Promise.all(workers);
    return { ok: true, ...result };
  }
  return { folders, list, add, ImportFail };
}

// 요청 모양(S69-25b: 목록·가져오기는 고른 폴더 id가 꼭 있어야 함):
//   {action:'drive-import-folders'} | {action:'drive-import-list', folder_id} | {action:'drive-import-add', folder_id, file_ids:[id 1~50, 겹침 없음]}. 아니면 null.
export function parseImportRequest(input) {
  if (!input || typeof input !== 'object') return null;
  const keys = Object.keys(input).sort().join(',');
  if (input.action === 'drive-import-folders') return keys === 'action' ? { action: 'folders' } : null;
  if (input.action === 'drive-import-list') return keys === 'action,folder_id' && isDriveId(input.folder_id) ? { action: 'list', folderId: input.folder_id } : null;
  if (input.action === 'drive-import-add') {
    const ids = input.file_ids;
    if (keys !== 'action,file_ids,folder_id' || !isDriveId(input.folder_id) || !Array.isArray(ids) || !ids.length || ids.length > ADD_MAX || !ids.every(isDriveId) || new Set(ids).size !== ids.length) return null;
    return { action: 'add', folderId: input.folder_id, ids };
  }
  return null;
}
