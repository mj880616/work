import {signalBody} from './now-model.mjs';
// NOW-줄밀기(S49-3): Now 글(사회운동 글·뉴스 기사)의 별표·보관·숨기기를 서버에 쓰는 길 하나. 상세(now-detail.js)와 줄 밀기·마우스 단추(now-row-acts.js)가 같이 쓴다.
// 사회운동 글 = app_outside_marks(글마다 한 줄: starred_at·archived_at·dismissed_at), 뉴스 기사 = app_news_items(starred_at = 보관, hidden_at = 숨기기).
// 누른 일마다 환류 기록 한 줄(app_now_signals, 더하기만). 기기 저장 없음.
const q = v => encodeURIComponent(v);
const rt = () => window.KPTURuntime;
export const workspaceOf = () => rt()?.context?.read?.()?.workspace?.id || '';

// 사회운동 글 표시: 줄이 있으면 그 칸들만 고치고, 없으면 넣는다. fields: {starred_at?, archived_at?, dismissed_at?} (값 = 시각 문자열 또는 null)
export async function writeOutsideMark(id, fields) {
  const w = workspaceOf(), at = new Date().toISOString();
  const rows = await rt().api(`/rest/v1/app_outside_marks?workspace_id=eq.${q(w)}&post_id=eq.${q(id)}&select=post_id`, {method: 'PATCH', body: {...fields, updated_at: at}, prefer: 'return=representation', singleFlight: false});
  if (Array.isArray(rows) && rows.length) return;
  if (!Object.values(fields).some(Boolean)) return;
  await rt().api('/rest/v1/app_outside_marks', {method: 'POST', body: {post_id: id, workspace_id: w, ...fields}, prefer: 'return=minimal', singleFlight: false});
}
export async function writeNewsItem(id, body) {
  const rows = await rt().api(`/rest/v1/app_news_items?workspace_id=eq.${q(workspaceOf())}&id=eq.${q(id)}&select=id`, {method: 'PATCH', body: {...body, updated_at: new Date().toISOString()}, prefer: 'return=representation', singleFlight: false});
  if (!Array.isArray(rows) || !rows.length) throw new Error('save');
}
// 환류 기록 한 줄. 실패해도 누른 일은 그대로. 끝나면 then(action)을 부른다.
export function sendSignal(item, action, then) {
  const w = workspaceOf();
  if (!w) return;
  rt().api('/rest/v1/app_now_signals', {method: 'POST', body: signalBody(w, item, action), prefer: 'return=minimal', singleFlight: false})
    .then(() => then?.(action)).catch(() => {});
}
const stamp = on => (on ? new Date().toISOString() : null);
// 상세의 세 단추(별표·보관·관심 없음)가 쓰는 길.
export async function setMark(item, act, on) {
  if (item.type === 'news') {
    if (act === 'star') await writeNewsItem(item.id, on ? {starred_at: stamp(true)} : {starred_at: null, folder_id: null});
    else if (act === 'dismiss') await writeNewsItem(item.id, {hidden_at: stamp(on)});
  } else await writeOutsideMark(item.id, {[{star: 'starred_at', archive: 'archived_at', dismiss: 'dismissed_at'}[act]]: stamp(on)});
}
// 줄 밀기의 '보관': 사회운동 글 = 보관 표시, 뉴스 = 별표(뉴스에서 보관은 별표다).
export const setSaved = (item, on) => setMark(item, item.type === 'news' ? 'star' : 'archive', on);
export const savedAction = item => (item.type === 'news' ? 'star' : 'archive');
// [보관] 탭에서 풀기: 사회운동 글은 별표·보관 둘 다 비워 탭에서 빠지게, 뉴스는 별표·폴더를 비운다.
export const release = item => (item.type === 'news' ? writeNewsItem(item.id, {starred_at: null, folder_id: null}) : writeOutsideMark(item.id, {starred_at: null, archived_at: null}));
// 사회운동 글 중 숨기거나 보관한 것의 표시(목록이 감추고 오른쪽 밀기 글자를 정한다).
export const readOutsideMarks = () => rt().api(`/rest/v1/app_outside_marks?workspace_id=eq.${q(workspaceOf())}&or=(archived_at.not.is.null,dismissed_at.not.is.null)&select=post_id,archived_at,dismissed_at&limit=2000`, {singleFlight: false});
