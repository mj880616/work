import test from 'node:test';
import assert from 'node:assert/strict';
import {NOW_TAB_IDS, keepNowTab, nowTabAt, detailBody, signalBody, cleanTopic, confirmedTopics, candidateRows, interestHit, detailView, relatedTarget, detailError, savedRows, filterSaved, dateText} from '../app/now-model.mjs';
import {NOW_TABS} from '../app/view-prefs.js';
// OUTSIDE-글상세·관심환류 ③④(설계 docs/design/outside-statements.md 12절): Now 화면 순수 계산.

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';

test('탭 넷은 view_prefs.now_tab 값과 같고, 모르는 값은 사회운동, 밀기는 끝에서 멈춘다', () => {
  assert.deepEqual(NOW_TAB_IDS, ['outside', 'news', 'saved', 'search']);
  assert.deepEqual([...NOW_TABS], NOW_TAB_IDS);
  assert.equal(keepNowTab('news'), 'news');
  for (const v of [undefined, '', 'new', 'now', null]) assert.equal(keepNowTab(v), 'outside');
  assert.equal(nowTabAt('outside', 1), 'news');
  assert.equal(nowTabAt('search', 1), null);
  assert.equal(nowTabAt('outside', -1), null);
  assert.equal(nowTabAt('saved', -1), 'news');
});

test('서버에 보내는 것은 글 id만(상세)·글 id와 동작만(환류 기록)', () => {
  assert.deepEqual(detailBody({type: 'outside', id: A}), {kind: 'now_detail', outside_post_id: A});
  assert.deepEqual(detailBody({type: 'news', id: B}), {kind: 'now_detail', news_item_id: B});
  assert.deepEqual(signalBody('w', {type: 'news', id: B}, 'star'), {workspace_id: 'w', news_item_id: B, action: 'star'});
  assert.deepEqual(signalBody('w', {type: 'outside', id: A}, 'open'), {workspace_id: 'w', outside_post_id: A, action: 'open'});
});

test('관심 주제 이름: 1~30자·제어 문자 없음·겹침 없음(띄어쓰기·대소문자 무시)', () => {
  assert.deepEqual(cleanTopic('  공공  돌봄 '), {ok: true, topic: '공공 돌봄'});
  assert.equal(cleanTopic('').ok, false);
  assert.equal(cleanTopic('가'.repeat(31)).ok, false);
  assert.equal(cleanTopic('a\u0007b').ok, false);
  assert.deepEqual(cleanTopic('공공돌봄', ['공공 돌봄']), {ok: false, reason: '이미 있음'});
  const rows = [{topic: '철도', state: 'confirmed'}, {topic: '돌봄', state: 'candidate'}, {topic: '플랫폼', state: 'dropped'}];
  assert.deepEqual(confirmedTopics(rows), ['철도']);
  assert.deepEqual(candidateRows(rows).map(r => r.topic), ['돌봄']);
});

test('목록 작은 표시: 확정 주제가 제목·요약에 들면 그 주제 하나(2자 이상)', () => {
  assert.equal(interestHit(['철도 민영화 반대 성명', '요약'], ['돌봄', '철도 민영화']), '철도 민영화');
  assert.equal(interestHit('Rail Strike', ['rail strike']), 'rail strike');
  assert.equal(interestHit('아무 글', ['돌봄']), '');
  assert.equal(interestHit('가', ['가']), '');
});

test('상세 답 모양: 틀린 칸은 버리고 basic은 연관·시사점 없이', () => {
  const v = detailView({level: 'full', summary: ' 요약 ', key_sentences: [{orig: 'A line.', ko: '한 줄.'}, {orig: ''}, {orig: 'b'}, {orig: 'c'}, {orig: 'd'}],
    relevance: {topics: ['철도', '', 3], reason: '이유'}, implications: {kptu: '가', labor: ''},
    related: [{kind: 'ledger', id: 'x1', title: '원장 줄'}, {kind: 'bad', id: 'x', title: 't'}, {kind: 'news', id: B, title: ''}]});
  assert.equal(v.summary, '요약');
  assert.deepEqual(v.sentences, [{orig: 'A line.', ko: '한 줄.'}, {orig: 'b', ko: ''}, {orig: 'c', ko: ''}]);
  assert.deepEqual(v.relevance, {topics: ['철도'], reason: '이유'});
  assert.deepEqual(v.implications, {kptu: '가', labor: ''});
  assert.deepEqual(v.related, [{kind: 'ledger', id: 'x1', title: '원장 줄'}]);
  const b = detailView({level: 'basic', summary: 's'});
  assert.equal(b.level, 'basic');
  assert.equal(b.relevance, null);
  assert.equal(b.implications, null);
  assert.deepEqual(relatedTarget({kind: 'news', id: B}), {detail: {type: 'news', id: B}});
  assert.deepEqual(relatedTarget({kind: 'ledger', id: 'x'}), {view: 'ledger'});
  assert.equal(detailError({status: 429}), '오늘 상세 만들기를 다 씀 · 내일 다시');
  assert.equal(detailError({status: 503, message: 'monthly_limit'}), '이번 달 AI 한도를 다 씀');
});

test('[보관] 탭: 두 쪽을 최근 표시 순 한 목록, 칩으로 거르기', () => {
  const marks = [{post_id: A, starred_at: '2026-11-01T00:00:00Z', archived_at: null, app_outside_posts: {id: A, title: '성명'}},
    {post_id: '33333333-3333-4333-8333-333333333333', starred_at: null, archived_at: null, app_outside_posts: {id: 'x'}},
    {post_id: '44444444-4444-4444-8444-444444444444', starred_at: null, archived_at: '2026-11-03T00:00:00Z', app_outside_posts: {id: 'y', title: '보관 글'}}];
  const news = [{id: B, starred_at: '2026-11-02T00:00:00Z', folder_id: null}, {id: 'bad', starred_at: '2026-11-04T00:00:00Z'}];
  const rows = savedRows(marks, news);
  assert.deepEqual(rows.map(r => [r.type, r.star, r.archive]), [['outside', false, true], ['news', true, false], ['outside', true, false]]);
  assert.equal(filterSaved(rows, 'star').length, 2);
  assert.equal(filterSaved(rows, 'archive').length, 1);
  assert.equal(filterSaved(rows, 'news').length, 1);
  assert.equal(filterSaved(rows, 'nope').length, 3);
});

test('상세 날짜: 서울 시각, 자정이면 날짜만', () => {
  assert.equal(dateText('2026-10-06T00:30:00Z'), '2026. 10. 6. 09:30');
  assert.equal(dateText('2026-10-05T15:00:00Z'), '2026. 10. 6.');
  assert.equal(dateText(''), '');
});

// S48-66: 뉴스 기사를 상세 전에 먼저 읽기 — 재료 판정.
import {needsRead, hasMaterial, unreadReason} from '../app/now-model.mjs';
test('뉴스 상세: 요약·본문이 없으면 먼저 읽고, 유료는 읽지 않는다', () => {
  assert.equal(hasMaterial({summary: '요약'}), true);
  assert.equal(hasMaterial({body_kind: 'full'}), true);
  assert.equal(needsRead({state: 'pending', summary: null, body_kind: null}), true);
  assert.equal(needsRead({state: 'paywall'}), false);
  assert.equal(needsRead({state: 'ok', summary: '있음'}), false);
  assert.match(unreadReason('robots', ''), /막아/);
  assert.equal(unreadReason('', 'paywall'), '유료 기사');
});
