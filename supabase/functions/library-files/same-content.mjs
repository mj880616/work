// S69-45 LIB-같은내용정리(명진 11/24 15:50 "자료실에 없는 파일만 가져오는거 맞지? 중복해서 안가져오는거 믿을만 한거지?",
// 15:51 "중복된 파일들이 있는거같어. 일단 잡동사니에 넣어둘테니깐 중복된거 지워 알아서").
// 두 가지에 함께 쓰는 한 곳:
//   1) 드라이브 자동 등록(drive-auto.mjs, S70-73 — 옛 [드라이브에서 가져오기] 자리): 드라이브 '파일 id'가 달라도 내용(md5Checksum + 크기)이 자료실 자료와 같으면 넣지 않음.
//   2) 자료실 ⋯ [같은 내용 자료 정리]: 내 작업공간 자료 중 md5 + 크기가 같은 묶음마다 하나만 남기고 나머지를 자료실 휴지통으로.
// 규칙:
// - 내용 비교는 드라이브가 주는 md5Checksum·size(파일 메타데이터)만 쓴다. 파일 내용은 열지 않는다(files.get fields=id,md5Checksum,size,trashed).
//   자료 행에는 md5 칸이 없어(DB 변경 없음) 비교할 때마다 드라이브에 묻는다. 크기가 같은 자료가 둘 이상인 것만 묻는다(크기가 다르면 내용도 다름).
//   md5가 없는 구글 문서·시트·슬라이드(링크형)는 비교하지 않는다(가져오기는 지금처럼 드라이브 id로만 거른다).
// - 자료실 휴지통: 자료 한 줄짜리 휴지통은 아직 없다. 그래서 기존 '자료실 폴더 휴지통'(app_trash_* 종류 library_folder)을 그대로 쓴다:
//   이번 정리용 폴더 '같은 내용 정리 월-일 시:분'을 하나 만들고 지울 자료를 그 폴더로 옮긴 뒤 그 폴더를 지운다(서버 트리거가 휴지통 표시로 바꿈).
//   자료 행·드라이브 파일·기록 연결은 그대로라 영구 삭제가 없고, 휴지통 화면에서 그 폴더를 되돌리면 자료가 다시 보인다.
//   [되돌리기](이번 결과 줄)는 그 폴더를 휴지통에서 꺼내 자료를 원래 폴더로 돌리고, 비게 된 정리 폴더만 지운다.
// - 남길 것 기준(앞이 이김): 손으로 분류한 폴더(받는 폴더·그 아래·'잡동사니'·폴더 밖이 아닌 폴더)에 있는 것 > 기록에 연결된 것 > 먼저 들어온 것.
// - 기록 연결(노트·할 일 연결 app_record_links, 보고 묶음 app_report_snapshots)은 남길 자료로 옮긴다. 자료 행 자체의 회의·조직 연결
//   (meeting_id·organization_id)이 남길 자료와 다르거나, 남길 자료에 같은 노트·할 일 연결이 이미 있으면 못 옮기므로 그 묶음은 건너뛴다.
// - 표는 모두 로그인한 사람의 토큰(db, owner RLS)으로 읽고 쓴다. 작업공간은 서버가 정한 것(workspaceFor)만. 권한·RLS를 넓히지 않는다.
// - 화면이 보내는 값(남길 자료·지울 자료 id, 되돌리기 묶음)은 서버가 다시 읽어 확인한다(같은 작업공간·같은 내용·옮길 수 있는 연결).
// 시험: tests/security/library-files-same-content.test.mjs.

export const SAME_FOLDER_PREFIX = '같은 내용 정리';
export const UNSORTED_NAMES = Object.freeze(['잡동사니']);
export const LOOKUP_MAX = 1500;     // 한 번에 드라이브에 묻는 파일 수(넘으면 partial — 정리 뒤 다시 열면 나머지)
export const LOOKUP_PARALLEL = 10;
export const LOOKUP_BUDGET_MS = 40000;
export const APPLY_MAX = 300;       // 정리 한 번에 다루는 자료 수(남길 것 + 지울 것)
export const PREVIEW_GROUPS_MAX = 300;
const MD5 = /^[0-9a-f]{32}$/;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isDriveId = v => typeof v === 'string' && DRIVE_ID.test(v);
export const isUuid = v => typeof v === 'string' && UUID.test(v);
export const isLinkMime = m => String(m || '').startsWith('application/vnd.google-apps.');

// 내용 열쇠 'md5:크기'(둘 다 있어야). 없으면 null.
export function hashKey(md5, size) {
  const n = Number(size);
  return typeof md5 === 'string' && MD5.test(md5) && Number.isSafeInteger(n) && n > 0 ? `${md5}:${n}` : null;
}
// 드라이브 파일 메타데이터 → 열쇠(휴지통 파일은 없음).
export const fileKey = f => (f && f.trashed !== true ? hashKey(f.md5Checksum, f.size) : null);
// 내용 비교 대상 자료: 드라이브 파일 id가 있고 링크형(구글 문서류)이 아님.
export const hashable = d => !!d && isDriveId(d.file_id) && !isLinkMime(d.mime_type);

// 크기가 같은 자료가 둘 이상인 것(크기를 모르는 자료가 있으면 그것과 견줄 모든 자료)의 드라이브 id — 드라이브에 물을 것.
export function lookupTargets(docs) {
  const bySize = new Map(), unknown = [];
  for (const d of Array.isArray(docs) ? docs : []) {
    if (!hashable(d)) continue;
    const n = Number(d.file_size);
    if (!Number.isSafeInteger(n) || n <= 0) { unknown.push(d.file_id); continue; }
    if (!bySize.has(n)) bySize.set(n, new Set());
    bySize.get(n).add(d.file_id);
  }
  const sized = [...bySize.values()].filter(s => s.size >= 2 || unknown.length).flatMap(s => [...s]);
  // 같은 드라이브 파일을 가리키는 자료 둘(같은 id)도 같은 내용이다 — id가 하나뿐이어도 물어 열쇠를 얻는다.
  const twinIds = [];
  const seen = new Map();
  for (const d of Array.isArray(docs) ? docs : []) if (hashable(d)) seen.set(d.file_id, (seen.get(d.file_id) || 0) + 1);
  for (const [fid, n] of seen) if (n >= 2) twinIds.push(fid);
  return [...new Set([...twinIds, ...sized, ...unknown])];
}

// 폴더 표 → 보이는 폴더·경로 글자·'분류 안 된 폴더'(받는 폴더와 그 아래, 이름 '잡동사니', 같은 내용 정리 폴더).
export function folderInfo(folders, receiveId = null) {
  const list = Array.isArray(folders) ? folders.filter(f => isUuid(f?.id)) : [];
  const byId = new Map(list.map(f => [f.id, f]));
  const pathMemo = new Map(), unsortedMemo = new Map();
  const pathOf = id => {
    if (!id || !byId.has(id)) return '폴더 밖';
    if (pathMemo.has(id)) return pathMemo.get(id);
    const names = [];
    for (let cur = id, depth = 0; cur && byId.has(cur) && depth < 10; depth++) { names.unshift(String(byId.get(cur).name || '폴더')); cur = byId.get(cur).parent_id; }
    const p = names.join(' › ');
    pathMemo.set(id, p);
    return p;
  };
  const unsorted = id => {
    if (!id || !byId.has(id)) return true; // 폴더 밖
    if (unsortedMemo.has(id)) return unsortedMemo.get(id);
    let hit = false;
    for (let cur = id, depth = 0; cur && byId.has(cur) && depth < 10; depth++) {
      const f = byId.get(cur), name = String(f.name || '').trim();
      if (cur === receiveId || UNSORTED_NAMES.includes(name) || name.startsWith(SAME_FOLDER_PREFIX)) { hit = true; break; }
      cur = f.parent_id;
    }
    unsortedMemo.set(id, hit);
    return hit;
  };
  return { visible: new Set(byId.keys()), pathOf, unsorted };
}

const recKey = r => `${r?.google_task_id ?? ''}\u0000${r?.note_id ?? ''}`;
// 자료마다 기록 연결 모음.
export function linksByDoc({ records = [], snaps = [] } = {}) {
  const out = new Map();
  const at = id => { if (!out.has(id)) out.set(id, { records: [], snaps: [] }); return out.get(id); };
  for (const r of Array.isArray(records) ? records : []) if (isUuid(r?.document_id)) at(r.document_id).records.push(r);
  for (const s of Array.isArray(snaps) ? snaps : []) if (isUuid(s?.document_id)) at(s.document_id).snaps.push(s);
  return out;
}
const linked = (d, l) => !!(d?.meeting_id || d?.organization_id || l?.records?.length || l?.snaps?.length);

// 지울 자료들의 연결을 남길 자료로 옮길 수 있는가. 반환 {ok, records:[{id,from,to}], snaps:[{id,from,to}]}.
export function linkMoves(keep, drops, linkMap) {
  const kl = linkMap.get(keep.id) || { records: [], snaps: [] };
  const have = new Set(kl.records.map(recKey));
  const records = [], snaps = [];
  for (const d of drops) {
    if (d.meeting_id && d.meeting_id !== keep.meeting_id) return { ok: false, records: [], snaps: [] };
    if (d.organization_id && d.organization_id !== keep.organization_id) return { ok: false, records: [], snaps: [] };
    const l = linkMap.get(d.id) || { records: [], snaps: [] };
    for (const r of l.records) {
      const k = recKey(r);
      if (have.has(k)) return { ok: false, records: [], snaps: [] }; // 남길 자료에 같은 연결이 이미 있음(옮기면 겹침)
      have.add(k); records.push({ id: r.id, from: d.id, to: keep.id });
    }
    for (const s of l.snaps) snaps.push({ id: s.id, from: d.id, to: keep.id });
  }
  return { ok: true, records, snaps };
}

// 남길 것 순서: 손으로 분류한 폴더 > 기록 연결 > 먼저 들어온 것 > id.
export function rankDocs(list, { itemOf, info, linkMap }) {
  const sorted = d => (info.unsorted(itemOf.get(d.id) || null) ? 0 : 1);
  const has = d => (linked(d, linkMap.get(d.id)) ? 1 : 0);
  return [...list].sort((a, b) => sorted(b) - sorted(a) || has(b) - has(a)
    || String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id).localeCompare(String(b.id)));
}

// 정리 계획(아무것도 바꾸지 않음). docs: 자료 행, keys: Map(드라이브 id → 열쇠), items: Map(자료 id → 폴더 id), folders: 보이는 폴더 행.
// 휴지통 폴더에 든 자료(보이는 폴더 목록에 없는 폴더에 연결)는 이미 휴지통이므로 대상에서 뺀다.
export function planSameContent({ docs, keys, items, folders, receiveId = null, links = {} }) {
  const info = folderInfo(folders, receiveId);
  const itemOf = items instanceof Map ? items : new Map();
  const linkMap = linksByDoc(links);
  const groups = new Map();
  for (const d of Array.isArray(docs) ? docs : []) {
    if (!hashable(d) || !isUuid(d.id)) continue;
    const fid = itemOf.get(d.id) || null;
    if (fid && !info.visible.has(fid)) continue; // 휴지통 폴더 안
    const key = keys.get(d.file_id);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(d);
  }
  const out = [];
  let trash = 0, skipped = 0;
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const [keep, ...drops] = rankDocs(list, { itemOf, info, linkMap });
    const mv = linkMoves(keep, drops, linkMap);
    const view = d => ({ id: d.id, title: String(d.title || d.file_name || '자료'), path: info.pathOf(itemOf.get(d.id) || null) });
    out.push({ key, keep: view(keep), drop: drops.map(view), skip: mv.ok ? null : 'linked' });
    if (mv.ok) trash += drops.length; else skipped++;
  }
  out.sort((a, b) => (a.skip ? 1 : 0) - (b.skip ? 1 : 0) || a.keep.title.localeCompare(b.keep.title, 'ko'));
  return { groups: out, totals: { groups: out.length, trash, skipped } };
}

// 요청 모양: {action:'same-content-scan'} | {action:'same-content-apply', groups:[{keep, drop:[...]}]} | {action:'same-content-undo', undo:{...}}. 아니면 null.
export function parseSameRequest(input) {
  if (!input || typeof input !== 'object') return null;
  const keys = Object.keys(input).sort().join(',');
  if (input.action === 'same-content-scan') return keys === 'action' ? { action: 'scan' } : null;
  if (input.action === 'same-content-apply') {
    const g = input.groups;
    if (keys !== 'action,groups' || !Array.isArray(g) || !g.length) return null;
    const seen = new Set();
    let n = 0;
    for (const x of g) {
      if (!x || typeof x !== 'object' || Object.keys(x).sort().join(',') !== 'drop,keep' || !isUuid(x.keep) || !Array.isArray(x.drop) || !x.drop.length) return null;
      for (const id of [x.keep, ...x.drop]) { if (!isUuid(id) || seen.has(id)) return null; seen.add(id); n++; }
    }
    if (n > APPLY_MAX) return null;
    return { action: 'apply', groups: g.map(x => ({ keep: x.keep, drop: [...x.drop] })) };
  }
  if (input.action === 'same-content-undo') {
    const u = input.undo;
    if (keys !== 'action,undo' || !u || typeof u !== 'object' || !isUuid(u.folder) || !Array.isArray(u.moves) || !Array.isArray(u.links)) return null;
    if (u.moves.length > APPLY_MAX || u.links.length > APPLY_MAX * 20) return null;
    for (const m of u.moves) if (!m || !isUuid(m.d) || !(m.f === null || isUuid(m.f))) return null;
    for (const l of u.links) if (!l || !['r', 's'].includes(l.t) || !isUuid(l.id) || !isUuid(l.from) || !isUuid(l.to)) return null;
    return { action: 'undo', undo: { folder: u.folder, moves: u.moves.map(m => ({ d: m.d, f: m.f })), links: u.links.map(l => ({ t: l.t, id: l.id, from: l.from, to: l.to })) } };
  }
  return null;
}

// 정리 폴더 이름(한국 시각, 40자 안).
export function folderName(now = new Date()) {
  const k = new Date(now.getTime() + 9 * 3600e3), p = n => String(n).padStart(2, '0');
  return `${SAME_FOLDER_PREFIX} ${k.getUTCMonth() + 1}-${k.getUTCDate()} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

export class SameFail extends Error { constructor(code, status = 503) { super(code); this.code = code; this.status = status; } }

// 드라이브 메타데이터로 열쇠 묻기(내용 열지 않음). 반환 {keys: Map(id → 열쇠|null), partial}.
export async function lookupKeys(ids, { fetch: request, token, log = () => {}, max = LOOKUP_MAX, budgetMs = LOOKUP_BUDGET_MS, now = () => Date.now() }) {
  const keys = new Map(), list = [...new Set((Array.isArray(ids) ? ids : []).filter(isDriveId))];
  const queue = list.slice(0, max);
  let partial = list.length > max;
  const start = now();
  let fatal = null;
  const one = async id => {
    let r;
    try { r = await request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,md5Checksum,size,trashed`, { headers: { Authorization: `Bearer ${token}` } }); }
    catch { log('hash_network'); keys.set(id, null); return; }
    if (r.status === 401 || r.status === 403) { fatal ||= new SameFail(r.status === 401 ? 'drive_auth_expired' : 'drive_denied', 424); return; }
    if (!r.ok) { if (r.status !== 404) log('hash_' + r.status); keys.set(id, null); return; }
    let d = {};
    try { d = await r.json(); } catch { d = {}; }
    keys.set(id, fileKey(d));
  };
  const workers = Array.from({ length: Math.min(LOOKUP_PARALLEL, queue.length) }, async () => {
    while (queue.length && !fatal) {
      if (now() - start > budgetMs) { partial = true; queue.length = 0; break; }
      await one(queue.shift());
    }
  });
  await Promise.all(workers);
  if (fatal) throw fatal;
  return { keys, partial };
}

// 입출력 묶음. deps: {db(로그인한 사람 토큰의 supabase), fetch, token, workspaceId, userId, now?, log?}
export function createSameContent(deps) {
  const { db, token, workspaceId, userId } = deps;
  const request = deps.fetch ?? globalThis.fetch;
  const log = deps.log ?? (code => console.error('library-files same-content', { code }));
  const nowDate = deps.now ?? (() => new Date());
  const ws = workspaceId;
  const DOC_COLS = 'id,title,file_name,file_id,file_size,mime_type,created_at,meeting_id,organization_id';

  async function pages(build) {
    const rows = [];
    for (let from = 0; from < 100000; from += 1000) {
      const { data, error } = await build().range(from, from + 999);
      if (error) { log('read'); throw new SameFail('db_read'); }
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return rows;
  }
  const inChunks = async (ids, build) => {
    const out = [];
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await build(ids.slice(i, i + 100));
      if (error) { log('read_in'); throw new SameFail('db_read'); }
      out.push(...(data || []));
    }
    return out;
  };
  async function receiveFolder() {
    const { data, error } = await db.from('app_profiles').select('library_receive_folder').eq('user_id', userId).maybeSingle();
    if (error) return null; // 칸이 없거나 읽기 실패 — 받는 폴더 없이 이름('잡동사니')으로만
    return isUuid(data?.library_receive_folder) ? data.library_receive_folder : null;
  }
  const readFolders = () => pages(() => db.from('app_library_folders').select('id,parent_id,name').eq('workspace_id', ws).order('id'));
  async function readItems(docIds = null) {
    const rows = docIds
      ? await inChunks(docIds, part => db.from('app_library_folder_items').select('document_id,folder_id').eq('workspace_id', ws).in('document_id', part))
      : await pages(() => db.from('app_library_folder_items').select('document_id,folder_id').eq('workspace_id', ws).order('document_id'));
    return new Map(rows.map(r => [r.document_id, r.folder_id]));
  }
  async function readLinks(docIds) {
    const records = await inChunks(docIds, part => db.from('app_record_links').select('id,document_id,google_task_id,note_id').eq('workspace_id', ws).in('document_id', part));
    const snaps = await inChunks(docIds, part => db.from('app_report_snapshots').select('id,document_id').eq('workspace_id', ws).in('document_id', part));
    return { records, snaps };
  }

  async function scan() {
    const [docs, folders, receiveId] = await Promise.all([
      pages(() => db.from('app_documents').select(DOC_COLS).eq('workspace_id', ws).not('file_id', 'is', null).order('id')),
      readFolders(), receiveFolder(),
    ]);
    const items = await readItems();
    const info = folderInfo(folders, receiveId);
    const live = docs.filter(d => { const f = items.get(d.id); return !f || info.visible.has(f); });
    const { keys, partial } = await lookupKeys(lookupTargets(live), { fetch: request, token, log });
    const sameIds = new Set();
    const byKey = new Map();
    for (const d of live) { const k = hashable(d) ? keys.get(d.file_id) : null; if (k) byKey.set(k, (byKey.get(k) || 0) + 1); }
    for (const d of live) { const k = hashable(d) ? keys.get(d.file_id) : null; if (k && byKey.get(k) >= 2) sameIds.add(d.id); }
    const links = sameIds.size ? await readLinks([...sameIds]) : { records: [], snaps: [] };
    const plan = planSameContent({ docs: live, keys, items, folders, receiveId, links });
    const more = plan.groups.length > PREVIEW_GROUPS_MAX;
    return { ok: true, groups: more ? plan.groups.slice(0, PREVIEW_GROUPS_MAX) : plan.groups, totals: plan.totals, more, partial };
  }

  // 화면이 고른 묶음(남길 것·지울 것)을 다시 확인하고 정리한다.
  async function apply(groups) {
    const ids = groups.flatMap(g => [g.keep, ...g.drop]);
    const docs = await inChunks(ids, part => db.from('app_documents').select(DOC_COLS).eq('workspace_id', ws).in('id', part));
    const byId = new Map(docs.map(d => [d.id, d]));
    const [folders, receiveId, items, links] = await Promise.all([readFolders(), receiveFolder(), readItems(ids), readLinks(ids)]);
    const info = folderInfo(folders, receiveId);
    const fileIds = docs.filter(hashable).map(d => d.file_id);
    const { keys, partial } = await lookupKeys(fileIds, { fetch: request, token, log, max: APPLY_MAX });
    if (partial) throw new SameFail('drive_slow');
    const linkMap = linksByDoc(links);
    const ready = [];
    let skipped = 0;
    for (const g of groups) {
      const keep = byId.get(g.keep), drops = g.drop.map(id => byId.get(id));
      const alive = d => d && hashable(d) && (!items.get(d.id) || info.visible.has(items.get(d.id)));
      const key = keep && alive(keep) ? keys.get(keep.file_id) : null;
      if (!key || !drops.every(d => alive(d) && keys.get(d.file_id) === key)) { skipped++; continue; }
      const mv = linkMoves(keep, drops, linkMap);
      if (!mv.ok) { skipped++; continue; }
      ready.push({ keep, drops, mv });
    }
    if (!ready.length) return { ok: true, trashed: 0, skipped, undo: null };
    const at = nowDate();
    const folderNameFor = () => folderName(at);
    const { data: folder, error: fe } = await db.from('app_library_folders')
      .insert({ workspace_id: ws, project_id: null, parent_id: null, name: folderNameFor(), sort_order: 0 }).select('id').single();
    if (fe || !isUuid(folder?.id)) { log('folder_create'); throw new SameFail('db_write'); }
    const name = folderNameFor();
    const undo = { folder: folder.id, moves: [], links: [] };
    let trashed = 0;
    for (const g of ready) {
      // 1) 연결 옮기기(실패하면 이 묶음에서 옮긴 것을 되돌리고 건너뜀)
      const done = [];
      let bad = false;
      for (const [t, table, list] of [['r', 'app_record_links', g.mv.records], ['s', 'app_report_snapshots', g.mv.snaps]]) {
        for (const l of list) {
          const { data, error } = await db.from(table).update({ document_id: l.to }).eq('workspace_id', ws).eq('id', l.id).eq('document_id', l.from).select('id');
          if (error || !Array.isArray(data) || data.length !== 1) { bad = true; break; }
          done.push({ t, table, ...l });
        }
        if (bad) break;
      }
      if (bad) {
        for (const l of done.reverse()) await db.from(l.table).update({ document_id: l.from }).eq('workspace_id', ws).eq('id', l.id).eq('document_id', l.to);
        skipped++;
        continue;
      }
      // 2) 지울 자료를 정리 폴더로
      const dropIds = g.drops.map(d => d.id);
      const withItem = dropIds.filter(id => items.has(id)), without = dropIds.filter(id => !items.has(id));
      let moved = [];
      if (withItem.length) {
        const { data, error } = await db.from('app_library_folder_items').update({ folder_id: folder.id }).eq('workspace_id', ws).in('document_id', withItem).select('document_id');
        if (!error && Array.isArray(data)) moved.push(...data.map(r => r.document_id));
      }
      if (without.length) {
        const { data, error } = await db.from('app_library_folder_items').insert(without.map(id => ({ document_id: id, folder_id: folder.id, workspace_id: ws }))).select('document_id');
        if (!error && Array.isArray(data)) moved.push(...data.map(r => r.document_id));
      }
      moved = moved.filter(id => dropIds.includes(id));
      for (const id of moved) undo.moves.push({ d: id, f: items.get(id) || null });
      for (const l of done) undo.links.push({ t: l.t, id: l.id, from: l.from, to: l.to });
      trashed += moved.length;
    }
    if (!trashed) { // 하나도 못 옮김 — 빈 정리 폴더는 남기지 않는다
      await db.from('app_library_folders').delete().eq('workspace_id', ws).eq('id', folder.id);
      await db.rpc('app_trash_purge', { p_kind: 'library_folder', p_id: folder.id });
      return { ok: true, trashed: 0, skipped, undo: null };
    }
    // 3) 정리 폴더를 지운다 = 서버 트리거가 휴지통 표시로(폴더·자료 연결은 그대로, 자료실 목록에서 숨음)
    const { error: de } = await db.from('app_library_folders').delete().eq('workspace_id', ws).eq('id', folder.id);
    const { data: still } = await db.from('app_library_folders').select('id').eq('workspace_id', ws).eq('id', folder.id).maybeSingle();
    const inTrash = !de && !still;
    if (!inTrash) log('folder_trash');
    return { ok: true, trashed, skipped, in_trash: inTrash, folder_name: name, undo };
  }

  // 되돌리기: 정리 폴더를 휴지통에서 꺼내고, 아직 그 폴더에 있는 자료만 원래 폴더(없어졌으면 폴더 밖)로, 옮긴 연결은 아직 남길 자료를 가리키는 것만 되돌린다.
  async function undo(u) {
    const { error: re } = await db.rpc('app_trash_restore', { p_kind: 'library_folder', p_id: u.folder });
    const { data: f } = await db.from('app_library_folders').select('id,name').eq('workspace_id', ws).eq('id', u.folder).maybeSingle();
    if (!f || !String(f.name || '').startsWith(SAME_FOLDER_PREFIX)) { if (re) log('undo_restore'); throw new SameFail('undo_gone', 409); }
    const folders = await readFolders();
    const alive = new Set(folders.map(x => x.id));
    let back = 0, miss = 0;
    for (const m of u.moves) {
      const q = db.from('app_library_folder_items');
      const to = m.f && alive.has(m.f) && m.f !== u.folder ? m.f : null;
      const { data, error } = to
        ? await q.update({ folder_id: to }).eq('workspace_id', ws).eq('document_id', m.d).eq('folder_id', u.folder).select('document_id')
        : await q.delete().eq('workspace_id', ws).eq('document_id', m.d).eq('folder_id', u.folder).select('document_id');
      if (!error && Array.isArray(data) && data.length === 1) back++; else miss++;
    }
    for (const l of u.links) {
      const table = l.t === 'r' ? 'app_record_links' : 'app_report_snapshots';
      await db.from(table).update({ document_id: l.from }).eq('workspace_id', ws).eq('id', l.id).eq('document_id', l.to);
    }
    // 비게 된 정리 폴더만 지운다(휴지통을 거쳐 영구 삭제 — 안에 아무것도 없음). 남은 자료가 있으면 보이는 폴더로 둔다.
    const [{ data: left }, { data: sub }] = await Promise.all([
      db.from('app_library_folder_items').select('document_id').eq('workspace_id', ws).eq('folder_id', u.folder).limit(1),
      db.from('app_library_folders').select('id').eq('workspace_id', ws).eq('parent_id', u.folder).limit(1),
    ]);
    if (Array.isArray(left) && !left.length && Array.isArray(sub) && !sub.length) {
      await db.from('app_library_folders').delete().eq('workspace_id', ws).eq('id', u.folder);
      const { error: pe } = await db.rpc('app_trash_purge', { p_kind: 'library_folder', p_id: u.folder });
      if (pe) log('undo_purge');
    }
    return { ok: true, restored: back, missed: miss };
  }

  return { scan, apply, undo, SameFail };
}
