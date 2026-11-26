// S69-45 LIB-같은내용정리(명진 11/24 15:50 "자료실에 없는 파일만 가져오는거 맞지? 중복해서 안가져오는거 믿을만 한거지?",
// 15:51 "중복된 파일들이 있는거같어. 일단 잡동사니에 넣어둘테니깐 중복된거 지워 알아서").
// S70-29(2026-11-25 명진 '다 없애 1회용 기능'): 자료실 ⋯ [같은 내용 자료 정리](미리 보기·정리·되돌리기)는 한 번 정리라 지웠다.
// 남은 일 하나: [드라이브에서 가져오기] 목록에서 드라이브 '파일 id'가 달라도 내용(md5Checksum + 크기)이 자료실 자료와 같으면 '이미 있음(같은 내용)'.
// - 내용 비교는 드라이브가 주는 md5Checksum·size(파일 메타데이터)만 쓴다. 파일 내용은 열지 않는다(files.get fields=id,md5Checksum,size,trashed).
//   md5가 없는 구글 문서·시트·슬라이드(링크형)는 비교하지 않는다.
// - 예전 정리 때 만든 '같은 내용 정리 …' 폴더(자료실 휴지통에 있음)는 지우지 않는다(데이터 보존). folderInfo는 그 이름도 '분류 안 된 폴더'로 본다.
// 시험: tests/security/library-files-same-content.test.mjs.

export const SAME_FOLDER_PREFIX = '같은 내용 정리';
export const UNSORTED_NAMES = Object.freeze(['잡동사니']);
export const LOOKUP_MAX = 1500;     // 한 번에 드라이브에 묻는 파일 수(넘으면 partial)
export const LOOKUP_PARALLEL = 10;
export const LOOKUP_BUDGET_MS = 40000;
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

// [드라이브에서 가져오기] 목록에 '이미 있음(같은 내용)' 붙이기. items: planImport 항목, fileKeys: Map(목록 파일 id → 열쇠),
// docIndex: Map(열쇠 → {title, path}) — 자료실 자료. 같은 목록 안에서 같은 내용이 앞에 있으면 그 파일 이름(inList).
export function markSame(items, fileKeys, docIndex) {
  const first = new Map();
  let same = 0;
  const out = (Array.isArray(items) ? items : []).map(it => {
    const key = it?.kind === 'file' ? fileKeys.get(it.id) : null;
    if (!key) return it;
    const hit = docIndex.get(key);
    if (hit) { same++; return { ...it, same: { title: hit.title, path: hit.path } }; }
    if (first.has(key)) { same++; return { ...it, same: { title: first.get(key), path: '이 목록', inList: true } }; }
    first.set(key, it.name);
    return it;
  });
  return { items: out, same };
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
