// LIB-이전파일정리 (사용자 결정 2026-10-27): 자료실 [수정]에서 파일을 교체해 밀려난 '이전 파일'은 교체한 지 30일이 지나면
// 하루 한 번 Drive 휴지통으로 옮기고 [이전 파일 ▾] 목록에서 뺀다. 영구 삭제는 없다(Drive가 휴지통을 30일 뒤 스스로 비운다).
// 순수 로직 + 주입한 경계(db, drive)만 쓴다(Node 시험이 같은 코드를 돈다). 규칙:
// - 대상: app_documents.previous_files 항목 중 교체한 지 30일이 지났고 [계속 보관]이 아닌 것. 자료 줄 자체·지금 쓰는 파일(file_id)은 건드리지 않는다.
// - 휴지통으로 옮기는 파일: 내 소유이고 자료실 폴더 바로 아래(Web2가 올린 것)인 것만. 그 밖(원래 Drive에 있던 파일을 등록한 경우 등)은
//   Drive를 건드리지 않고 목록에서만 뺀다(prune_result 'list_only'). 일시 오류(네트워크·5xx)는 아무것도 바꾸지 않고 다음 날 다시 한다.
// - 다른 기록(다른 자료의 지금 파일·이전 파일, 노트 첨부, 할 일 첨부)이 같은 Drive 파일을 쓰면 건드리지 않는다. 참조를 못 읽으면 멈춘다.
// - 기록: 옮긴 항목에 pruned_at·prune_result를 남긴다(어느 파일을 언제). 자료 행의 updated_at은 바꾸지 않는다.
// - 쓰기는 읽은 updated_at 그대로일 때만(교체·보관 표시·수정과 겹치면 다시 읽어 적용). 하룻밤 최대 maxPerRun개.
// - 응답·기록에는 건수만. 파일 이름·ID는 내보내지 않는다.
import { counts, dueEntries, markPruned } from '../_shared/library-prev-model.mjs';

export const PREV_PRUNE = Object.freeze({ maxPerRun: 50, dryInspectMax: 300, pageSize: 200, maxPages: 50, budgetMs: 100000, writeTries: 3 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class PrevPruneError extends Error {
  constructor(code, status = 502) { super(code); this.status = status; }
}
const cs = value => encodeURIComponent(JSON.stringify(value));

// db: {get(path) → 행 배열, patch(path, body) → 바뀐 행 배열}.
// drive: {inspect(fileId) → 'ready'|'already_trashed'|'not_ours'|'retry', trash(fileId) → 'trashed'|'already_trashed'|'not_ours'|'retry'|'unknown'}.
export async function runLibraryPrevPrune({ db, drive, workspaceId, dryRun = false, now = () => new Date(), clock = () => Date.now(), limits = PREV_PRUNE }) {
  if (typeof workspaceId !== 'string' || !UUID.test(workspaceId)) throw new PrevPruneError('WORKSPACE_UNAVAILABLE');
  const ws = `workspace_id=eq.${encodeURIComponent(workspaceId)}`;
  const started = clock();
  const nowMs = now().getTime();

  // 1) 이전 파일이 있는 자료를 모두 읽는다(읽기 실패·너무 큼이면 멈춤).
  const docs = [];
  for (let page = 0; ; page++) {
    if (page >= limits.maxPages) throw new PrevPruneError('DB_READ_LIMIT');
    const rows = await db.get(`app_documents?${ws}&previous_files=neq.${cs([])}&select=id,previous_files,updated_at&order=id.asc&limit=${limits.pageSize}&offset=${page * limits.pageSize}`);
    if (!Array.isArray(rows)) throw new PrevPruneError('DB_READ_FAILED');
    for (const r of rows) if (typeof r?.id === 'string' && UUID.test(r.id) && Array.isArray(r.previous_files)) docs.push(r);
    if (rows.length < limits.pageSize) break;
  }
  const total = { documents: docs.length, entries: 0, pruned: 0, kept: 0, waiting: 0, due: 0, no_date: 0 };
  const due = [];
  for (const d of docs) {
    const c = counts(d.previous_files, nowMs);
    total.entries += c.total; total.pruned += c.pruned; total.kept += c.kept; total.waiting += c.waiting; total.due += c.due; total.no_date += c.unknown;
    for (const e of dueEntries(d.previous_files, nowMs)) due.push({ docId: d.id, fileId: e.file_id, base: Date.parse(e.replaced_at) });
  }
  due.sort((a, b) => a.base - b.base || (a.fileId < b.fileId ? -1 : 1));

  const referenced = async (docId, fileId) => {
    const id = encodeURIComponent(fileId);
    const checks = [
      `app_documents?${ws}&file_id=eq.${id}&select=id&limit=1`,
      `app_documents?${ws}&id=neq.${docId}&previous_files=cs.${cs([{ file_id: fileId }])}&select=id&limit=1`,
      `app_notes?attachments=cs.${cs([{ drive_file_id: fileId }])}&select=id&limit=1`,
      `app_task_attachments?drive_file_id=eq.${id}&select=id&limit=1`,
    ];
    for (const path of checks) {
      const rows = await db.get(path);
      if (!Array.isArray(rows)) throw new PrevPruneError('REFERENCE_UNAVAILABLE');
      if (rows.length) return true;
    }
    return false;
  };

  if (dryRun) {
    // 읽기 전용: Drive를 읽어 "휴지통으로 갈 것 / 목록에서만 뺄 것 / 오류"를 센다. 아무것도 쓰지 않는다.
    const out = { ...total, dry_run: true, would_trash: 0, would_list_only: 0, already_trashed: 0, referenced: 0, retry: 0, not_checked: 0 };
    let checked = 0;
    for (const item of due) {
      if (checked >= limits.dryInspectMax || clock() - started > limits.budgetMs) { out.not_checked++; continue; }
      checked++;
      if (await referenced(item.docId, item.fileId)) { out.referenced++; continue; }
      const seen = await drive.inspect(item.fileId);
      if (seen === 'ready') out.would_trash++;
      else if (seen === 'already_trashed') out.already_trashed++;
      else if (seen === 'not_ours') out.would_list_only++;
      else out.retry++;
    }
    out.over_cap = Math.max(0, out.would_trash + out.would_list_only + out.already_trashed - limits.maxPerRun);
    return out;
  }

  const out = { ...total, dry_run: false, trashed: 0, already_trashed: 0, list_only: 0, referenced: 0, retry: 0, unknown: 0, conflict: 0, deferred: 0, stop: null };
  const done = new Map(); // docId → Map(fileId → 'trashed'|'list_only')
  let handled = 0;
  for (const item of due) {
    if (handled >= limits.maxPerRun) { out.deferred++; continue; }
    if (clock() - started > limits.budgetMs) { out.stop = 'budget'; out.deferred++; continue; }
    if (await referenced(item.docId, item.fileId)) { out.referenced++; continue; }
    handled++;
    const result = await drive.trash(item.fileId);
    if (result === 'trashed' || result === 'already_trashed') {
      out[result]++;
      (done.get(item.docId) || done.set(item.docId, new Map()).get(item.docId)).set(item.fileId, 'trashed');
    } else if (result === 'not_ours') {
      out.list_only++;
      (done.get(item.docId) || done.set(item.docId, new Map()).get(item.docId)).set(item.fileId, 'list_only');
    } else out[result === 'unknown' ? 'unknown' : 'retry']++;
  }

  // 2) 기록. 자료마다 한 번: 읽은 updated_at 그대로일 때만 쓰고, 겹치면 다시 읽어 같은 표시를 다시 적용한다(이미 정리·보관된 항목은 건너뜀).
  const stamp = now().toISOString();
  for (const [docId, marks] of done) {
    let written = false;
    let row = docs.find(d => d.id === docId);
    for (let attempt = 0; attempt < limits.writeTries && !written; attempt++) {
      if (attempt > 0) {
        const fresh = await db.get(`app_documents?${ws}&id=eq.${docId}&select=id,previous_files,updated_at&limit=1`);
        if (!Array.isArray(fresh)) throw new PrevPruneError('DB_READ_FAILED');
        row = fresh[0];
        if (!row || !Array.isArray(row.previous_files)) { written = true; break; }
      }
      let list = row.previous_files, changed = false;
      for (const [fileId, result] of marks) { const m = markPruned(list, fileId, result, stamp); list = m.list; changed ||= m.changed; }
      if (!changed) { written = true; break; }
      const guard = row.updated_at == null ? 'updated_at=is.null' : `updated_at=eq.${encodeURIComponent(row.updated_at)}`;
      const hit = await db.patch(`app_documents?${ws}&id=eq.${docId}&${guard}&select=id`, { previous_files: list });
      written = hit.length === 1;
    }
    if (!written) out.conflict++;
  }
  return out;
}
