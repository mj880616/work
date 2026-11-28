// S69-45 LIB-같은내용정리(명진 11/24 15:50 "자료실에 없는 파일만 가져오는거 맞지? 중복해서 안가져오는거 믿을만 한거지?").
// S70-29(2026-11-25 명진 '다 없애 1회용 기능'): 자료실 ⋯ [같은 내용 자료 정리]는 지웠다.
// S70-73(2026-11-26 명진 "자동으로 들어오게해야지 메뉴 없애고"): [드라이브에서 가져오기]도 지웠다. 남은 일 하나:
//   드라이브 자동 등록(drive-auto.mjs)이 드라이브 '파일 id'가 달라도 내용(md5Checksum + 크기)이 자료실 자료와 같으면 넣지 않는 판정.
// - 내용 비교는 드라이브가 주는 md5Checksum·size(파일 메타데이터)만 쓴다. 파일 내용은 열지 않는다(files.get fields=id,md5Checksum,size,trashed).
//   md5가 없는 구글 문서·시트·슬라이드(링크형)는 비교하지 않는다.
// - 예전 정리 때 만든 '같은 내용 정리 …' 폴더(자료실 휴지통에 있음)는 지우지 않는다(데이터 보존).
// 시험: tests/security/library-files-same-content.test.mjs, tests/security/library-files-drive-auto.test.mjs.

export const LOOKUP_MAX = 1500;     // 한 번에 드라이브에 묻는 파일 수(넘으면 partial)
export const LOOKUP_PARALLEL = 10;
export const LOOKUP_BUDGET_MS = 40000;
const MD5 = /^[0-9a-f]{32}$/;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;
export const isDriveId = v => typeof v === 'string' && DRIVE_ID.test(v);
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
