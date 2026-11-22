import {readOutsideMarks, readNewsStarred, workspaceOf} from './feed-shared.js';
import {savedRows} from './now-model.mjs';
// OUTSIDE-글상세·관심환류 ④(설계 docs/design/outside-statements.md 12.1절): 보관한 글(= 별표) 읽기 한 곳.
// 두 쪽의 별표를 한곳에: 사회운동 글(내 표시 app_outside_article_marks.starred_at) + 뉴스 기사(내 표시 app_news_marks.starred_at). S67-09: 보관 = 별표 하나.
// NEWS-모두에게열기 ③: 글 내용은 공용 표, 표시는 사람별 — 읽는 길은 feed-shared.js. 읽기만 한다(서버, 작업공간 소유자 RLS).
// S68-24 READ-보관하나로(명진 11/22 "2. A"): News 안 [보관] 탭은 없앴다. 이 읽기를 읽을 거리 [News](reading.js — News 기능 키가 있는 사람만 부름)와
// 노트 'News에서 › 보관한 글'(note-news-marks.js)이 같이 쓴다. 표·복사본·기기 저장 없음.

const POST_COLS = 'id,source_key,kind,lang,title,title_ko,url,published_at,fetched_at,summary_ko,key_sentences,has_body';
const NEWS_COLS = 'id,lane,url,title,lang,publisher,published_at,created_at,summary,title_ko,starred_at,folder_id,state,body_kind,author,manual_at,origin';

// 두 쪽 다 못 읽으면 null, 하나라도 읽으면 savedRows 결과. 작업공간이 아직 없으면 undefined.
export async function readSavedRows() {
  const w = workspaceOf();
  if (!w) return undefined;
  const [marks, news] = await Promise.allSettled([
    readOutsideMarks('(starred_at.not.is.null)', {embed: POST_COLS, limit: 300}),
    readNewsStarred(NEWS_COLS, 300),
  ]);
  if (marks.status === 'rejected' && news.status === 'rejected') return null;
  return savedRows(marks.status === 'fulfilled' ? marks.value : [], news.status === 'fulfilled' ? news.value : []);
}
