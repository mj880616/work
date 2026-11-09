// ORG-기록하나로 O-6(설계 docs/design/record-one.md 2-8): [확정]이 개인 확정본 저장에 성공한 직후 한 번, 그 주 조직보고·투쟁 사업장 칸 사진을
// app_report_snapshots(주당 1행, owner RLS, migration 20261109100000)에 남긴다. 같은 주를 새 판으로 확정하면 그 행을 통째로 바꾼다.
// - 고칠 수 있는 칸만 보낸다: 처음 = workspace_id·week_start·document_id·rows(insert), 다시 = document_id·rows(update). confirmed_at은 서버 트리거가 넣는다.
// - 128KiB(DB 검사)를 넘으면 보내지 않는다. 실패해도 확정·파일 받기는 막지 않는다(그 주는 창 규칙으로 보인다) — 결과만 돌려준다.
// - 브라우저 저장소를 쓰지 않는다.
import {SNAPSHOT_MAX_BYTES} from './record-window-model.mjs';

const PATH = '/rest/v1/app_report_snapshots';
const enc = encodeURIComponent;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function saveReportSnapshot({rt = window.KPTURuntime, workspaceId, week, documentId = null, rows = []} = {}) {
  if (!workspaceId || !DAY.test(String(week)) || !Array.isArray(rows)) return {ok: false, reason: 'input'};
  const doc = UUID.test(String(documentId ?? '')) ? String(documentId) : null;
  if (new TextEncoder().encode(JSON.stringify(rows)).length > SNAPSHOT_MAX_BYTES) return {ok: false, reason: 'size'};
  const where = `${PATH}?workspace_id=eq.${enc(workspaceId)}&week_start=eq.${enc(week)}&select=week_start,confirmed_at`;
  const patch = () => rt.api(where, {method: 'PATCH', body: {document_id: doc, rows}, prefer: 'return=representation', singleFlight: false});
  try {
    let made = await patch();
    if (Array.isArray(made) && made.length) return {ok: true, row: made[0]};
    try {
      made = await rt.api(`${PATH}?select=week_start,confirmed_at`, {method: 'POST', body: {workspace_id: workspaceId, week_start: week, document_id: doc, rows}, prefer: 'return=representation', singleFlight: false});
    } catch (e) {
      // 다른 기기가 그사이 같은 주를 먼저 넣었으면(unique) 그 행을 바꾼다.
      if (String(e?.status ?? '') !== '409' && !/23505|duplicate/i.test(String(e?.code ?? e?.message ?? ''))) throw e;
      made = await patch();
    }
    return Array.isArray(made) && made.length ? {ok: true, row: made[0]} : {ok: false, reason: 'empty'};
  } catch (e) {
    console.warn('report snapshot save failed', e?.message || e);
    return {ok: false, reason: 'failed'};
  }
}
