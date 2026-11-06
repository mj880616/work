import test from 'node:test';
import assert from 'node:assert/strict';
import {NOW_TABS, NOW_TAB_IDS, keepNowTab, nowTabAt, startTab, titleHit, mediaRows, mediaFits, keepMedia, mediaName, outsideKeysOf, newsKeysOf, mergeFeed, detailBody, signalBody, cleanTopic, confirmedTopics, candidateRows, interestHit, detailView, relatedTarget, detailError, savedRows, filterSaved, dateText} from '../app/now-model.mjs';
import {NEWS_TABS} from '../app/view-prefs.js';
// OUTSIDE-글상세·관심환류 ③④(설계 docs/design/outside-statements.md 12절): Now 화면 순수 계산.

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';

test('탭 넷은 view_prefs.news_tab 값과 같고, 모르는 값은 전체, 밀기는 끝에서 멈춘다', () => {
  assert.deepEqual(NOW_TAB_IDS, ['all', 'movement', 'media', 'archive']);
  assert.deepEqual([...NEWS_TABS], NOW_TAB_IDS);
  assert.deepEqual(NOW_TABS.map(t => t.label), ['전체', '사회운동', '언론', '보관']);
  assert.equal(keepNowTab('media'), 'media');
  for (const v of [undefined, '', 'news', 'outside', null]) assert.equal(keepNowTab(v), 'all');
  assert.equal(nowTabAt('all', 1), 'movement');
  assert.equal(nowTabAt('archive', 1), null);
  assert.equal(nowTabAt('all', -1), null);
  assert.equal(nowTabAt('archive', -1), 'media');
});

test('처음 탭: news_tab이 있으면 그것, 없으면 옛 now_tab을 바꿔 한 번 옮긴다(설계 7.3)', () => {
  assert.deepEqual(startTab('media', 'outside'), {tab: 'media', migrate: false});
  assert.deepEqual(startTab(undefined, 'outside'), {tab: 'movement', migrate: true});
  assert.deepEqual(startTab(undefined, 'news'), {tab: 'media', migrate: true});
  assert.deepEqual(startTab(undefined, 'saved'), {tab: 'archive', migrate: true});
  assert.deepEqual(startTab(undefined, 'search'), {tab: 'all', migrate: true});
  assert.deepEqual(startTab(undefined, undefined), {tab: 'all', migrate: false});
  assert.deepEqual(startTab('bogus', 'bogus'), {tab: 'all', migrate: false});
});

test('제목 거르기: 띄어쓰기·대소문자 무시, 빈 말은 모두 통과', () => {
  assert.equal(titleHit(['철도 노조 파업'], '노조파업'), true);
  assert.equal(titleHit(['Rail Strike'], 'rail'), true);
  assert.equal(titleHit(['철도'], '버스'), false);
  assert.equal(titleHit(['철도'], '  '), true);
  assert.equal(titleHit([null, '원제 Strike'], 'strike'), true);
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

test('매체 고르기 줄: 전체 → 묶음 → 켠 매체, 탭마다 쓸 수 있는 쪽만(사회운동·언론), 찾는 말은 이름으로', () => {
  const oc = [{key: 'kctu', name: '민주노총', group: 'labor'}, {key: 'kptu', name: '공공운수노조', group: 'labor'}, {key: 'jacobin', name: 'Jacobin', group: 'foreign'}];
  const nc = [{key: 'news-a', name: '가상일보', region: 'domestic'}, {key: 'news-b', name: 'Fake Times', region: 'foreign'}];
  const all = mediaRows({tab: 'all', oc, on: ['kctu', 'jacobin'], nc, non: ['news-a'], pick: 's:kctu'}).all;
  assert.deepEqual(all.map(r => [r.id, r.depth]), [['all', 0], ['g:labor', 0], ['s:kctu', 1], ['g:foreign', 0], ['s:jacobin', 1], ['r:domestic', 0], ['n:news-a', 1]]);
  assert.equal(all.find(r => r.current).id, 's:kctu');
  assert.deepEqual(mediaRows({tab: 'movement', oc, on: ['kctu'], nc, non: ['news-a']}).all.map(r => r.id), ['all', 'g:labor', 's:kctu']);
  assert.deepEqual(mediaRows({tab: 'media', oc, on: ['kctu'], nc, non: ['news-a', 'news-b']}).all.map(r => r.id), ['all', 'r:domestic', 'n:news-a', 'r:foreign', 'n:news-b']);
  assert.deepEqual(mediaRows({tab: 'all', oc, on: ['kctu'], nc, non: ['news-a'], query: '가상'}).all.map(r => r.id), ['n:news-a']);
  assert.equal(mediaFits('movement', 'n:news-a'), false);
  assert.equal(mediaFits('media', 'r:domestic'), true);
  assert.equal(mediaFits('archive', 'g:labor'), false);
  assert.equal(keepMedia('media', 's:kctu'), 'all');
  assert.equal(mediaName('s:kctu', {oc}), '민주노총');
  assert.equal(mediaName('r:foreign'), '언론 외국');
  assert.equal(mediaName('all'), '전체');
});

test('매체 거르기: 사회운동 키 · 언론 키(고른 쪽이 아니면 빈 목록)', () => {
  const oc = [{key: 'kctu', group: 'labor'}, {key: 'kptu', group: 'labor'}];
  const nc = [{key: 'news-a', region: 'domestic'}, {key: 'news-b', region: 'foreign'}];
  assert.equal(outsideKeysOf('all', oc, ['kctu']), null);
  assert.deepEqual(outsideKeysOf('g:labor', oc, ['kctu']), ['kctu']);
  assert.deepEqual(outsideKeysOf('n:news-a', oc, ['kctu']), []);
  assert.equal(newsKeysOf('all', nc), null);
  assert.deepEqual(newsKeysOf('r:foreign', nc), ['news-b']);
  assert.deepEqual(newsKeysOf('s:kctu', nc), []);
});

test('[전체] 한 줄: 시각 최신 순, 시각 모르는 글은 맨 뒤', () => {
  const m = mergeFeed([{id: 'p1', at: '2026-11-06T00:00:00Z'}, {id: 'p2', at: ''}], [{id: 'n1', at: '2026-11-06T01:00:00Z'}]);
  assert.deepEqual(m.map(x => `${x.type}:${x.id}`), ['news:n1', 'outside:p1', 'outside:p2']);
});

// S51-14 NEWS-전면개편 P4c: 상세 원문 전체(app_feed_bodies 한 줄 → 그릴 모양).
test('저장 원문: 블록은 글자·https 사진만, 상태마다 까닭 한 줄', async () => {
  const {bodyView, cleanBlocks, httpsUrl, legacyBody, keepNewsFont, NEWS_FONT_STEPS, BODY_REASONS} = await import('../app/now-model.mjs');
  assert.equal(httpsUrl('https://a.example/x.jpg'), 'https://a.example/x.jpg');
  for (const v of ['http://a.example/x.jpg', 'javascript:alert(1)', 'data:image/png;base64,AA', '//a.example/x', '', null, 'https://' + 'a'.repeat(2000)]) assert.equal(httpsUrl(v), '');
  assert.deepEqual(cleanBlocks([{t: 'p', text: ' 문단 '}, {t: 'p', text: ''}, {t: 'h', text: '소제목'}, {t: 'quote', text: '인용'}, {t: 'img', src: 'https://a.example/1.jpg', cap: '설명', alt: null}, {t: 'img', src: 'http://a.example/2.jpg'}, {t: 'script', text: 'x'}, null, 'p']),
    [{t: 'p', text: '문단'}, {t: 'h', text: '소제목'}, {t: 'quote', text: '인용'}, {t: 'img', src: 'https://a.example/1.jpg', cap: '설명', alt: ''}]);
  assert.equal(cleanBlocks(Array.from({length: 30}, (_, i) => ({t: 'img', src: `https://a.example/${i}.jpg`}))).length, 20);
  assert.deepEqual(bodyView({state: 'ok', reason: null, blocks: [{t: 'p', text: '가'}]}), {state: 'ok', blocks: [{t: 'p', text: '가'}], reason: ''});
  assert.deepEqual(bodyView({state: 'ok', blocks: []}), {state: 'failed', blocks: [], reason: BODY_REASONS.no_body});
  assert.equal(bodyView({state: 'lead', reason: 'paywall', blocks: [{t: 'p', text: '가'}]}).reason, '유료 기사라 앞부분만');
  assert.equal(bodyView({state: 'image_only', blocks: [{t: 'img', src: 'https://a.example/1.jpg'}]}).reason, '그림·첨부만 있는 글');
  assert.deepEqual(bodyView({state: 'failed', reason: 'relay', blocks: [{t: 'p', text: '안 보임'}]}), {state: 'failed', blocks: [], reason: BODY_REASONS.relay});
  assert.equal(bodyView({state: 'failed', reason: 'unknown'}).reason, '본문을 읽지 못함');
  for (const r of ['robots', 'bot_check', 'paywall', 'too_big', 'timeout', 'http_4xx', 'http_5xx', 'no_body', 'off_host', 'relay']) assert.ok(BODY_REASONS[r], r);
  assert.equal(bodyView(null), null);
  assert.equal(bodyView({state: 'weird'}), null);
  assert.deepEqual(legacyBody('첫 줄\n\n둘째 줄'), {state: 'ok', blocks: [{t: 'p', text: '첫 줄'}, {t: 'p', text: '둘째 줄'}], reason: ''});
  assert.equal(legacyBody('가', {lead: true}).state, 'lead');
  assert.equal(legacyBody('  ').state, 'failed');
  const {NEWS_FONTS} = await import('../app/view-prefs.js');
  assert.deepEqual(NEWS_FONT_STEPS.map(f => f.id), [...NEWS_FONTS]);
  assert.equal(keepNewsFont('l'), 'l');
  for (const v of [undefined, '', 'xl', null]) assert.equal(keepNewsFont(v), 'm');
});

test('S51-17 P5: 잠깐의 오류(늦은 답·사이트 오류)로 실패한 저장 원문만 누를 때 다시 읽는다(설계 7.1)', async () => {
  const {reopenBody} = await import('../app/now-model.mjs');
  assert.equal(reopenBody({state: 'failed', reason: 'timeout'}), true);
  assert.equal(reopenBody({state: 'failed', reason: 'http_5xx'}), true);
  for (const reason of ['robots', 'bot_check', 'paywall', 'http_4xx', 'no_body', 'off_host', 'relay', 'too_big', null]) assert.equal(reopenBody({state: 'failed', reason}), false, String(reason));
  for (const state of ['ok', 'lead', 'image_only']) assert.equal(reopenBody({state, reason: 'timeout'}), false, state);
  assert.equal(reopenBody(null), false);
});
