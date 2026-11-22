// NEWS-모두에게열기 ③ 화면: 공용 기사·글 + 사람별 표시를 읽고 쓰는 길(app/feed-shared.js, app/feed-shared-model.mjs)과 텔레그램 [뉴스방으로].
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {articleCols, flatNews, flatNewsMark, keptNews, keptOutside, outsideMarks, keepBody, newsPage, mapIds, markFields, NEWS_MARK_EMBED, KEEP_EMBED} from '../app/feed-shared-model.mjs';

const A = 'aaaaaaaa-0000-4000-8000-000000000001', B = 'bbbbbbbb-0000-4000-8000-000000000002', OLD = 'cccccccc-0000-4000-8000-000000000003';

test('공용 기사 칸: 표시 칸(별표·폴더·숨김·키워드)은 공용 표에 묻지 않는다', () => {
  assert.equal(articleCols('id,lane,url,title,keywords,starred_at,folder_id,hidden_at,summary'), 'id,lane,url,title,summary');
  assert.equal(articleCols('title'), 'id,title');
  // S68-27: 보관(★)은 표시 칸이 아니라 읽을 거리 줄 — 표시 embed에 starred_at을 묻지 않는다.
  assert.equal(NEWS_MARK_EMBED, 'app_news_marks(folder_id,hidden_at,keywords)');
  assert.equal(KEEP_EMBED, 'app_reading_items(id,saved_at)');
});

const R = 'dddddddd-0000-4000-8000-000000000004';
test('공용 기사 + 내 표시 + 읽을 거리 줄 → 옛 줄 모양: starred_at = 읽을 거리 줄 저장 시각, 옛 별표 칸은 보지 않음', () => {
  assert.deepEqual(flatNews({id: A, title: 't', app_news_marks: [{starred_at: 'old', folder_id: null, hidden_at: null, keywords: ['k']}], app_reading_items: [{id: R, saved_at: 's'}]}),
    {id: A, title: 't', starred_at: 's', reading_id: R, folder_id: null, hidden_at: null, keywords: ['k']});
  assert.deepEqual(flatNews({id: A, title: 't', app_news_marks: [{starred_at: 'old'}], app_reading_items: []}),
    {id: A, title: 't', starred_at: null, reading_id: null, folder_id: null, hidden_at: null, keywords: []}, '옛 별표 칸만 있으면 보관이 아니다');
  assert.equal(flatNews({title: 'no id'}), null);
  assert.deepEqual(flatNewsMark({starred_at: 'old', folder_id: 'f', hidden_at: null, keywords: [], app_news_articles: {id: B, title: 'x', app_reading_items: [{id: R, saved_at: 's'}]}}),
    {id: B, title: 'x', starred_at: 's', reading_id: R, folder_id: 'f', hidden_at: null, keywords: []});
  assert.equal(flatNewsMark({starred_at: 's', app_news_articles: null}), null, '읽을 수 없는 공용 기사(정책상 빈 embed)는 빠진다');
});

test('읽을 거리 줄 → 보관한 글 모양(뉴스·사회운동), 글을 못 읽으면 빠짐', () => {
  assert.deepEqual(keptNews({id: R, saved_at: 's', app_news_articles: {id: A, title: 't', app_news_marks: [{folder_id: 'f', hidden_at: null, keywords: []}]}}),
    {id: A, title: 't', starred_at: 's', reading_id: R, folder_id: 'f', hidden_at: null, keywords: []});
  assert.equal(keptNews({id: R, saved_at: 's', app_news_articles: null}), null);
  assert.deepEqual(keptOutside({id: R, saved_at: 's', app_outside_articles: {id: B, title: 'p', app_outside_article_marks: [{dismissed_at: null}]}}),
    {post_id: B, starred_at: 's', dismissed_at: null, reading_id: R, app_outside_posts: {id: B, title: 'p'}});
  assert.equal(keptOutside({id: R, app_outside_articles: null}), null);
});

test('사회운동 표시 합치기: 숨김은 내 표시, 보관은 읽을 거리 줄', () => {
  assert.deepEqual(outsideMarks([{article_id: A, dismissed_at: 'd'}], [{outside_article_id: B, saved_at: 's'}, {outside_article_id: A, saved_at: 't'}]),
    [{post_id: A, starred_at: 't', dismissed_at: 'd'}, {post_id: B, starred_at: 's', dismissed_at: null}]);
});

test('보관 한 길 몸통(app_reading_keep): 작업공간·종류·공용 id·켜기, 되돌리기 시각은 켤 때만', () => {
  assert.deepEqual(keepBody('w', 'news', A, true, '2026-11-01T00:00:00Z'), {p_workspace: 'w', p_source: 'news', p_article: A, p_on: true, p_saved_at: '2026-11-01T00:00:00Z'});
  assert.deepEqual(keepBody('w', 'outside', A, false, '2026-11-01T00:00:00Z'), {p_workspace: 'w', p_source: 'outside', p_article: A, p_on: false, p_saved_at: null});
  assert.equal(keepBody('w', 'telegram', A, true), null);
  assert.equal(keepBody('w', 'news', '', true), null);
  assert.equal(keepBody('', 'news', A, true), null);
});

test('목록 한 쪽: 내가 숨긴 기사는 화면에서 빼되 다음 쪽 자리(raw)는 읽은 줄 수 그대로', () => {
  const rows = [{id: A, app_news_marks: [{hidden_at: 'h'}]}, {id: B, app_news_marks: []}, {id: OLD, app_news_marks: []}];
  assert.deepEqual(newsPage(rows, 2), {raw: 2, end: false, rows: [{id: B, starred_at: null, reading_id: null, folder_id: null, hidden_at: null, keywords: []}]});
  const last = newsPage(rows.slice(1), 2);
  assert.equal(last.end, true); assert.equal(last.raw, 2); assert.equal(last.rows.length, 2);
});

test('옛 id 지도: 지도 줄이 있으면 공용 id, 없으면 같은 id(옮길 때 운영자 줄 id를 그대로 씀)', () => {
  const m = mapIds([OLD, A, 'not-a-uuid'], [{old_id: OLD, article_id: B}, {old_id: 'x', article_id: A}]);
  assert.deepEqual([...m], [[OLD, B], [A, A]]);
});

test('표시 쓰기 몸통: 화면 권한 칸만(작업공간·기사 id·키워드는 몸통으로 못 바꿈), 옛 별표·보관 칸은 쓰지 않음(S68-27)', () => {
  assert.deepEqual(markFields('news', {starred_at: 's', folder_id: null, hidden_at: 'h', keywords: ['x'], workspace_id: 'w2', article_id: A}), {folder_id: null, hidden_at: 'h'});
  assert.deepEqual(markFields('outside', {starred_at: null, archived_at: 'a', dismissed_at: 'd', hidden_at: 'h'}), {dismissed_at: 'd'});
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
  // S68-27: 보관 읽기는 읽을 거리 표(내 작업공간), 쓰기는 DB 함수 app_reading_keep 한 길. 옛 별표 칸을 주소·몸통에 쓰지 않는다.
  assert.match(src, /app_reading_items\.workspace_id=eq\.\$\{q\(w\)\}/);
  assert.match(src, /\$\{KEEP\}\?workspace_id=eq\.\$\{q\(w\)\}/);
  assert.match(src, /rpc\/app_reading_keep/);
  assert.doesNotMatch(src, /starred_at=|starred_at\.desc|archived_at:/);
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
