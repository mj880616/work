// FAMILY-잊지말기 4단계: 잊지 말기 표(app_family_notes)를 부르는 화면 쪽 유일한 파일(tests/security/family-notes-isolation.test.mjs가 지킨다).
// 로그인 토큰 그대로 PostgREST를 부른다. 서버가 소유자 RLS + 운영자 기능 family(restrictive 정책)로 막고, 화면은 상태 칸(status·decided_at·updated_at)만 고친다.
// S51-26: 칸은 제안(new)만 읽는다. 남긴 줄은 노트(app_notes, 기존 소유자 RLS 길)에 있고 이 파일은 노트를 부르지 않는다(family-note-send.js).
// 업무 화면·원장·주간보고·검색·정리함은 이 파일을 부르지 않는다. 기기 저장 없음.
import {NOTE_SELECT, cleanNotes, decisionBody} from './family-notes-model.mjs';
import {hasFeature} from './my-features.js';

const TABLE = 'app_family_notes';
const enc = encodeURIComponent;

// 운영자 기능 목록(서버 app_my_features, stable 함수라 GET 읽기 — 쓰기 요청으로 보이지 않게). family가 없으면 칸을 그리지 않는다(화면 숨김은 보안이 아님 — 서버가 어차피 읽기를 막음).
// S52-09: 같은 목록을 홈 '나한테 온 요청'(telegram)도 쓰므로 한 번만 묻는다(my-features.js).
export const hasFamily = rt => hasFeature(rt, 'family');
export async function readNotes(rt, workspaceId) {
  const rows = await rt.api(`/rest/v1/${TABLE}?workspace_id=eq.${enc(workspaceId)}&status=eq.new&select=${NOTE_SELECT}&order=created_at.desc&limit=100`, {singleFlight: false});
  return cleanNotes(rows);
}
async function patch(rt, workspaceId, id, body) {
  if (!body) throw new Error('bad');
  const rows = await rt.api(`/rest/v1/${TABLE}?id=eq.${enc(id)}&workspace_id=eq.${enc(workspaceId)}&select=id`, {method: 'PATCH', prefer: 'return=representation', body});
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('not saved');
}
export const decide = (rt, workspaceId, id, status) => patch(rt, workspaceId, id, decisionBody(status, new Date().toISOString()));
