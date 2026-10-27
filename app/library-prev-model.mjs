// LIB-이전파일정리: 자료실 [이전 파일 ▾] 목록(app_documents.previous_files)의 자동 정리 규칙. 순수 함수만(브라우저·Edge 공용).
// 항목은 {file_id, file_name, mime_type, file_size, drive_url, replaced_at} + 서버가 더하는 칸:
//   keep_at     [계속 보관]을 누른 시각(있으면 자동 삭제에서 빠짐)
//   unkeep_at   보관을 풀어 준 시각(이때부터 다시 30일)
//   pruned_at   서버가 정리한 시각(목록에서 빠짐), prune_result: 'trashed'(Drive 휴지통으로 옮김) | 'list_only'(Web2가 올린 파일이 아니어서 목록에서만 뺌)
// 교체한 날(replaced_at)부터 30일이 지나면 하루 한 번 도는 서버 작업이 정리한다. 영구 삭제는 없다(Drive가 휴지통을 30일 뒤 스스로 비운다).
export const PRUNE_DAYS = 30;
export const DAY_MS = 86400000;
const FILE_ID = /^[A-Za-z0-9_-]{1,255}$/;
const time = v => { if (typeof v !== 'string' || v.length > 40) return null; const t = Date.parse(v); return Number.isFinite(t) ? t : null; };
export const isEntry = e => !!e && typeof e === 'object' && !Array.isArray(e) && typeof e.file_id === 'string' && FILE_ID.test(e.file_id);

export function isPruned(e) { return !!e && typeof e.pruned_at === 'string' && e.pruned_at !== ''; }
export function isKept(e) { return !!e && typeof e.keep_at === 'string' && e.keep_at !== ''; }
// 30일을 세기 시작하는 때: 교체한 시각, 보관을 풀었다면 그 시각 중 늦은 것. 시각을 못 읽으면 null(자동 삭제 대상이 아님).
export function baseTime(e) {
  const replaced = time(e?.replaced_at);
  if (replaced === null) return null;
  const released = time(e?.unkeep_at);
  return released !== null && released > replaced ? released : replaced;
}
export function pruneAtMs(e) { const base = baseTime(e); return base === null ? null : base + PRUNE_DAYS * DAY_MS; }

// state: 'pruned' | 'kept' | 'waiting'(날짜가 남음) | 'due'(날짜가 지났고 서버가 곧 정리) | 'unknown'(시각 없음, 자동 삭제 안 함)
export function entryState(e, nowMs) {
  if (isPruned(e)) return { state: 'pruned', daysLeft: null };
  if (isKept(e)) return { state: 'kept', daysLeft: null };
  const at = pruneAtMs(e);
  if (at === null) return { state: 'unknown', daysLeft: null };
  if (at <= nowMs) return { state: 'due', daysLeft: 0 };
  return { state: 'waiting', daysLeft: Math.ceil((at - nowMs) / DAY_MS) };
}
export function visibleEntries(list) { return (Array.isArray(list) ? list : []).filter(e => isEntry(e) && !isPruned(e)); }
export function dueEntries(list, nowMs) { return visibleEntries(list).filter(e => entryState(e, nowMs).state === 'due'); }
export function counts(list, nowMs) {
  const out = { total: 0, pruned: 0, kept: 0, waiting: 0, due: 0, unknown: 0 };
  for (const e of Array.isArray(list) ? list : []) { if (!isEntry(e)) continue; out.total++; out[entryState(e, nowMs).state]++; }
  return out;
}
export function deleteLabel(e, nowMs) {
  const s = entryState(e, nowMs);
  if (s.state === 'kept') return '보관';
  if (s.state === 'waiting') return `${s.daysLeft}일 뒤 삭제`;
  if (s.state === 'due') return '곧 삭제';
  return '';
}

// 불변 갱신. 결과 {list, changed, error}: error 'not_found' | 'already_pruned'.
export function setKeep(list, fileId, keep, nowIso) {
  const src = Array.isArray(list) ? list : [];
  const i = src.findIndex(e => isEntry(e) && e.file_id === fileId);
  if (i < 0) return { list: src, changed: false, error: 'not_found' };
  const e = src[i];
  if (isPruned(e)) return { list: src, changed: false, error: 'already_pruned' };
  if (isKept(e) === !!keep) return { list: src, changed: false, error: null };
  const next = { ...e };
  if (keep) { next.keep_at = nowIso; delete next.unkeep_at; } else { delete next.keep_at; next.unkeep_at = nowIso; }
  return { list: src.map((x, n) => n === i ? next : x), changed: true, error: null };
}
export function markPruned(list, fileId, result, nowIso) {
  const src = Array.isArray(list) ? list : [];
  const i = src.findIndex(e => isEntry(e) && e.file_id === fileId);
  if (i < 0 || isPruned(src[i]) || isKept(src[i]) || !['trashed', 'list_only'].includes(result)) return { list: src, changed: false };
  return { list: src.map((x, n) => n === i ? { ...x, pruned_at: nowIso, prune_result: result } : x), changed: true };
}
