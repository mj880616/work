import {readOutsideKept, readNewsStarred, workspaceOf} from './feed-shared.js';
import {savedRows} from './now-model.mjs';
// OUTSIDE-글상세·관심환류 ④(설계 docs/design/outside-statements.md 12.1절): 보관한 글 읽기 한 곳 — 노트 'News에서 › 보관한 글'(note-news-marks.js)이 쓴다.
// S68-27 READ-보관기록일원화(명진 11/22 21:37 "저장된 기록도 일원화 하지 왜?"): 보관한 글의 원본은 읽을 거리 표(app_reading_items) 하나.
// 글을 가리키는 읽을 거리 줄(언론 news_article_id · 사회운동 outside_article_id)을 공용 글과 함께 읽는다(owner RLS). 옛 별표 칸은 읽지 않는다.
// 읽을 거리 화면(reading.js)은 같은 표를 바로 읽으므로 이 모듈을 쓰지 않는다. 표·복사본·기기 저장 없음.

const POST_COLS = 'id,source_key,kind,lang,title,title_ko,url,published_at,fetched_at,summary_ko,key_sentences,has_body';
const NEWS_COLS = 'id,lane,url,title,lang,publisher,published_at,created_at,summary,title_ko,state,body_kind,author,manual_at,origin';

// 두 쪽 다 못 읽으면 null, 하나라도 읽으면 savedRows 결과. 작업공간이 아직 없으면 undefined.
export async function readSavedRows() {
  const w = workspaceOf();
  if (!w) return undefined;
  const [marks, news] = await Promise.allSettled([readOutsideKept(POST_COLS, 300), readNewsStarred(NEWS_COLS, 300)]);
  if (marks.status === 'rejected' && news.status === 'rejected') return null;
  return savedRows(marks.status === 'fulfilled' ? marks.value : [], news.status === 'fulfilled' ? news.value : []);
}
