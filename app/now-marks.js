import {writeNewsMark, writeOutsideMark as writeOutside, writeKeep, writeSignal, readOutsideMarks as readMarks, readMarkRaw, workspaceOf} from './feed-shared.js';
// NOW-줄밀기(S49-3): Now 글(사회운동 글·뉴스 기사)의 보관(★)·숨기기를 서버에 쓰는 길 하나. 상세(now-detail.js)와 줄 밀기·마우스 단추(now-row-acts.js)가 같이 쓴다.
// NEWS-모두에게열기 ③: 숨기기 표시는 사람별 표(뉴스 app_news_marks.hidden_at / 사회운동 app_outside_article_marks.dismissed_at)에 공용 글 id로. 보관은 아래 S68-27.
// 누른 일마다 환류 기록 한 줄(사람별 반응 표, 더하기만). 서버 길은 feed-shared.js 하나. 기기 저장 없음.
export {workspaceOf};

// S68-27 READ-보관기록일원화(명진 11/22 21:37 "저장된 기록도 일원화 하지 왜?"): '보관'(= ★, 두 쪽 같음)의 원본은 읽을 거리 표 한 줄.
// 켜기·끄기·되돌리기는 모두 writeKeep(DB app_reading_keep) 한 길 — 끄면 그 읽을 거리 줄이 지워지고(뉴스는 별표 폴더도 서버가 비움),
// 되돌리면 원래 보관 시각으로 같은 줄이 다시 생긴다. 옛 별표 칸(starred_at·archived_at)은 쓰지 않는다. 숨기기만 내 표시 칸(hidden_at·dismissed_at).
// 사회운동 글 표시. fields: {dismissed_at?} (값 = 시각 문자열 또는 null)
export const writeOutsideMark = (id, fields) => writeOutside(id, fields);
export const writeNewsItem = (id, body) => writeNewsMark(id, body);
// 환류 기록 한 줄. 실패해도 누른 일은 그대로. 끝나면 then(action)을 부른다.
export function sendSignal(item, action, then) {
  if (!workspaceOf()) return;
  writeSignal(item, action).then(() => then?.(action)).catch(() => {});
}
const stamp = on => (on ? new Date().toISOString() : null);
// 상세의 단추(★·관심 없음)가 쓰는 길. act: 'star' | 'dismiss'.
export async function setMark(item, act, on) {
  if (act === 'star') return writeKeep(item, !!on);
  else if (act === 'dismiss') {
    if (item.type === 'news') await writeNewsItem(item.id, {hidden_at: stamp(on)});
    else await writeOutsideMark(item.id, {dismissed_at: stamp(on)});
  }
}
// 줄 밀기·마우스 단추의 '보관' = 읽을 거리 줄 켜기/끄기(상세 [☆ 별표]와 같은 길).
export const setSaved = (item, on) => setMark(item, 'star', on);
// 보관 풀기.
export const release = item => setMark(item, 'star', false);
// S67-11 NEWS-보관빼기(명진 11/19): 보관에서 빼기. 끄기 전 표시(보관 시각·폴더)를 돌려준다 — 되돌리기(restoreStar)가 원래 시각·폴더로 되살린다.
// 끄기 전 표시를 못 읽어도 끄기는 한다(되돌리면 지금 시각으로 보관).
const before = item => readMarkRaw(item).catch(() => null);
export async function unstar(item) { const prev = await before(item); await writeKeep(item, false); return prev; }
export async function restoreStar(item, prev) {
  await writeKeep(item, true, prev?.starred_at || null);
  // 그사이 폴더가 지워졌으면 폴더 없이 보관만.
  if (item.type === 'news' && prev?.folder_id) { try { await writeNewsItem(item.id, {folder_id: prev.folder_id}); } catch { /* 폴더 없이 */ } }
}
// 내가 넣은 기사(공유로 넣은 것 origin 'user'·손으로 넣은 것 manual_at) [삭제] = 내 목록 어디에도 안 보이게: 보관 풀기(읽을 거리 줄·폴더) + 숨기기 표시(hidden_at).
// 공용 기사 행·드라이브 사진은 그대로 둔다(다른 작업공간도 볼 수 있고, 되돌리기로 되살린다). 뉴스만(사회운동 글은 수집 글이라 [숨기기]).
export const canDeleteNews = row => !!row && (row.origin === 'user' || !!row.manual_at);
export async function removeMine(item) {
  if (item?.type !== 'news') throw new Error('news only');
  const prev = await before(item);
  if (prev?.starred_at) await writeKeep(item, false);
  await writeNewsItem(item.id, {hidden_at: stamp(true)});
  return prev;
}
export async function restoreMine(item, prev) {
  await writeNewsItem(item.id, {hidden_at: prev?.hidden_at || null});
  if (prev?.starred_at) await restoreStar(item, prev);
}
// 사회운동 글 중 숨기거나 보관한 것의 표시(목록이 감추고 ★·밀기 글자를 정한다). [{post_id(공용 id), starred_at(보관 시각), dismissed_at}]
export const readOutsideMarks = () => readMarks();
