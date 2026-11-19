import {writeNewsMark, writeOutsideMark as writeOutside, writeSignal, readOutsideMarks as readMarks, workspaceOf} from './feed-shared.js';
// NOW-줄밀기(S49-3): Now 글(사회운동 글·뉴스 기사)의 별표(= 보관)·숨기기를 서버에 쓰는 길 하나. 상세(now-detail.js)와 줄 밀기·마우스 단추(now-row-acts.js)가 같이 쓴다.
// NEWS-모두에게열기 ③: 표시는 사람별 표(뉴스 app_news_marks: starred_at = 보관, hidden_at = 숨기기 / 사회운동 app_outside_article_marks)에 공용 글 id로.
// 누른 일마다 환류 기록 한 줄(사람별 반응 표, 더하기만). 서버 길은 feed-shared.js 하나. 기기 저장 없음.
export {workspaceOf};

// S67-09 NEWS-보관별표하나로(명진 11/19): 사회운동 글도 뉴스처럼 '보관' = 별표 하나(starred_at). 옛 보관 표시(archived_at)는 DB 20261119120000이 별표로 채웠고
// 칸은 남긴다(데이터 보존). 화면은 archived_at을 읽지 않고, 별표를 끌 때만 함께 비운다(옛 보관이 되살아나지 않게).
// 사회운동 글 표시. fields: {starred_at?, archived_at?, dismissed_at?} (값 = 시각 문자열 또는 null)
export const writeOutsideMark = (id, fields) => writeOutside(id, fields);
export const writeNewsItem = (id, body) => writeNewsMark(id, body);
// 환류 기록 한 줄. 실패해도 누른 일은 그대로. 끝나면 then(action)을 부른다.
export function sendSignal(item, action, then) {
  if (!workspaceOf()) return;
  writeSignal(item, action).then(() => then?.(action)).catch(() => {});
}
const stamp = on => (on ? new Date().toISOString() : null);
// 상세의 단추(별표·관심 없음)가 쓰는 길. act: 'star' | 'dismiss'.
export async function setMark(item, act, on) {
  if (item.type === 'news') {
    if (act === 'star') await writeNewsItem(item.id, on ? {starred_at: stamp(true)} : {starred_at: null, folder_id: null});
    else if (act === 'dismiss') await writeNewsItem(item.id, {hidden_at: stamp(on)});
  } else if (act === 'star') await writeOutsideMark(item.id, on ? {starred_at: stamp(true)} : {starred_at: null, archived_at: null});
  else if (act === 'dismiss') await writeOutsideMark(item.id, {dismissed_at: stamp(on)});
}
// 줄 밀기·마우스 단추의 '보관' = 두 쪽 다 별표 켜기/끄기(상세 [☆ 별표]와 같은 표시).
export const setSaved = (item, on) => setMark(item, 'star', on);
// [보관] 탭에서 풀기 = 별표 끄기(뉴스는 별표 폴더도 비운다).
export const release = item => setMark(item, 'star', false);
// 사회운동 글 중 숨기거나 별표한 것의 표시(목록이 감추고 ★·오른쪽 밀기 글자를 정한다). [{post_id(공용 id), starred_at, dismissed_at}]
export const readOutsideMarks = () => readMarks('(starred_at.not.is.null,dismissed_at.not.is.null)');
