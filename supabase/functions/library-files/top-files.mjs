// S69-40 LIB-맨위파일정리(명진 11/24: "드라이브 '자료실'에 폴더 안에 안 들어가 있는 파일들 정리할 수 있게. 폴더 하나 만들어서 싹 넣어 두고,
// 지워도 되는 것·중복은 알아서 지우고, 남길 가치 있는 것은 어디로 보낼지").
// library-files POST {action:'top-files-*'}가 부른다. 명진이 [맨 위 파일 정리]를 누를 때만 돈다(서버·예약이 몰래 하지 않음).
//
// 규칙(한 곳):
// - 대상은 드라이브 '자료실' 폴더(app_drive_settings.library_folder_id) '바로 아래' 파일만. 폴더(사람이 만든 폴더 포함)는 옮기지도 지우지도 않는다.
// - 판정은 파일 id를 내 앱 기록과 대조해서만 한다(파일 내용은 열지 않음 — 이름·크기·종류·md5·만든 때·표식만 읽음).
//     library     자료실 자료이고 앱 폴더 안 → 그 앱 폴더의 짝 드라이브 폴더로 옮김(짝이 아직 없으면 그대로 두고 '맞추기 먼저'로 셈)
//     library_top 자료실 자료이고 '폴더 밖' → 그 자리가 맞으므로 그대로
//     attach      할 일·노트 첨부(app_task_attachments·app_notes.attachments) → 자료실 아래 '할 일 첨부'·'노트 첨부'(이미 있는 '할 일 첨부'와 같은 꼴)
//     old         자료를 바꿔 끼우며 남은 옛 원본(app_documents.previous_files) → '정리 대기'
//     temp        앱 임시 파일(글자 읽기 임시·OCR 임시 표식) → 드라이브 휴지통
//     junk        Thumbs.db·desktop.ini·.DS_Store·~$ 임시 → 드라이브 휴지통
//     dup         앱 기록이 가리키지 않고, 자료실 아래 다른 폴더에 같은 내용(md5·크기 같음)이 있음 → 드라이브 휴지통
//     none        앱 기록 없음 → '정리 대기'(보낼 곳 제안을 붙여 화면에서 명진이 고름)
//     secret      S70-69: 앱 기록 없는 비밀값 파일(서명 열쇠·비밀번호 메모 등, _shared/drive-hidden-files.mjs) → 옮기지도 지우지도 않고 그대로.
//                 '정리 대기' 목록에도 내보내지 않고, 정리 대기에서 자료로 등록·휴지통 요청도 거절한다(secret_file).
// - 앱 기록이 가리키는 파일(자료·첨부)은 절대 휴지통에 보내지 않는다(판정 순서가 기록 먼저).
// - 영구 삭제 없음: 휴지통(trashed:true)까지만, 드라이브에서 30일 안 되돌리기 가능. 옮기거나 휴지통에 보낸 파일에는
//   won_tidy_from(원래 자리)·won_tidy_batch(이번 정리 번호) 표식을 붙여 [되돌리기]가 원래 자리로 돌린다(DB 변경 없음).
// - 작업공간·드라이브 연결은 서버가 정한다(로그인한 사람의 owner 작업공간). 화면이 보내는 값은 정리 번호, '정리 대기' 파일 id, 고른 앱 폴더 id뿐이고
//   서버가 다시 확인한다('정리 대기' 폴더 안 파일인지, 내 앱 폴더인지). 앱 표는 내 토큰(owner RLS)으로 읽는다.
// - 한 번 부를 때 TIDY_BUDGET_MS까지만 하고 남으면 left > 0(화면이 이어서 부름). 여러 번 눌러도 이미 옮긴 것은 다시 하지 않는다.

export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const WAIT_FOLDER_NAME = '정리 대기';
export const ATTACH_FOLDER_NAMES = Object.freeze({ task: '할 일 첨부', note: '노트 첨부' });
export const TIDY_MARK = Object.freeze({ from: 'won_tidy_from', batch: 'won_tidy_batch', folder: 'won_tidy_folder' });
export const TIDY_BUDGET_MS = 10000;
export const PARENTS_PER_QUERY = 40;
export const TREE_MAX_FOLDERS = 2000;
export const WAIT_LIST_MAX = 500;
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BATCH = /^[a-z0-9]{8,40}$/;
export const isDriveId = v => typeof v === 'string' && DRIVE_ID.test(v);
const JUNK_RE = /^(thumbs\.db|ehthumbs\.db|desktop\.ini|\.ds_store)$|^~\$/i;
// S70-69: 앱 임시 문서·비밀값 파일 판정은 공용 거름 한 곳(드라이브에서 가져오기와 같은 기준).
import { isAppTempFile, isSecretFile } from '../_shared/drive-hidden-files.mjs';

export const KINDS = Object.freeze(['library', 'library_top', 'attach', 'old', 'temp', 'junk', 'dup', 'none', 'secret']);
export const ACTION_OF = Object.freeze({ library: 'move', library_top: 'keep', attach: 'attach', old: 'wait', temp: 'trash', junk: 'trash', dup: 'trash', none: 'wait', secret: 'keep' });

export const isJunkName = name => JUNK_RE.test(String(name || '').trim());
export const isTempFile = isAppTempFile;
const dupKey = f => typeof f?.md5Checksum === 'string' && /^[0-9a-f]{32}$/.test(f.md5Checksum) && /^\d{1,15}$/.test(String(f.size ?? '')) && Number(f.size) > 0 ? `${f.md5Checksum}:${f.size}` : null;

/**
 * 맨 위 파일 하나 판정. refs: {docs: Map(file_id → {folder_id|null}), old:Set, task:Set, note:Set, pairOf: Map(앱 폴더 id → 드라이브 폴더 id), visible:Set(앱 폴더 id)}
 * dups: Set(md5:크기) — 자료실 아래 다른 폴더에 있는 파일들. 답 {kind, target?, attach?}
 */
export function judgeTopFile(f, refs, dups) {
  const id = f?.id;
  const doc = refs.docs.get(id);
  if (doc) {
    const folder = doc.folder_id && refs.visible.has(doc.folder_id) ? doc.folder_id : null;
    if (!folder) return { kind: 'library_top' };
    return { kind: 'library', target: refs.pairOf.get(folder) || null };
  }
  if (refs.task.has(id)) return { kind: 'attach', attach: 'task' };
  if (refs.note.has(id)) return { kind: 'attach', attach: 'note' };
  if (isSecretFile(f)) return { kind: 'secret' };
  if (isJunkName(f?.name)) return { kind: 'junk' };
  if (isTempFile(f)) return { kind: 'temp' };
  if (refs.old.has(id)) return { kind: 'old' };
  const k = dupKey(f);
  if (k && dups.has(k)) return { kind: 'dup' };
  return { kind: 'none' };
}

// 보낼 곳 제안(파일 이름·종류만 근거). 키는 앱 맨 위 폴더 이름 앞 번호('01'…'07') 또는 'misc'(잡동사니)·'trash'.
const SUGGEST_RULES = [
  [/투쟁\s*속보|보도\s*자료|성명|논평|발언|기자\s*회견|웹자보|카드\s*뉴스|선전/, '06'],
  [/집행\s*위|대의원|조직도|중앙\s*위|상집|중집|운영\s*위/, '01'],
  [/공운법|PSO|PPIP|예산\s*요구|입법|청원|정책|법안|개정\s*방향/i, '04'],
  [/궤도|수련회|결의\s*대회|도시\s*철도|지하철/, '03'],
  [/작성법|교육|강의|강좌|학습/, '05'],
  [/공공\s*팀|공공기관/, '02'],
  [/사업\s*계획|사업\s*보고|결산|예산안/, '07'],
];
export function suggestKey(name, mime = '') {
  const n = String(name || '').normalize('NFKC');
  for (const [re, key] of SUGGEST_RULES) if (re.test(n)) return key;
  if (/^(photo|video|img|image|kakaotalk|screenshot|스크린샷)[_\s-]?/i.test(n) || /^(image|video)\//.test(String(mime))) return 'misc';
  return null;
}
/** 제안 키 → 내 앱 맨 위 폴더 id(이름 앞 번호가 같은 것, 'misc'는 이름이 '잡동사니'). 없으면 null. */
export function suggestFolder(key, topFolders) {
  if (!key) return null;
  if (key === 'misc') return topFolders.find(f => String(f.name || '').trim() === '잡동사니')?.id || null;
  const re = new RegExp(`^0?${Number(key)}\\s*[.)\\-_ ]`);
  return topFolders.find(f => re.test(String(f.name || '').trim()))?.id || null;
}

// 요청 모양: {action:'top-files-scan'} | {action:'top-files-tidy'[, batch]} | {action:'top-files-undo', batch} | {action:'top-files-wait', file_id, to:'trash'|앱 폴더 uuid}
export function parseTopFilesRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const keys = Object.keys(input).sort().join(',');
  if (input.action === 'top-files-scan') return keys === 'action' ? { action: 'scan' } : null;
  if (input.action === 'top-files-tidy') {
    if (keys === 'action') return { action: 'tidy', batch: null };
    return keys === 'action,batch' && BATCH.test(String(input.batch)) ? { action: 'tidy', batch: input.batch } : null;
  }
  if (input.action === 'top-files-undo') return keys === 'action,batch' && BATCH.test(String(input.batch)) ? { action: 'undo', batch: input.batch } : null;
  if (input.action === 'top-files-wait') {
    if (keys !== 'action,file_id,to' || !isDriveId(input.file_id)) return null;
    if (input.to === 'trash' || UUID.test(String(input.to))) return { action: 'wait', fileId: input.file_id, to: input.to };
  }
  return null;
}

export class TopFail extends Error { constructor(code, status = 503) { super(code); this.code = code; this.status = status; } }

/**
 * deps: admin(service_role — app_drive_settings·app_documents 읽기/넣기, drive-import와 같음), db(내 토큰 supabase client — 앱 폴더·폴더 항목·첨부 표),
 *       fetch, token(내 작업공간 드라이브 토큰), workspaceId, userId, titleFor(name), classify(text), now(), newBatch(), budgetMs
 */
export function createTopFiles(deps) {
  const { admin, db, token, workspaceId, userId } = deps;
  const request = deps.fetch ?? globalThis.fetch;
  const now = deps.now ?? Date.now;
  const budgetMs = deps.budgetMs ?? TIDY_BUDGET_MS;
  const log = deps.log ?? (code => console.error('library-files top-files', { code }));
  const auth = { Authorization: `Bearer ${token}` };

  async function drive(stage, url, init = {}) {
    let r;
    try { r = await request(url, { ...init, headers: { ...auth, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) } }); }
    catch { log(stage + '_network'); throw new TopFail('drive_unavailable'); }
    let d = {};
    try { d = await r.json(); } catch { d = {}; }
    if (r.status === 404) return null;
    if (r.status === 401) { log(stage + '_401'); throw new TopFail('drive_auth_expired', 424); }
    if (r.status === 403) { const e = new TopFail('drive_denied', 424); e.cant = true; throw e; }
    if (!r.ok) { log(stage + '_' + r.status); throw new TopFail('drive_unavailable'); }
    return d;
  }
  const patch = (id, body, q = '') => drive('patch', `${DRIVE}/${encodeURIComponent(id)}?fields=id${q}`, { method: 'PATCH', body: JSON.stringify(body) });

  async function libraryId() {
    const { data, error } = await admin.from('app_drive_settings').select('library_folder_id').eq('workspace_id', workspaceId).maybeSingle();
    if (error) { log('settings_read'); throw new TopFail('db_read'); }
    if (!isDriveId(data?.library_folder_id)) throw new TopFail('library_missing', 409);
    const lib = await drive('library', `${DRIVE}/${encodeURIComponent(data.library_folder_id)}?fields=id,mimeType,trashed`);
    if (!lib || lib.trashed === true || lib.mimeType !== FOLDER_MIME) throw new TopFail('library_missing', 409);
    return data.library_folder_id;
  }
  async function pages(read) {
    const out = [];
    for (let from = 0; from < 200000; from += 1000) {
      const { data, error } = await read(from, from + 999);
      if (error) { log('db_read'); throw new TopFail('db_read'); }
      out.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return out;
  }
  // 앱 기록(파일 id만 뽑는다. 제목·본문은 쓰지 않음).
  async function readRefs() {
    const [docs, folders, items, tasks, notes] = await Promise.all([
      pages((a, b) => admin.from('app_documents').select('id,file_id,previous_files').eq('workspace_id', workspaceId).order('id').range(a, b)),
      pages((a, b) => db.from('app_library_folders').select('id,parent_id,name,drive_folder_id').eq('workspace_id', workspaceId).order('id').range(a, b)),
      pages((a, b) => db.from('app_library_folder_items').select('document_id,folder_id').eq('workspace_id', workspaceId).order('document_id').range(a, b)),
      pages((a, b) => db.from('app_task_attachments').select('drive_file_id').eq('workspace_id', workspaceId).order('drive_file_id').range(a, b)),
      // 노트 첨부는 서버 키로 휴지통 노트까지 본다(되살릴 수 있는 노트의 첨부도 지키기 — basket-files/photo-prune.ts와 같은 까닭). 첨부 id만 쓴다.
      pages((a, b) => admin.from('app_notes').select('id,attachments').eq('workspace_id', workspaceId).not('attachments', 'is', null).order('id').range(a, b)),
    ]);
    const itemOf = new Map(items.map(i => [i.document_id, i.folder_id]));
    const refs = { docs: new Map(), old: new Set(), task: new Set(), note: new Set(), pairOf: new Map(), visible: new Set(), folders };
    for (const f of folders) { refs.visible.add(f.id); if (isDriveId(f.drive_folder_id)) refs.pairOf.set(f.id, f.drive_folder_id); }
    for (const d of docs) {
      if (isDriveId(d.file_id)) refs.docs.set(d.file_id, { id: d.id, folder_id: itemOf.get(d.id) || null });
      for (const p of Array.isArray(d.previous_files) ? d.previous_files : []) if (isDriveId(p?.file_id)) refs.old.add(p.file_id);
    }
    for (const id of refs.docs.keys()) refs.old.delete(id); // 지금 자료가 쓰는 id는 옛 원본이 아님
    for (const t of tasks) if (isDriveId(t.drive_file_id)) refs.task.add(t.drive_file_id);
    for (const n of notes) for (const a of Array.isArray(n.attachments) ? n.attachments : []) if (isDriveId(a?.drive_file_id)) refs.note.add(a.drive_file_id);
    return refs;
  }
  // 자료실 나무(폴더 여러 개를 한 번에). 맨 위 파일·폴더, 아래 파일들의 md5, 앱이 만든 정리 폴더.
  async function readTree(lib) {
    const top = [], dups = new Set(), seen = new Set([lib]);
    let queue = [lib], partial = false;
    const own = { wait: null, task: null, note: null };
    while (queue.length) {
      const batch = queue.splice(0, PARENTS_PER_QUERY);
      let pageToken = '';
      for (let page = 0; page < 30; page++) {
        const p = new URLSearchParams({
          q: `(${batch.map(x => `'${x}' in parents`).join(' or ')}) and trashed = false`, spaces: 'drive', pageSize: '1000',
          fields: 'nextPageToken,files(id,name,mimeType,size,md5Checksum,parents,appProperties,ownedByMe,createdTime)',
        });
        if (pageToken) p.set('pageToken', pageToken);
        const d = await drive('list', `${DRIVE}?${p}`);
        for (const f of Array.isArray(d?.files) ? d.files : []) {
          if (!isDriveId(f?.id)) continue;
          const atTop = Array.isArray(f.parents) && f.parents.includes(lib);
          if (f.mimeType === FOLDER_MIME) {
            if (atTop) {
              const name = String(f.name || '').trim();
              if (name === WAIT_FOLDER_NAME && !own.wait) own.wait = f.id;
              if (name === ATTACH_FOLDER_NAMES.task && !own.task) own.task = f.id;
              if (name === ATTACH_FOLDER_NAMES.note && !own.note) own.note = f.id;
            }
            if (!seen.has(f.id)) { if (seen.size >= TREE_MAX_FOLDERS) { partial = true; continue; } seen.add(f.id); queue.push(f.id); }
            continue;
          }
          if (atTop) top.push(f);
          else { const k = dupKey(f); if (k) dups.add(k); }
        }
        pageToken = typeof d?.nextPageToken === 'string' ? d.nextPageToken : '';
        if (!pageToken) break;
      }
    }
    return { top, dups, own, partial };
  }
  async function readWait(waitId) {
    if (!waitId) return [];
    const p = new URLSearchParams({ q: `'${waitId}' in parents and trashed = false and mimeType != '${FOLDER_MIME}'`, spaces: 'drive', pageSize: String(WAIT_LIST_MAX), orderBy: 'name', fields: 'files(id,name,mimeType,size,modifiedTime)' });
    const d = await drive('wait_list', `${DRIVE}?${p}`);
    return (Array.isArray(d?.files) ? d.files : []).filter(f => isDriveId(f?.id) && !isSecretFile(f)); // S70-69: 비밀값 파일은 목록에 내보내지 않음
  }
  const topFoldersOf = refs => refs.folders.filter(f => !f.parent_id).map(f => ({ id: f.id, name: String(f.name || '') })).sort((a, b) => a.name.localeCompare(b.name, 'ko'));

  async function plan() {
    const lib = await libraryId();
    const [refs, tree] = await Promise.all([readRefs(), readTree(lib)]);
    const judged = tree.top.map(f => ({ f, ...judgeTopFile(f, refs, tree.dups) }));
    // 맨 위끼리 같은 내용: 앱 기록이 가리키는 쪽(또는 먼저 만든 쪽)을 남기고 나머지(기록 없는 것)만 dup.
    const keep = new Set();
    for (const j of judged) if (j.kind !== 'none') { const k = dupKey(j.f); if (k) keep.add(k); }
    for (const j of [...judged].sort((a, b) => String(a.f.createdTime || '').localeCompare(String(b.f.createdTime || '')))) {
      if (j.kind !== 'none') continue;
      const k = dupKey(j.f);
      if (!k) continue;
      if (keep.has(k)) j.kind = 'dup'; else keep.add(k);
    }
    return { lib, refs, tree, judged };
  }
  const countsOf = judged => Object.fromEntries(KINDS.map(k => [k, judged.filter(j => j.kind === k).length]));

  async function scan() {
    const { refs, tree, judged } = await plan();
    const tops = topFoldersOf(refs);
    const wait = (await readWait(tree.own.wait)).map(f => {
      const key = suggestKey(f.name, f.mimeType);
      return { id: f.id, name: String(f.name || '').slice(0, 200), mime: String(f.mimeType || ''), size: /^\d{1,15}$/.test(String(f.size ?? '')) ? Number(f.size) : null, suggest: suggestFolder(key, tops) };
    });
    const needPair = judged.filter(j => j.kind === 'library' && !j.target).length;
    return { ok: true, total: judged.length, counts: countsOf(judged), need_align: needPair, wait, folders: tops, partial: tree.partial };
  }

  async function ensureFolder(lib, name, mark) {
    const d = await drive('folder_create', `${DRIVE}?fields=id`, { method: 'POST', body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [lib], appProperties: { [TIDY_MARK.folder]: mark } }) });
    if (!isDriveId(d?.id)) throw new TopFail('drive_unavailable');
    return d.id;
  }

  async function tidy(batchIn) {
    const started = now();
    const batch = batchIn || (deps.newBatch ? deps.newBatch() : Math.random().toString(36).slice(2, 12) + Date.now().toString(36));
    const { lib, tree, judged } = await plan();
    const out = { ok: true, batch, moved: 0, attached: 0, trashed: 0, waiting: 0, kept: 0, need_align: 0, cant: 0, failed: 0, left: 0 };
    const own = { ...tree.own };
    const todo = [];
    for (const j of judged) {
      const act = ACTION_OF[j.kind];
      if (act === 'keep') { out.kept++; continue; }
      if (act === 'move' && !j.target) { out.need_align++; continue; }
      todo.push(j);
    }
    out.left = todo.length;
    const mark = { [TIDY_MARK.from]: lib, [TIDY_MARK.batch]: batch };
    for (const j of todo) {
      if (now() - started > budgetMs) break;
      const id = j.f.id;
      try {
        const act = ACTION_OF[j.kind];
        if (act === 'trash') {
          await patch(id, { trashed: true, appProperties: mark });
          out.trashed++;
        } else {
          let to = j.target;
          if (act === 'attach') {
            const key = j.attach;
            if (!own[key]) own[key] = await ensureFolder(lib, ATTACH_FOLDER_NAMES[key], 'attach_' + key);
            to = own[key];
          } else if (act === 'wait') {
            if (!own.wait) own.wait = await ensureFolder(lib, WAIT_FOLDER_NAME, 'wait');
            to = own.wait;
          }
          await patch(id, { appProperties: mark }, `&addParents=${encodeURIComponent(to)}&removeParents=${encodeURIComponent(lib)}`);
          if (act === 'move') out.moved++; else if (act === 'attach') out.attached++; else out.waiting++;
        }
        out.left--;
      } catch (e) {
        if (e instanceof TopFail && e.cant) { out.cant++; out.left--; continue; }
        if (e instanceof TopFail && e.code === 'drive_auth_expired') throw e;
        out.failed++;
      }
    }
    return out;
  }

  // [되돌리기]: 이번 정리 번호가 붙은 파일을 원래 자리(자료실 맨 위)로. 휴지통에 간 것은 꺼낸다. 표식은 지운다.
  async function undo(batch) {
    const started = now();
    const lib = await libraryId();
    const p = new URLSearchParams({ q: `appProperties has { key='${TIDY_MARK.batch}' and value='${batch}' }`, spaces: 'drive', pageSize: '1000', fields: 'files(id,parents,trashed,appProperties)' });
    const d = await drive('undo_list', `${DRIVE}?${p}`);
    const files = (Array.isArray(d?.files) ? d.files : []).filter(f => isDriveId(f?.id) && f.appProperties?.[TIDY_MARK.batch] === batch && f.appProperties?.[TIDY_MARK.from] === lib);
    const out = { ok: true, restored: 0, failed: 0, left: files.length };
    const clear = { [TIDY_MARK.from]: null, [TIDY_MARK.batch]: null };
    for (const f of files) {
      if (now() - started > budgetMs) break;
      const parents = (Array.isArray(f.parents) ? f.parents : []).filter(x => x !== lib && isDriveId(x));
      const q = parents.length ? `&addParents=${encodeURIComponent(lib)}&removeParents=${encodeURIComponent(parents.join(','))}` : '';
      try { await patch(f.id, { trashed: false, appProperties: clear }, q); out.restored++; out.left--; }
      catch (e) { if (e instanceof TopFail && e.code === 'drive_auth_expired') throw e; out.failed++; }
    }
    return out;
  }

  // '정리 대기' 파일 하나: 휴지통 또는 [자료실에 등록 + 그 앱 폴더로].
  async function waitAct(fileId, to) {
    const lib = await libraryId();
    const f = await drive('wait_get', `${DRIVE}/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,parents,trashed,webViewLink,ownedByMe`);
    if (!f || f.trashed === true || f.mimeType === FOLDER_MIME) throw new TopFail('not_waiting', 400);
    const parents = Array.isArray(f.parents) ? f.parents : [];
    if (parents.length !== 1 || !isDriveId(parents[0])) throw new TopFail('not_waiting', 400);
    const w = await drive('wait_parent', `${DRIVE}/${encodeURIComponent(parents[0])}?fields=id,name,mimeType,parents,trashed`);
    if (isSecretFile(f)) throw new TopFail('secret_file', 400); // S70-69: 비밀값 파일은 자료로 등록하지도 휴지통에 보내지도 않음
    if (!w || w.trashed === true || w.mimeType !== FOLDER_MIME || String(w.name || '').trim() !== WAIT_FOLDER_NAME || !(Array.isArray(w.parents) && w.parents.includes(lib))) throw new TopFail('not_waiting', 400);
    const refs = await readRefs();
    if (refs.docs.has(fileId) || refs.task.has(fileId) || refs.note.has(fileId)) throw new TopFail('in_use', 409); // 앱 기록이 가리키면 여기서 다루지 않음
    if (to === 'trash') {
      await patch(fileId, { trashed: true, appProperties: { [TIDY_MARK.from]: w.id } });
      return { ok: true, trashed: 1 };
    }
    const folder = refs.folders.find(x => x.id === to);
    if (!folder) throw new TopFail('folder_invalid', 400);
    const name = String(f.name || '이름 없음');
    const link = typeof f.mimeType === 'string' && f.mimeType.startsWith('application/vnd.google-apps.');
    const title = deps.titleFor(name);
    const auto = deps.classify(title + ' ' + name);
    const { data: row, error } = await admin.from('app_documents').insert({
      workspace_id: workspaceId, project_id: null, meeting_id: null, title, category: auto.category, source: auto.source || null,
      document_date: auto.document_date || auto.date || null, description: null, tags: auto.tags || [],
      drive_url: typeof f.webViewLink === 'string' && f.webViewLink ? f.webViewLink : `https://drive.google.com/file/d/${f.id}/view`,
      file_id: f.id, file_name: name, mime_type: f.mimeType || 'application/octet-stream', file_size: link ? null : (/^\d{1,15}$/.test(String(f.size ?? '')) ? Number(f.size) : null),
      visibility: 'private', uploaded_by: userId, auto_classified: true, classification_note: '드라이브 정리 대기에서 등록 · 파일명 기반 자동분류',
    }).select('id').single();
    if (error || !row?.id) { log('insert_' + (error?.code || 'x')); throw new TopFail('db_write'); }
    // 받는 폴더 트리거가 먼저 넣었을 수 있으므로: 고치기 → 없으면 넣기(내 토큰, owner RLS).
    const up = await db.from('app_library_folder_items').update({ folder_id: folder.id }).eq('document_id', row.id).select('document_id');
    if (up.error) { log('item_update'); throw new TopFail('db_write'); }
    if (!up.data?.length) {
      const ins = await db.from('app_library_folder_items').insert({ document_id: row.id, folder_id: folder.id, workspace_id: workspaceId });
      if (ins.error) { log('item_insert'); throw new TopFail('db_write'); }
    }
    const target = isDriveId(folder.drive_folder_id) ? folder.drive_folder_id : lib;
    try { await patch(fileId, {}, `&addParents=${encodeURIComponent(target)}&removeParents=${encodeURIComponent(w.id)}`); }
    catch { return { ok: true, document_id: row.id, moved: false }; } // 자료는 등록됨 — 자리는 [드라이브 폴더 맞추기]가 맞춤
    return { ok: true, document_id: row.id, moved: true };
  }

  return { scan, tidy, undo, waitAct, TopFail };
}
