// S70-73 LIB-드라이브자동등록(명진 11/26 08:52 "자동으로 들어오게해야지 메뉴 없애고"):
// 구글 드라이브 'WORK ON+ › 자료실' 폴더(app_drive_settings.library_folder_id)와 그 하위 폴더 안에, 앱을 거치지 않고 생긴 파일을
// 같은 자리 자료실 폴더의 자료로 저절로 등록한다. 자료실 ⋯ [드라이브에서 가져오기](S69-25)는 지웠다.
//
// 언제: 화면이 자료실을 열 때 library-files POST {action:'drive-auto'} 한 번(버튼 없음). 예약 작업(cron)은 쓰지 않는다 — 남의 구글 연결로
//   서버가 몰래 읽지 않고, 그 사람이 로그인해 자료실을 열 때 그 사람 연결로만 읽는다.
// 무엇을 '바뀐 것'으로 보나: 마지막 확인 시각·위치 대신 '자료실 나무 안 파일 id' 와 '이미 등록된 자료 파일 id' 를 견준다.
//   등록 여부 자체가 서버(DB)에 저장된 확인 결과다. 시각(modifiedTime)으로 거르면 다른 곳에서 옮겨 넣은 파일(수정일이 옛날)을 놓치고,
//   Drive changes 목록은 드라이브 전체 변경이라 자료실 나무 밖 일까지 읽게 되므로 쓰지 않는다. 한 번에 다 못 훑으면 다음 열 때 이어서 된다.
//
// 규칙(한 곳):
// - 작업공간·구글 연결은 서버가 정한다(로그인한 사람의 owner 작업공간, 그 작업공간 자기 연결). 화면이 보내는 값은 action 하나뿐.
// - 'WORK ON+ › 자료실' 아래만. 그 아래 앱 폴더('정리 대기'·'할 일 첨부'·'노트 첨부'·'일정 첨부'·바구니·백업 등, 앱 표식 kptu_* 폴더,
//   설정에 저장된 다른 앱 폴더 id)는 통째로 들어가지 않는다.
// - 넣지 않는 것: 공용 거름(drive-skip.mjs + S70-69 _shared/drive-hidden-files.mjs — 폴더·바로가기·0바이트·앱 임시 문서·열쇠·비밀번호·
//   비밀값 보관 폴더 안·운영 문서·앱 표식), 남이 올린 파일(ownedByMe 거짓),
//   이미 자료실에 있는 드라이브 파일(지금 파일 + 교체로 남긴 옛 파일), 할 일·노트 첨부로 쓰는 파일,
//   자료실 자료와 내용(md5 + 크기)이 같은 파일(규칙 same-content.mjs), 같은 번에 같은 내용이 앞에 있는 파일,
//   만든 지 RECENT_MS가 안 된 파일(앱이 올리는 중 — 드라이브에 파일을 만든 뒤 자료 행을 넣으므로 그 사이를 겹치지 않게. 다음 열 때 들어감).
// - 자리: 파일의 드라이브 부모 폴더와 짝인 자료실 폴더(app_library_folders.drive_folder_id, 휴지통 아님). 짝이 없거나 자료실 맨 위면
//   폴더를 정하지 않고 넣는다 → 넣기 뒤 트리거(app_documents_receive_folder)가 받는 폴더(잡동사니)로 넣는다.
// - 파일을 복사·이동·삭제하지 않는다. 자료 행만 넣는다(제목·분류는 파일 이름으로만, AI 없음).
// - 드라이브에서 파일이 지워지거나 자료실 밖으로 옮겨진 자료는 여기서 지우지 않는다(데이터 보존 — 이 PR 범위 밖, 보고만).
// - 이렇게 들어온 자료는 보통 자료실 자료다(classification_note 앞머리 AUTO_NOTE, document-actions의 '연결만 한 원본' 표식이 아님):
//   지우면 지금처럼 드라이브 파일도 휴지통으로 간다. 그래야 지운 자료가 다음 확인 때 다시 들어오지 않는다.
// 순수 규칙 + 주입받은 입출력(admin·db·fetch)만. 시험: tests/security/library-files-drive-auto.test.mjs.
import { folderNames, knownFolderNames } from '../_shared/brand-folders.mjs';
import { fileKey, hashable, lookupKeys } from './same-content.mjs';
import { FOLDER_MIME, appMarked, isSecretFolder, linkKind, skipReason } from './drive-skip.mjs';

export const AUTO_NOTE = '자료실 드라이브 폴더에서 자동 등록 · 파일명 기반 자동분류';
// 일정 첨부 폴더 이름(_shared/event-attach-file.ts EVENT_ATTACH_FOLDER와 같음 — 시험이 견준다).
export const EVENT_FOLDER_NAME = '일정 첨부';
// 옛 [맨 위 파일 정리](S69-40, S70-29에서 지움)가 자료실 아래 만든 폴더 이름. 폴더·파일은 드라이브에 남아 있을 수 있어 계속 들어가지 않는다.
export const WAIT_FOLDER_NAME = '정리 대기';
export const ATTACH_FOLDER_NAMES = Object.freeze({ task: '할 일 첨부', note: '노트 첨부' });
// 자료실 나무 안에서 들어가지 않는 앱 폴더 이름.
export const SKIP_FOLDER_NAMES = Object.freeze([
  WAIT_FOLDER_NAME, ATTACH_FOLDER_NAMES.task, ATTACH_FOLDER_NAMES.note, EVENT_FOLDER_NAME,
  ...knownFolderNames('basket'), ...knownFolderNames('copy'), '원장 백업',
  ...knownFolderNames('record_backup'), ...knownFolderNames('edit_backup'), ...folderNames('photo_trash'),
]);
// 설정(app_drive_settings)의 *_folder_id 중 자료실 나무의 뿌리·그 위라 빼지 않는 것.
export const KEEP_SETTING_KEYS = Object.freeze(['library_folder_id', 'root_folder_id']);

export const RECENT_MS = 10 * 60 * 1000;
export const PAGE_SIZE = 1000;
export const MAX_PAGES = 30;
export const FOLDERS_MAX = 3000;
export const PARENTS_PER_QUERY = 40;
export const ADD_MAX = 200;        // 한 번에 넣는 자료 수(넘으면 more — 다음 열 때 이어서)
export const INSERT_CHUNK = 50;
export const SAME_LOOKUP_MAX = 300; // 나무 밖 자료 중 내용 비교로 드라이브에 묻는 수(넘으면 그 크기 파일은 다음에)
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;
export const isDriveId = v => typeof v === 'string' && DRIVE_ID.test(v);

// 드라이브 전체 권한(연결 때 drive.file과 함께 묻는 그 권한)이 있어야 앱이 만들지 않은 파일이 보인다. 없으면 조용히 쉰다.
const SCOPE_FULL = 'https://www.googleapis.com/auth/drive';
export const scopeCanList = scope => typeof scope === 'string' && scope.split(/\s+/).includes(SCOPE_FULL);

// 자료실에 이미 등록된 드라이브 id(지금 파일 + 교체로 남긴 옛 파일).
export function registeredIds(rows) {
  const out = new Set();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (isDriveId(r?.file_id)) out.add(r.file_id);
    for (const p of Array.isArray(r?.previous_files) ? r.previous_files : []) if (isDriveId(p?.file_id)) out.add(p.file_id);
  }
  return out;
}
// 설정 행 → 들어가지 않는 앱 폴더 id.
export function appFolderIdsFrom(settings) {
  const out = new Set();
  for (const [k, v] of Object.entries(settings && typeof settings === 'object' ? settings : {})) {
    if (k.endsWith('_folder_id') && !KEEP_SETTING_KEYS.includes(k) && isDriveId(v)) out.add(v);
  }
  return out;
}
// 자료실 나무에서 들어가지 않는 폴더인가.
//   S70-69 비밀값 보관 폴더(폰 열쇠 백업 등, 공용 거름 isSecretFolder) 안도 들어가지 않는다 — 그 안 파일은 이름과 상관없이 넣지 않음.
export const skipFolder = (f, appFolderIds) => !f || appFolderIds.has(f.id) || appMarked(f) || isSecretFolder(f) || SKIP_FOLDER_NAMES.includes(String(f.name || '').normalize('NFC').trim());

/**
 * 나무에서 읽은 파일들 → 넣을 것. 순수 규칙.
 * files: libraryId 아래(들어가도 되는 폴더만 훑은) 파일·폴더 목록(id,name,mimeType,size,md5Checksum,createdTime,parents,appProperties,ownedByMe)
 * registered: Set(드라이브 id) · used: Set(할 일·노트 첨부 드라이브 id) · pairOf: Map(드라이브 폴더 id → 자료실 폴더 id, 휴지통 아님)
 * knownKeys: Set(자료실 자료의 내용 열쇠) · waitSizes: Set(아직 내용을 못 견준 자료 크기 — 그 크기 파일은 다음에) · now(ms)
 * 답: {add:[{file, folderId|null}], skipped:{...}, more}
 */
export function planAuto({ files, libraryId, registered = new Set(), used = new Set(), pairOf = new Map(), knownKeys = new Set(), waitSizes = new Set(), now = Date.now() }) {
  const skipped = { registered: 0, used: 0, folder: 0, not_file: 0, empty: 0, temp: 0, secret: 0, app: 0, others: 0, same: 0, recent: 0, wait: 0 };
  const add = [], seenKeys = new Set();
  const list = (Array.isArray(files) ? files : []).filter(f => isDriveId(f?.id));
  // 같은 번에 같은 내용이면 먼저 만든 것 하나만(이름 순으로 고정).
  list.sort((a, b) => String(a.createdTime || '').localeCompare(String(b.createdTime || '')) || String(a.name || '').localeCompare(String(b.name || ''), 'ko') || a.id.localeCompare(b.id));
  let more = false;
  for (const f of list) {
    if (f.mimeType === FOLDER_MIME) continue;
    if (registered.has(f.id)) { skipped.registered++; continue; }
    if (used.has(f.id)) { skipped.used++; continue; }
    const why = skipReason(f);
    if (why) { skipped[why]++; continue; }
    if (f.ownedByMe === false) { skipped.others++; continue; }
    const made = Date.parse(String(f.createdTime || ''));
    if (!Number.isFinite(made) || now - made < RECENT_MS) { skipped.recent++; continue; }
    const key = linkKind(f) ? null : fileKey(f);
    if (key && (knownKeys.has(key) || seenKeys.has(key))) { skipped.same++; continue; }
    if (!linkKind(f) && waitSizes.has(Number(f.size))) { skipped.wait++; continue; }
    if (add.length >= ADD_MAX) { more = true; continue; }
    if (key) seenKeys.add(key);
    const parent = (Array.isArray(f.parents) ? f.parents : []).find(isDriveId) || null;
    add.push({ file: f, folderId: parent && parent !== libraryId ? pairOf.get(parent) || null : null });
  }
  return { add, skipped, more };
}

export function parseAutoRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  return input.action === 'drive-auto' && Object.keys(input).join(',') === 'action' ? { action: 'auto' } : null;
}

/**
 * deps: admin(service_role — app_drive_settings·app_documents 읽기/넣기·app_notes 첨부 id), db(내 토큰 supabase client — 자료실 폴더·폴더 항목·할 일 첨부),
 *       fetch, token(내 작업공간 드라이브 토큰), workspaceId, userId, titleFor(name), classify(text), now?, log?
 */
export function createDriveAuto(deps) {
  const { admin, db, token, workspaceId, userId } = deps;
  const request = deps.fetch ?? globalThis.fetch;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (code => console.error('library-files drive-auto', { code }));
  const auth = { Authorization: `Bearer ${token}` };
  class AutoFail extends Error { constructor(code, status = 503) { super(code); this.code = code; this.status = status; } }

  async function drive(stage, url) {
    let r;
    try { r = await request(url, { headers: auth }); } catch { log(stage + '_network'); throw new AutoFail('drive_unavailable'); }
    let d = {};
    try { d = await r.json(); } catch { d = {}; }
    if (r.status === 404) return null;
    if (r.status === 401 || r.status === 403) { log(stage + '_' + r.status); throw new AutoFail(r.status === 401 ? 'drive_auth_expired' : 'drive_denied', 424); }
    if (!r.ok) { log(stage + '_' + r.status); throw new AutoFail('drive_unavailable'); }
    return d;
  }
  async function scopeOk() {
    let r;
    try { r = await request('https://oauth2.googleapis.com/tokeninfo', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ access_token: token }) }); }
    catch { log('tokeninfo_network'); throw new AutoFail('drive_unavailable'); }
    if (!r.ok) { log('tokeninfo_' + r.status); throw new AutoFail('drive_unavailable'); }
    let d = {};
    try { d = await r.json(); } catch { d = {}; }
    return scopeCanList(d?.scope);
  }
  async function pages(read, stage) {
    const out = [];
    for (let from = 0; from < 200000; from += 1000) {
      const { data, error } = await read(from, from + 999);
      if (error) { log(stage + '_read'); throw new AutoFail('db_read'); }
      out.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return out;
  }

  // 자료실 나무 훑기: 부모 폴더 몇십 개씩 묶어 바로 아래를 묻고, 나온 폴더(들어가도 되는 것만)를 다음 차례에 묻는다.
  async function walk(libraryId, appFolderIds) {
    const files = [], seen = new Set([libraryId]);
    let queue = [libraryId], partial = false, count = 0;
    while (queue.length) {
      const batch = queue.slice(0, PARENTS_PER_QUERY);
      queue = queue.slice(PARENTS_PER_QUERY);
      let pageToken = '';
      for (;;) {
        if (count >= MAX_PAGES) { partial = true; queue = []; break; }
        count++;
        // id는 isDriveId로 이미 걸렀다(따옴표·공백 없음).
        const p = new URLSearchParams({
          q: `(${batch.map(x => `'${x}' in parents`).join(' or ')}) and trashed = false`, spaces: 'drive', corpora: 'user', pageSize: String(PAGE_SIZE),
          fields: 'nextPageToken,incompleteSearch,files(id,name,mimeType,size,md5Checksum,createdTime,parents,appProperties,ownedByMe,webViewLink)',
        });
        if (pageToken) p.set('pageToken', pageToken);
        const d = await drive('list', `${DRIVE}?${p}`);
        for (const f of Array.isArray(d?.files) ? d.files : []) {
          if (!isDriveId(f?.id)) continue;
          if (f.mimeType === FOLDER_MIME) {
            if (seen.has(f.id) || skipFolder(f, appFolderIds)) continue;
            if (seen.size >= FOLDERS_MAX) { partial = true; continue; }
            seen.add(f.id); queue.push(f.id);
            continue;
          }
          files.push(f);
        }
        if (d?.incompleteSearch) partial = true;
        pageToken = typeof d?.nextPageToken === 'string' ? d.nextPageToken : '';
        if (!pageToken) break;
      }
    }
    return { files, partial };
  }

  async function run() {
    const { data: settings, error } = await admin.from('app_drive_settings').select('*').eq('workspace_id', workspaceId).maybeSingle();
    if (error) { log('settings_read'); throw new AutoFail('db_read'); }
    const libraryId = settings?.library_folder_id;
    if (!isDriveId(libraryId)) return { ok: true, added: 0, code: 'library_missing' };
    if (!(await scopeOk())) return { ok: true, added: 0, code: 'scope_missing' };
    const lib = await drive('library', `${DRIVE}/${encodeURIComponent(libraryId)}?fields=id,mimeType,trashed`);
    if (!lib || lib.trashed === true || lib.mimeType !== FOLDER_MIME) return { ok: true, added: 0, code: 'library_missing' };
    const appFolderIds = appFolderIdsFrom(settings);

    const [docs, folders, tasks, notes] = await Promise.all([
      pages((a, b) => admin.from('app_documents').select('id,file_id,file_size,mime_type,previous_files').eq('workspace_id', workspaceId).order('id').range(a, b), 'docs'),
      pages((a, b) => db.from('app_library_folders').select('id,drive_folder_id,deleted_at').eq('workspace_id', workspaceId).order('id').range(a, b), 'folders'),
      pages((a, b) => db.from('app_task_attachments').select('drive_file_id').eq('workspace_id', workspaceId).order('drive_file_id').range(a, b), 'tasks'),
      // 노트 첨부는 서버 키로 휴지통 노트까지 본다(휴지통 노트가 되살아날 수 있으므로 그 첨부는 계속 지킨다). 첨부 id만 쓴다.
      pages((a, b) => admin.from('app_notes').select('id,attachments').eq('workspace_id', workspaceId).not('attachments', 'is', null).order('id').range(a, b), 'notes'),
    ]);
    const registered = registeredIds(docs);
    const used = new Set();
    for (const t of tasks) if (isDriveId(t?.drive_file_id)) used.add(t.drive_file_id);
    for (const n of notes) for (const a of Array.isArray(n?.attachments) ? n.attachments : []) if (isDriveId(a?.drive_file_id)) used.add(a.drive_file_id);
    const pairOf = new Map();
    for (const f of folders) if (!f?.deleted_at && isDriveId(f?.drive_folder_id)) pairOf.set(f.drive_folder_id, f.id);

    const tree = await walk(libraryId, appFolderIds);
    // 내용 비교: 나무 안 자료는 방금 읽은 목록의 md5, 나무 밖 자료는 새 파일과 크기가 같은 것만 드라이브에 묻는다(내용 열지 않음).
    const inTree = new Map(tree.files.map(f => [f.id, f]));
    const newSizes = new Set(tree.files.filter(f => !registered.has(f.id) && !linkKind(f)).map(f => Number(f.size)).filter(n => n > 0));
    const knownKeys = new Set(), waitSizes = new Set();
    const outside = [];
    for (const d of docs) {
      if (!hashable(d)) continue;
      const f = inTree.get(d.file_id);
      if (f) { const k = fileKey(f); if (k) knownKeys.add(k); continue; }
      if (newSizes.has(Number(d.file_size))) outside.push(d);
    }
    if (outside.length) {
      const { keys } = await lookupKeys(outside.map(d => d.file_id), { fetch: request, token, log, max: SAME_LOOKUP_MAX });
      for (const d of outside) {
        if (!keys.has(d.file_id)) { waitSizes.add(Number(d.file_size)); continue; } // 이번에 못 물음 → 그 크기 파일은 다음에
        const k = keys.get(d.file_id);
        if (k) knownKeys.add(k);
      }
    }
    const plan = planAuto({ files: tree.files, libraryId, registered, used, pairOf, knownKeys, waitSizes, now: now() });

    let added = 0, placed = 0, failed = 0;
    for (let i = 0; i < plan.add.length; i += INSERT_CHUNK) {
      const part = plan.add.slice(i, i + INSERT_CHUNK);
      const rows = part.map(({ file: f }) => {
        const name = String(f.name || '이름 없음'), link = linkKind(f);
        const title = deps.titleFor(name);
        const auto = deps.classify(title + ' ' + name) || {};
        return {
          workspace_id: workspaceId, project_id: null, meeting_id: null, title, category: auto.category, source: auto.source || null,
          document_date: auto.document_date || null, description: null, tags: Array.isArray(auto.tags) ? auto.tags : [],
          drive_url: typeof f.webViewLink === 'string' && f.webViewLink.startsWith('https://') ? f.webViewLink : (link ? `https://drive.google.com/open?id=${f.id}` : `https://drive.google.com/file/d/${f.id}/view`),
          file_id: f.id, file_name: name, mime_type: f.mimeType || 'application/octet-stream', file_size: link ? null : Number(f.size),
          visibility: 'private', uploaded_by: userId, auto_classified: true, classification_note: AUTO_NOTE,
        };
      });
      const { data, error: insErr } = await admin.from('app_documents').insert(rows).select('id,file_id');
      if (insErr || !Array.isArray(data)) { log('insert_' + (insErr?.code || 'x')); failed += part.length; continue; }
      added += data.length;
      // 짝 자료실 폴더로: 받는 폴더 트리거가 먼저 넣었을 수 있으므로 고치기 → 없으면 넣기(내 토큰, owner RLS).
      const docOf = new Map(data.map(r => [r.file_id, r.id]));
      const byFolder = new Map();
      for (const { file: f, folderId } of part) {
        const docId = docOf.get(f.id);
        if (!folderId || !docId) continue;
        if (!byFolder.has(folderId)) byFolder.set(folderId, []);
        byFolder.get(folderId).push(docId);
      }
      for (const [folderId, ids] of byFolder) {
        const up = await db.from('app_library_folder_items').update({ folder_id: folderId }).in('document_id', ids).select('document_id');
        if (up.error) { log('item_update'); continue; }
        const done = new Set((up.data || []).map(r => r.document_id));
        const rest = ids.filter(id => !done.has(id));
        if (rest.length) {
          const ins = await db.from('app_library_folder_items').insert(rest.map(id => ({ document_id: id, folder_id: folderId, workspace_id: workspaceId })));
          if (ins.error) { log('item_insert'); placed += done.size; continue; }
        }
        placed += ids.length;
      }
    }
    return { ok: true, added, placed, failed, more: plan.more || tree.partial, skipped: plan.skipped };
  }
  return { run, AutoFail };
}
