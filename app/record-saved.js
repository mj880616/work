// MTG-기록겹침거르기 3단계: 저장 경로가 저장이 끝난 뒤 겹침 확인(overlap-check.js)에 알리는 한 곳.
// - 저장 결과는 바꾸지 않는다. 저장 응답에 id가 없으면(예: 서버가 행을 돌려주지 않음) 아무것도 알리지 않는다.
// - 알림 모양: kptu:record-saved {kind, id, day, text, project_id?, organization_id?, targets?}(overlap-check.js 머리말).
import {seoulDateKey} from './meeting-time.js';

const text = value => typeof value === 'string' ? value : '';
const dayOf = value => { try { return value ? seoulDateKey(value) : ''; } catch { return ''; } };
const rowOf = rows => Array.isArray(rows) ? rows[0] : rows;

export function announceRecordSaved(detail) {
  if (!detail) return;
  try { window.dispatchEvent(new CustomEvent('kptu:record-saved', {detail})); } catch { /* 알림이 없어도 저장은 이미 끝났다 */ }
}

// 프로젝트 기록(app_project_progress_updates) 저장 응답 → 알림 내용(없으면 null).
export function projectUpdateDetail(response, {project_id, summary, effective_on}) {
  const row = rowOf(response);
  if (!row?.id) return null;
  return {kind: 'project_update', id: row.id, project_id, day: row.effective_on || effective_on, text: summary};
}
// 담당조직 기록(app_suborganization_updates) 저장 응답 → 알림 내용.
export function orgUpdateDetail(response, {organization_id, raw_text}) {
  const row = rowOf(response);
  if (!row?.id) return null;
  return {kind: 'org_update', id: row.id, organization_id, day: dayOf(row.occurred_at), text: raw_text};
}
// 여러 곳에 연결한 업데이트(바구니 글 + app_basket_confirm_links) → 알림 내용. places: [{kind:'project'|'organization'|'reference', id}].
// 프로젝트·조직이 하나도 없으면(참고 묶음만) null. 글이 비었거나 AI 내보내기를 막은 글도 null.
export function basketDetail(note, places) {
  const targets = (Array.isArray(places) ? places : []).filter(p => p && ['project', 'organization'].includes(p.kind) && p.id).map(p => ({kind: p.kind, id: p.id}));
  if (!note?.id || !targets.length || note.ai_export_allowed === false || !text(note.raw_text).trim()) return null;
  return {kind: 'basket', id: note.id, day: dayOf(note.occurred_at || note.created_at), text: note.raw_text, targets};
}
