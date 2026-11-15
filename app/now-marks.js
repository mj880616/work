import {writeNewsMark, writeOutsideMark as writeOutside, writeSignal, readOutsideMarks as readMarks, workspaceOf} from './feed-shared.js';
// NOW-줄밀기(S49-3): Now 글(사회운동 글·뉴스 기사)의 별표·보관·숨기기를 서버에 쓰는 길 하나. 상세(now-detail.js)와 줄 밀기·마우스 단추(now-row-acts.js)가 같이 쓴다.
// NEWS-모두에게열기 ③: 표시는 사람별 표(뉴스 app_news_marks: starred_at = 보관, hidden_at = 숨기기 / 사회운동 app_outside_article_marks)에 공용 글 id로.
// 누른 일마다 환류 기록 한 줄(사람별 반응 표, 더하기만). 서버 길은 feed-shared.js 하나. 기기 저장 없음.
export {workspaceOf};

// 사회운동 글 표시. fields: {starred_at?, archived_at?, dismissed_at?} (값 = 시각 문자열 또는 null)
export const writeOutsideMark = (id, fields) => writeOutside(id, fields);
export const writeNewsItem = (id, body) => writeNewsMark(id, body);
// 환류 기록 한 줄. 실패해도 누른 일은 그대로. 끝나면 then(action)을 부른다.
export function sendSignal(item, action, then) {
  if (!workspaceOf()) return;
  writeSignal(item, action).then(() => then?.(action)).catch(() => {});
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
// 사회운동 글 중 숨기거나 보관한 것의 표시(목록이 감추고 오른쪽 밀기 글자를 정한다). [{post_id(공용 id), archived_at, dismissed_at}]
export const readOutsideMarks = () => readMarks('(archived_at.not.is.null,dismissed_at.not.is.null)');
