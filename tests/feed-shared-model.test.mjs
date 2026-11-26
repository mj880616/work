// NEWS-모두에게열기 ③ 화면: 공용 기사·글 + 사람별 표시를 읽고 쓰는 길(app/feed-shared.js, app/feed-shared-model.mjs)과 텔레그램 [뉴스방으로].
// S68-27: 보관(starred_at 칸)은 표시 표가 아니라 내 읽을 거리 줄(app_reading_items)에서 온다 — 쓰기는 서버 함수 app_reading_keep 하나.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {articleCols, flatNews, flatNewsMark, flatNewsSaved, newsPage, mapIds, markFields, outsideMarkRows, NEWS_MARK_EMBED, SAVED_EMBED} from '../app/feed-shared-model.mjs';

const A = 'aaaaaaaa-0000-4000-8000-000000000001', B = 'bbbbbbbb-0000-4000-8000-000000000002', OLD = 'cccccccc-0000-4000-8000-000000000003';

test('공용 기사 칸: 표시 칸(폴더·숨김·키워드)과 보관 칸은 공용 표에 묻지 않는다, 옛 별표 칸은 묻지 않는다', () => {
  assert.equal(articleCols('id,lane,url,title,keywords,starred_at,folder_id,hidden_at,summary'), 'id,lane,url,title,summary');
  assert.equal(articleCols('title'), 'id,title');
  assert.equal(NEWS_MARK_EMBED, 'app_news_marks(folder_id,hidden_at,keywords)');
  assert.equal(SAVED_EMBED, 'app_reading_items(saved_at)');
});

test('공용 기사 + 내 표시 + 내 보관(읽을 거리 줄) → 옛 줄 모양(starred_at = 보관 시각), 없으면 빈 값', () => {
  assert.deepEqual(flatNews({id: A, title: 't', app_news_marks: [{folder_id: null, hidden_at: null, keywords: ['k']}], app_reading_items: [{saved_at: 's'}]}),
    {id: A, title: 't', starred_at: 's', folder_id: null, hidden_at: null, keywords: ['k']});
  assert.deepEqual(flatNews({id: A, title: 't', app_news_marks: [{starred_at: 'old', folder_id: null}], app_reading_items: []}), {id: A, title: 't', starred_at: null, folder_id: null, hidden_at: null, keywords: []},
    '표시 표의 옛 별표 칸은 보관이 아니다');
  assert.equal(flatNews({title: 'no id'}), null);
  assert.deepEqual(flatNewsMark({folder_id: 'f', hidden_at: null, keywords: [], app_news_articles: {id: B, title: 'x', app_reading_items: [{saved_at: 's'}]}}),
    {id: B, title: 'x', starred_at: 's', folder_id: 'f', hidden_at: null, keywords: []});
  assert.equal(flatNewsMark({app_news_articles: null}), null, '읽을 수 없는 공용 기사(정책상 빈 embed)는 빠진다');
  assert.deepEqual(flatNewsSaved({id: 'r', saved_at: 's', app_news_articles: {id: B, title: 'x', app_news_marks: [{folder_id: 'f', hidden_at: null, keywords: []}]}}),
    {id: B, title: 'x', starred_at: 's', folder_id: 'f', hidden_at: null, keywords: []});
  assert.deepEqual(flatNewsSaved({id: 'r', saved_at: 's', app_news_articles: {id: B, app_news_marks: []}}), {id: B, starred_at: 's', folder_id: null, hidden_at: null, keywords: []});
  assert.equal(flatNewsSaved({id: 'r', saved_at: 's', app_news_articles: null}), null);
});

test('목록 한 쪽: 내가 숨긴 기사는 화면에서 빼되 다음 쪽 자리(raw)는 읽은 줄 수 그대로', () => {
  const rows = [{id: A, title: '가짜 제목 1', app_news_marks: [{hidden_at: 'h'}]}, {id: B, title: '가짜 제목 2', app_news_marks: []}, {id: OLD, title: '가짜 제목 3', app_news_marks: []}];
  assert.deepEqual(newsPage(rows, 2), {raw: 2, end: false, rows: [{id: B, title: '가짜 제목 2', starred_at: null, folder_id: null, hidden_at: null, keywords: []}]});
  const last = newsPage(rows.slice(1), 2);
  assert.equal(last.end, true); assert.equal(last.raw, 2); assert.equal(last.rows.length, 2);
});

// S70-17 NEWS-제목꼭얻기(사용자 11/25 10:26 "제목 못읽으면 차라리 목록에서 빠지는게 나음").
test('S70-17 목록 한 쪽: 제목을 못 얻은 줄은 빼고(지우지 않음), 제목이 생기면 다시 보이고, 보관한 글은 남는다', () => {
  const donga = 'https://www.donga.com/news/Society/article/all/20261125/132845001/1';
  const rows = [
    {id: A, url: donga, title: null, state: 'failed', app_news_marks: []},
    {id: B, url: 'https://www.example.org/a', title: '가짜 제목', state: 'ok', app_news_marks: []},
    {id: OLD, url: 'https://www.example.org/x', title: 'https://www.example.org/x', state: 'pending', app_news_marks: []},
  ];
  const page = newsPage(rows, 10);
  assert.deepEqual(page.rows.map(r => r.id), [B], '제목 없음·주소뿐인 제목 줄은 목록에 없다');
  assert.equal(page.raw, 3, '다음 쪽 자리는 뺀 줄까지 센다');
  const later = newsPage([{...rows[0], title: '나중에 얻은 가짜 제목'}, rows[1]], 10);
  assert.deepEqual(later.rows.map(r => r.id), [A, B], '나중에 제목이 생기면 다시 보인다');
  const kept = newsPage([{...rows[0], app_reading_items: [{saved_at: '2026-11-25T01:00:00Z'}]}], 10);
  assert.deepEqual(kept.rows.map(r => r.id), [A], '보관한 글(공유로 넣은 글)은 [직접 넣기]를 위해 남는다');
  const path = newsPage([{id: A, url: 'https://news.example.org/2026/11/25/minimum-wage-talks-stall', title: null, state: 'failed', app_news_marks: []}], 10);
  assert.equal(path.rows.length, 1, '주소 경로 조각이 제목이면 보인다');
});

test('옛 id 지도: 지도 줄이 있으면 공용 id, 없으면 같은 id(옮길 때 운영자 줄 id를 그대로 씀)', () => {
  const m = mapIds([OLD, A, 'not-a-uuid'], [{old_id: OLD, article_id: B}, {old_id: 'x', article_id: A}]);
  assert.deepEqual([...m], [[OLD, B], [A, A]]);
});

test('표시 쓰기 몸통: 숨김·관심 없음·폴더만(보관·옛 별표·작업공간·기사 id·키워드는 몸통으로 못 바꿈)', () => {
  assert.deepEqual(markFields('news', {starred_at: 's', folder_id: null, hidden_at: 'h', keywords: ['x'], workspace_id: 'w2', article_id: A}), {folder_id: null, hidden_at: 'h'});
  assert.deepEqual(markFields('outside', {starred_at: null, archived_at: 'a', dismissed_at: 'd', hidden_at: 'h'}), {dismissed_at: 'd'});
});

test('사회운동: 보관(읽을 거리 줄) + 관심 없음 표시 → 한 모양, 보관 시각 = 줄 저장 시각', () => {
  assert.deepEqual(outsideMarkRows([{article_id: A, dismissed_at: 'd'}, {article_id: B, dismissed_at: 'd2'}, {article_id: OLD, dismissed_at: null}],
    [{outside_article_id: A, saved_at: 's', app_outside_articles: {id: A}}]), [
    {post_id: A, starred_at: 's', dismissed_at: 'd', app_outside_posts: {id: A}},
    {post_id: B, starred_at: null, dismissed_at: 'd2', app_outside_posts: null},
  ]);
  assert.deepEqual(outsideMarkRows(null, null), []);
});

test('읽기·쓰기 길: 공용 표는 읽기만, 사람별 표는 늘 내 작업공간으로', () => {
  const src = readFileSync(new URL('../app/feed-shared.js', import.meta.url), 'utf8');
  // 공용 표(기사·글·본문 블록·문장)에 넣기·고치기·지우기를 보내지 않는다.
  for (const t of ['art', 'body', 'sentences']) assert.doesNotMatch(src, new RegExp(`T\\.\\w+\\.${t}\\}[^\`]*\`,\\s*\\{method: '(POST|PATCH|DELETE)'`));
  assert.doesNotMatch(src, /\$\{T\.(news|outside)\.art\}[^`]*`, \{method/);
  // 표시·읽음 읽기와 고치기는 주소에 내 작업공간, 넣기는 몸통에 내 작업공간.
  assert.match(src, /\$\{t\.mark\}\?workspace_id=eq\.\$\{q\(w\)\}&article_id=eq\./);
  assert.match(src, /body: \{workspace_id: w, article_id: id, \.\.\.body\}/);
  assert.match(src, /\$\{T\[type\]\.read\}\?workspace_id=eq\.\$\{q\(workspaceOf\(\)\)\}/);
  assert.match(src, /app_news_marks\.workspace_id=eq\.\$\{q\(w\)\}/);
  // 보관: 읽기는 내 읽을 거리 줄(작업공간을 건다), 쓰기는 서버 함수 하나. 표시 표의 옛 별표·보관 칸은 읽지도 쓰지도 않는다.
  assert.match(src, /app_reading_items\.workspace_id=eq\.\$\{q\(w\)\}/);
  assert.match(src, /\$\{R\}\?workspace_id=eq\.\$\{q\(w\)\}&news_article_id=not\.is\.null/);
  assert.match(src, /'\/rest\/v1\/rpc\/app_reading_keep', \{method: 'POST', body: \{p_workspace: w, p_source: item\.type, p_article: id, p_on: !!on/);
  assert.doesNotMatch(src, /starred_at=not\.is\.null|starred_at\.not\.is\.null|archived_at:|select=starred_at|,starred_at/);
  assert.doesNotMatch(src, /\$\{R\}[^`]*`, \{method: '(POST|PATCH|DELETE)'/, '읽을 거리 표에 직접 쓰지 않는다(보관은 서버 함수)');
  // 옛 id는 자기 작업공간 옛 줄만 바꿔 주는 지도 함수로(지도 표를 직접 읽지 않는다).
  assert.match(src, /rpc\/\$\{t\.map\}/);
  assert.doesNotMatch(src, /app_(news|outside)_id_map/);
});

test('텔레그램 [뉴스방으로]: 서버 함수 하나, 거절 까닭은 그대로 · 1:1 방에는 단추 없음', async () => {
  const feed = await import('../app/feed-data.js');
  const calls = [];
  const rt = {context: {read: () => ({workspace: {id: 'w'}})}, api: async (path, opts) => { calls.push([path, opts?.body]); return {ok: true, changed: true, room_key: 'room-a', news_at: '2026-11-15T00:00:00Z'}; }};
  assert.equal((await feed.setRoomNews('room-a', true, rt)).news_at, '2026-11-15T00:00:00Z');
  assert.deepEqual(calls[0], ['/rest/v1/rpc/app_feed_room_news', {p_room_key: 'room-a', p_on: true}]);
  const refuse = message => ({context: rt.context, api: async () => { throw Object.assign(new Error(message), {status: 400}); }});
  assert.equal((await feed.setRoomNews('room-a', true, refuse('TGNEWS_KIND'))).error, 'NEWS_KIND');
  assert.equal((await feed.setRoomNews('room-a', true, refuse('TGNEWS_FAMILY'))).error, 'NEWS_FAMILY');
  assert.equal((await feed.setRoomNews('room-a', true, refuse('OPERATOR_FEATURE_REQUIRED'))).error, 'REFUSED');
  const ui = readFileSync(new URL('../app/telegram-feed.js', import.meta.url), 'utf8');
  assert.match(ui, /newsRoomOk = room => state\.newsReady && \['group', 'channel'\]\.includes\(roomRow\(room\)\.chat_kind\)/);
});
