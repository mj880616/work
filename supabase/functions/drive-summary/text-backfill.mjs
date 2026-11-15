// LIB-글자채우기야간 (2026-10-23 사용자 결정 10:35): 예전 자료의 파일 안 글자를 서버가 매일 밤 조금씩 읽어 둔다.
// 설계: docs/design/global-search.md 8.7절. 이 파일은 순수 로직 + 주입한 HTTP 경계만 쓴다(Node 시험이 같은 코드를 돈다).
// - 대상: 업무공간 kptu-work의 자료 중 Drive 파일이 있고 아직 한 번도 끝나지 않은 것(extraction_status가 ready·error가 아님).
//   화면의 자료실 자동 채우기(app/document-text-read.js readMissingTexts)와 같은 조건, 같은 최근 것부터.
// - 쓰는 칸: app_documents의 글자 4칸(extracted_text·extraction_status·extraction_error·extracted_at)만. 다른 칸·다른 표는 쓰지 않는다.
//   글자 읽기는 document-actions `document-text`와 같은 한 곳(_shared/document-text.ts)을 주입받아 쓴다. 원본 Drive 파일은 읽기만.
// - 못 읽는 파일이 영원히 막지 않게: 읽기 전에 그 행에 "밤 시도 중"(pending + nightly_try) 표시를 남긴다. 함수가 도중에 끊겨
//   표시가 30분 넘게 남은 행은 다음 실행이 다시 읽지 않고 error(gave_up)로 끝낸다. 읽기 자체의 실패(형식·크기·변환 거절 등)는
//   지금처럼 바로 error로 남는다. Drive 토큰·DB가 안 되면 아무 행도 표시하지 않고 멈춘다(자료 탓이 아님).
// - 응답·기록에는 건수와 단계 코드만. 파일 이름·ID·글자는 내보내지 않는다.
export const TEXT_BACKFILL = Object.freeze({
  batch: 5,            // 한 번 부를 때 읽는 최대 자료 수(화면 AUTO_READ_BATCH와 같음).
  budgetMs: 45000,     // 이 시간이 지나면 새 자료를 시작하지 않는다(파일 하나 최악 ~90초 + 45초 < Edge 150초).
  staleMs: 30 * 60000, // 밤 시도 표시가 이만큼 남아 있으면 끊긴 것으로 보고 error(gave_up)로 끝낸다.
  listExtra: 10,       // 아직 도는 중인 표시 행을 건너뛰고도 batch개를 채우려고 조금 더 읽는다.
});
export const TRY_MARK = 'nightly_try';
export const GAVE_UP = 'gave_up';
const UNFINISHED = 'or=(extraction_status.is.null,extraction_status.not.in.(ready,error))';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class TextBackfillError extends Error {
  constructor(code, status = 502) { super(code); this.status = status; }
}

// Drive 사본 폴더 appProperties의 이 기능 열쇠 3개(다른 경로와 열쇠가 겹치지 않음).
export const DONE_AT = 'text_backfill_done_at', DONE_COUNT = 'text_backfill_count', DISMISSED_AT = 'text_backfill_dismissed_at';
const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;
const time = value => {
  if (typeof value !== 'string' || value.length > 40 || !ISO.test(value)) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
};
// 상태 읽기 쪽: 끝난 시각이 없으면 null. 저장값은 같은 엄격한 모양을 통과한 것만 내보낸다.
export function textBackfillStatus(appProperties) {
  const p = appProperties && typeof appProperties === 'object' ? appProperties : {};
  const doneAt = time(p[DONE_AT]);
  if (!doneAt) return null;
  const raw = p[DONE_COUNT];
  const count = typeof raw === 'string' && /^\d{1,7}$/.test(raw) ? Number(raw) : null;
  return { done_at: doneAt, count, dismissed_at: time(p[DISMISSED_AT]) };
}

// db: {get(path), head(path) → 개수, patch(path, body) → 바뀐 행 배열}. reader: {extract(file)} (던지지 않음).
export async function runTextBackfill({ db, reader, workspaceId, now = () => new Date(), clock = () => Date.now(), limits = TEXT_BACKFILL }) {
  if (typeof workspaceId !== 'string' || !UUID.test(workspaceId)) throw new TextBackfillError('WORKSPACE_UNAVAILABLE');
  const ws = `workspace_id=eq.${encodeURIComponent(workspaceId)}`;
  const started = clock();
  const out = { asked: 0, ready: 0, error: 0, gave_up: 0, skipped: 0, stop: null };

  // 1) 끊긴 밤 시도(표시가 30분 넘게 남은 행)는 다시 읽지 않고 끝낸다. 한 번의 조건부 PATCH.
  const staleBefore = new Date(now().getTime() - limits.staleMs).toISOString();
  const gaveUp = await db.patch(
    `app_documents?${ws}&extraction_status=eq.pending&extraction_error=eq.${TRY_MARK}&extracted_at=lt.${encodeURIComponent(staleBefore)}&select=id`,
    { extracted_text: null, extraction_status: 'error', extraction_error: GAVE_UP, extracted_at: now().toISOString() },
  );
  out.gave_up = gaveUp.length;

  // 2) 아직 끝나지 않은 자료를 최근 것부터. 방금(30분 안) 다른 호출이 읽고 있는 표시 행은 건너뛴다.
  const rows = await db.get(`app_documents?${ws}&${UNFINISHED}&file_id=not.is.null`
    + `&select=id,file_id,file_name,mime_type,file_size,extraction_status,extraction_error&order=created_at.desc,id.desc&limit=${limits.batch + limits.listExtra}`);
  if (!Array.isArray(rows)) throw new TextBackfillError('DB_READ_FAILED');
  const todo = rows.filter(r => typeof r?.id === 'string' && UUID.test(r.id)
    && !(r.extraction_status === 'pending' && r.extraction_error === TRY_MARK)).slice(0, limits.batch);

  for (const row of todo) {
    if (clock() - started > limits.budgetMs) { out.stop = 'budget'; break; }
    const one = `app_documents?id=eq.${encodeURIComponent(row.id)}&${ws}`;
    // 3) 시도 표시. 그 사이 다른 경로(자료실 화면·올리기)가 끝냈으면 0행 → 건너뜀.
    const marked = await db.patch(`${one}&${UNFINISHED}&select=id`,
      { extraction_status: 'pending', extraction_error: TRY_MARK, extracted_at: now().toISOString() });
    if (!marked.length) { out.skipped++; continue; }
    out.asked++;
    const result = await reader.extract({
      fileId: typeof row.file_id === 'string' ? row.file_id : '', name: String(row.file_name || ''), mime: String(row.mime_type || ''),
      size: Number.isSafeInteger(row.file_size) ? row.file_size : null,
    });
    const status = result?.source === 'content' ? 'ready' : 'error';
    // 4) 결과. 우리 표시가 그대로인 행만 바꾼다(다른 경로가 먼저 끝냈으면 그 결과를 덮지 않음).
    await db.patch(`${one}&extraction_status=eq.pending&extraction_error=eq.${TRY_MARK}&select=id`, {
      extracted_text: status === 'ready' ? result.text : null, extraction_status: status,
      extraction_error: status === 'ready' ? null : String(result?.reason || 'read_failed').slice(0, 40), extracted_at: now().toISOString(),
    });
    out[status]++;
  }

  // 5) 남은 수(이번에 끊긴 표시 행도 남은 것으로 센다)와 읽은 자료 수.
  const [remaining, readyTotal] = await Promise.all([
    db.head(`app_documents?${ws}&${UNFINISHED}&file_id=not.is.null&select=id`),
    db.head(`app_documents?${ws}&extraction_status=eq.ready&file_id=not.is.null&select=id`),
  ]);
  return { ...out, remaining, ready_total: readyTotal };
}
