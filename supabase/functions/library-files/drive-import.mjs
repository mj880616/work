// S69-25 LIB-드라이브에서가져오기(명진 11/24 09:22 "구글드라이브에는 있는데 자료실에는 없는거를 일단 잡동사니에 다 올려놔봐"):
// 자료실 맨 위 ⋯ [드라이브에서 가져오기]. 로그인한 사람의 자기 작업공간·자기 구글 연결로만 그 사람 드라이브의 '내 소유 파일'을 훑어,
// 자료실(app_documents)에 아직 없는 것만 목록으로 돌려주고, 선택한 것을 자료 행으로 등록한다.
//   - 파일 내용은 열지 않는다(이름·크기·수정일·종류·id·폴더 이름만). 드라이브에서 복사·다시 올리기·옮기기·지우기를 하지 않는다.
//   - 등록 = 같은 드라이브 파일 id로 자료 행 하나(app_documents insert). 받는 폴더(잡동사니)에 넣는 일은 기존 넣기 뒤 트리거
//     (app_documents_receive_folder, migration 20261111181000)가 한다. 드라이브 위치 맞추기는 S69-20 [드라이브 폴더 맞추기]가 맡는다.
//   - 제목·분류는 파일 이름으로만(AI 없음 — 많은 파일을 한꺼번에 넣으므로 비용 0, 내용도 읽지 않음).
//   - 빼는 것: 폴더 자체, 앱이 쓰는 폴더 안 파일(설정에 저장된 앱 폴더 id·앱 표식 kptu_*·앱 폴더 이름 표), 파일이 아닌 구글 형식
//     (바로가기·Apps Script·양식·사이트 등), 0바이트. 구글 문서·시트·슬라이드는 링크형 자료(크기 없음)로 넣는다.
// 순수 규칙 + 주입받은 입출력(admin·fetch)만. 시험: tests/security/library-files-drive-import.test.mjs.
import { folderNames } from '../_shared/brand-folders.mjs';

export const FOLDER_MIME = 'application/vnd.google-apps.folder';
// 링크형으로 넣는 구글 형식(내려받기 대신 드라이브에서 열기).
export const LINK_MIMES = Object.freeze({
  'application/vnd.google-apps.document': '구글 문서',
  'application/vnd.google-apps.spreadsheet': '구글 시트',
  'application/vnd.google-apps.presentation': '구글 슬라이드',
});
// 앱이 만드는 폴더 이름(이 이름의 폴더 안은 통째로 뺀다). 앱 표식(appProperties kptu_*)이 없는 옛 폴더도 이름으로 잡는다.
export const APP_FOLDER_NAMES = Object.freeze([
  'Web2 바구니',
  'Web2 읽기용 사본', '노조+ 읽기용 사본', 'WORK ON+ 읽기용 사본',
  '원장 백업',
  ...folderNames('record_backup'), ...folderNames('edit_backup'), ...folderNames('photo_trash'),
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
export function planImport({ files, registered = new Set(), appFolderIds = new Set(), rootId = null }) {
  const all = Array.isArray(files) ? files.filter(f => isDriveId(f?.id)) : [];
  const folders = new Map(all.filter(f => f.mimeType === FOLDER_MIME).map(f => [f.id, f]));
  const appNames = new Set(APP_FOLDER_NAMES);
  const appMemo = new Map(), pathMemo = new Map();
  const parentOf = f => (Array.isArray(f?.parents) && isDriveId(f.parents[0]) ? f.parents[0] : null);
  // 이 폴더(또는 그 위)가 앱 폴더인가.
  const appFolder = id => {
    const seen = [];
    let cur = id, hit = false;
    for (let depth = 0; cur && depth < 60; depth++) {
      if (appMemo.has(cur)) { hit = appMemo.get(cur); break; }
      seen.push(cur);
      const f = folders.get(cur);
      if (appFolderIds.has(cur) || (f && (appMarked(f) || appNames.has(String(f.name || '').trim())))) { hit = true; break; }
      if (!f) break;
      cur = parentOf(f);
    }
    for (const s of seen) appMemo.set(s, hit);
    return hit;
  };
  // 폴더 경로 글자(내 드라이브 › 가 › 나). 남의 폴더 안(목록에 없는 부모)은 '다른 사람 폴더'.
  const pathOf = id => {
    if (!id || id === rootId) return '내 드라이브';
    if (pathMemo.has(id)) return pathMemo.get(id);
    const names = [];
    let cur = id, head = '내 드라이브';
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
  const skipped = { registered: 0, app: 0, not_file: 0, empty: 0 };
  const items = [];
  for (const f of all) {
    const k = fileKind(f);
    if (!k.kind) { if (k.skip !== 'folder') skipped[k.skip]++; continue; }
    if (registered.has(f.id)) { skipped.registered++; continue; }
    const parent = parentOf(f);
    if (appMarked(f) || (parent && appFolder(parent))) { skipped.app++; continue; }
    const name = String(f.name || '이름 없음');
    items.push({
      id: f.id, name, path: pathOf(parent), kind: k.kind,
      size: k.kind === 'file' ? Number(f.size) : null,
      modified: typeof f.modifiedTime === 'string' ? f.modifiedTime.slice(0, 10) : null,
      personal: isPersonalName(name), media: MEDIA_RE.test(String(f.mimeType || '')),
    });
  }
  items.sort((a, b) => a.path.localeCompare(b.path, 'ko') || a.name.localeCompare(b.name, 'ko'));
  const more = items.length > ITEMS_MAX;
  return { items: more ? items.slice(0, ITEMS_MAX) : items, total: items.length, more, skipped };
}

// 가져오기 직전 파일 하나 다시 확인(화면이 보낸 id를 믿지 않음): 내 소유·휴지통 아님·파일 종류·0바이트·앱 표식·앱 폴더 바로 안.
export function checkAddable(f, { registered, appFolderIds }) {
  if (!f || !isDriveId(f.id)) return 'unreadable';
  if (registered.has(f.id)) return 'exists';
  if (f.trashed === true || f.ownedByMe !== true) return 'unreadable';
  const k = fileKind(f);
  if (!k.kind) return 'unreadable';
  const parent = Array.isArray(f.parents) ? f.parents[0] : null;
  if (appMarked(f) || (parent && appFolderIds.has(parent))) return 'unreadable';
  return 'ok';
}

// 드라이브 전체 권한(연결 때 drive.file과 함께 묻는 그 권한)만. drive.file뿐이면 앱이 만든 파일만 보여 목록을 못 만든다 → scope_missing.
// 새 권한을 묻지 않는다(처리방침 표·구글 동의 화면 그대로).
const SCOPE_FULL = 'https://www.googleapis.com/auth/drive';
export const scopeCanList = scope => typeof scope === 'string' && scope.split(/\s+/).includes(SCOPE_FULL);

// 입출력 묶음. deps: {admin, fetch, token, workspaceId, userId, titleFor(name), classify(text), log(code)}
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
  async function readRegistered() {
    const rows = [];
    for (let from = 0; from < 200000; from += 1000) {
      const { data, error } = await admin.from('app_documents').select('file_id,previous_files').eq('workspace_id', workspaceId).range(from, from + 999);
      if (error) { log('registered_read'); throw new ImportFail('db_read'); }
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return registeredIds(rows);
  }
  async function readAppFolders() {
    const { data, error } = await admin.from('app_drive_settings').select('*').eq('workspace_id', workspaceId).maybeSingle();
    if (error) { log('settings_read'); throw new ImportFail('db_read'); }
    return appFolderIdsFrom(data);
  }

  async function list() {
    if (!(await scopeOk())) return { ok: false, code: 'scope_missing' };
    const [registered, appFolderIds, root] = await Promise.all([readRegistered(), readAppFolders(), driveJson('root', `${DRIVE}/root?fields=id`)]);
    const files = [];
    let pageToken = '', partial = false;
    for (let page = 0; ; page++) {
      if (page >= LIST_MAX_PAGES) { partial = true; break; }
      const p = new URLSearchParams({
        q: "'me' in owners and trashed = false", spaces: 'drive', corpora: 'user', pageSize: String(LIST_PAGE_SIZE),
        fields: 'nextPageToken,incompleteSearch,files(id,name,mimeType,size,modifiedTime,parents,appProperties)',
      });
      if (pageToken) p.set('pageToken', pageToken);
      const d = await driveJson('list', `${DRIVE}?${p}`);
      if (Array.isArray(d?.files)) files.push(...d.files);
      if (d?.incompleteSearch) partial = true;
      pageToken = typeof d?.nextPageToken === 'string' ? d.nextPageToken : '';
      if (!pageToken) break;
    }
    const plan = planImport({ files, registered, appFolderIds, rootId: isDriveId(root?.id) ? root.id : null });
    return { ok: true, ...plan, partial };
  }

  async function add(ids) {
    const [registered, appFolderIds] = await Promise.all([readRegistered(), readAppFolders()]);
    const result = { added: 0, exists: 0, unreadable: 0, failed: 0 };
    const queue = [...ids];
    const one = async id => {
      if (registered.has(id)) { result.exists++; return; }
      const f = await driveJson('get', `${DRIVE}/${encodeURIComponent(id)}?fields=id,name,mimeType,size,modifiedTime,parents,appProperties,trashed,ownedByMe,webViewLink`);
      const why = checkAddable(f, { registered, appFolderIds });
      if (why !== 'ok') { result[why]++; return; }
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
  return { list, add, ImportFail };
}

// 요청 모양: {action:'drive-import-list'} | {action:'drive-import-add', file_ids:[id 1~50, 겹침 없음]}. 아니면 null.
export function parseImportRequest(input) {
  if (!input || typeof input !== 'object') return null;
  const keys = Object.keys(input).sort().join(',');
  if (input.action === 'drive-import-list') return keys === 'action' ? { action: 'list' } : null;
  if (input.action === 'drive-import-add') {
    const ids = input.file_ids;
    if (keys !== 'action,file_ids' || !Array.isArray(ids) || !ids.length || ids.length > ADD_MAX || !ids.every(isDriveId) || new Set(ids).size !== ids.length) return null;
    return { action: 'add', ids };
  }
  return null;
}
