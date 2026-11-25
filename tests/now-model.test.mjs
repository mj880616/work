import test from 'node:test';
import assert from 'node:assert/strict';
import {NOW_TABS, NOW_TAB_IDS, SAVED_TAB_IDS, keepNowTab, nowTabAt, startTab, titleHit, mediaRows, mediaFits, keepMedia, mediaName, outsideKeysOf, newsKeysOf, mergeFeed, detailBody, signalBody, cleanTopic, confirmedTopics, candidateRows, interestHit, detailView, relatedTarget, detailError, savedRows, openTabFor, dateText, canTranslate, translatedBlocks, translateError, TRANSLATE_REST_MARK, TRANSLATE_FUNCTION, blocksBody, copyArticleText, shareArticleData} from '../app/now-model.mjs';
import {NEWS_TABS} from '../app/view-prefs.js';
// OUTSIDE-글상세·관심환류 ③④(설계 docs/design/outside-statements.md 12절): Now 화면 순수 계산.

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';

test('탭은 [전체][사회운동][언론][밑줄][메모]([보관] 탭 없앰 S68-24, [메모] S69-70), 기억 값은 news_tab DB 검사 값 안, 모르는 값은 전체, 밀기는 끝에서 멈춘다', () => {
  assert.deepEqual(NOW_TAB_IDS, ['all', 'movement', 'media', 'marks', 'memos']);
  // DB 검사 값('archive' 포함)은 그대로 두고(DB 바꾸지 않음), 기억하는 탭은 그 안에서 [밑줄]·옛 [보관]을 뺀 셋.
  assert.deepEqual([...NEWS_TABS], [...SAVED_TAB_IDS, 'archive'], 'S53-5: [밑줄]은 news_tab DB 검사 값에 없어 기억하지 않는다');
  assert.deepEqual(SAVED_TAB_IDS, NOW_TAB_IDS.slice(0, 3));
  assert.deepEqual(NOW_TABS.map(t => t.label), ['전체', '사회운동', '언론', '밑줄', '메모']);
  assert.equal(keepNowTab('memos'), 'memos');
  assert.ok(!SAVED_TAB_IDS.includes('memos'), 'S69-70: [메모]도 news_tab DB 검사 값에 없어 기억하지 않는다');
  assert.equal(keepNowTab('marks'), 'marks');
  assert.equal(keepNowTab('media'), 'media');
  for (const v of [undefined, '', 'news', 'outside', null, 'archive']) assert.equal(keepNowTab(v), 'all');
  assert.equal(nowTabAt('all', 1), 'movement');
  assert.equal(nowTabAt('media', 1), 'marks');
  assert.equal(nowTabAt('marks', 1), 'memos');
  assert.equal(nowTabAt('memos', 1), null);
  assert.equal(nowTabAt('all', -1), null);
  assert.equal(nowTabAt('marks', -1), 'media');
});

test('처음 탭: news_tab이 있으면 그것, 없으면 옛 now_tab을 바꿔 한 번 옮긴다(설계 7.3)', () => {
  assert.deepEqual(startTab('media', 'outside'), {tab: 'media', migrate: false});
  assert.deepEqual(startTab(undefined, 'outside'), {tab: 'movement', migrate: true});
  assert.deepEqual(startTab(undefined, 'news'), {tab: 'media', migrate: true});
  assert.deepEqual(startTab(undefined, 'saved'), {tab: 'all', migrate: true});
  // S68-24: 없앤 [보관] 탭을 기억한 사람은 [전체]로 연다(옮겨 적지 않음 — 다음에 탭을 고르면 그 값).
  assert.deepEqual(startTab('archive', 'news'), {tab: 'all', migrate: false});
  assert.deepEqual(startTab(undefined, 'search'), {tab: 'all', migrate: true});
  assert.deepEqual(startTab(undefined, undefined), {tab: 'all', migrate: false});
  assert.deepEqual(startTab('bogus', 'bogus'), {tab: 'all', migrate: false});
  assert.deepEqual(startTab('marks', undefined), {tab: 'all', migrate: false});
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
    related: [{kind: 'ledger', id: 'x1', title: '원장 줄'}, {kind: 'library', id: 'x2', title: '자료'}, {kind: 'bad', id: 'x', title: 't'}, {kind: 'news', id: B, title: ''}]});
  assert.equal(v.summary, '요약');
  assert.deepEqual(v.sentences, [{orig: 'A line.', ko: '한 줄.'}, {orig: 'b', ko: ''}, {orig: 'c', ko: ''}]);
  assert.deepEqual(v.relevance, {topics: ['철도'], reason: '이유'});
  assert.deepEqual(v.implications, {kptu: '가', labor: ''});
  assert.deepEqual(v.related, [{kind: 'library', id: 'x2', title: '자료'}]); // LEDGER-화면에서빼기: 원장 줄 없음
  const b = detailView({level: 'basic', summary: 's'});
  assert.equal(b.level, 'basic');
  assert.equal(b.relevance, null);
  assert.equal(b.implications, null);
  assert.deepEqual(relatedTarget({kind: 'news', id: B}), {detail: {type: 'news', id: B}});
  assert.deepEqual(relatedTarget({kind: 'ledger', id: 'x'}), {view: undefined});
  assert.equal(detailError({status: 429}), '오늘 상세 만들기를 다 씀 · 내일 다시');
  assert.equal(detailError({status: 503, message: 'monthly_limit'}), '이번 달 AI 한도를 다 씀');
});

test('보관한 글: 두 쪽 별표를 최근 순 한 목록(보관 = 별표, S67-09 — 읽을 거리 [News]·노트가 읽음), 다른 화면에서 여는 탭', () => {
  const marks = [{post_id: A, starred_at: '2026-11-01T00:00:00Z', app_outside_posts: {id: A, title: '성명'}},
    {post_id: '33333333-3333-4333-8333-333333333333', starred_at: null, app_outside_posts: {id: 'x'}},
    // 옛 보관 칸만 있는 줄은 보지 않는다(DB가 별표로 채웠다).
    {post_id: '44444444-4444-4444-8444-444444444444', starred_at: null, archived_at: '2026-11-03T00:00:00Z', app_outside_posts: {id: 'y', title: '보관 글'}},
    {post_id: '55555555-5555-4555-8555-555555555555', starred_at: '2026-11-03T00:00:00Z', archived_at: '2026-11-03T00:00:00Z', app_outside_posts: {id: 'z', title: '옮긴 글'}}];
  const news = [{id: B, starred_at: '2026-11-02T00:00:00Z', folder_id: null}, {id: 'bad', starred_at: '2026-11-04T00:00:00Z'}];
  const rows = savedRows(marks, news);
  assert.deepEqual(rows.map(r => [r.type, r.id, r.star]), [['outside', '55555555-5555-4555-8555-555555555555', true], ['news', B, true], ['outside', A, true]]);
  assert.ok(rows.every(r => !('archive' in r)));
  // S68-24: 읽을 거리·노트에서 연 글은 그 글이 든 탭(밑줄이면 [밑줄]).
  assert.equal(openTabFor('news'), 'media');
  assert.equal(openTabFor('outside'), 'movement');
  assert.equal(openTabFor('telegram'), 'all');
  assert.equal(openTabFor('news', true), 'marks');
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
  // NEWS-출처목록가나다: 묶음 순서는 그대로, 묶음 안 매체는 가나다(카탈로그 순서와 상관없이). '외국' 묶음 이름은 '국제'.
  const rows2 = mediaRows({tab: 'all', oc, on: ['kctu', 'kptu', 'jacobin'], nc: [...nc, {key: 'news-c', name: 'Able News', region: 'foreign'}], non: ['news-a', 'news-b', 'news-c']}).all;
  assert.deepEqual(rows2.map(r => r.name), ['전체', '노동', '공공운수노조', '민주노총', '국제', 'Jacobin', '언론 국내', '가상일보', '언론 국제', 'Able News', 'Fake Times']);
  assert.deepEqual(mediaRows({tab: 'all', oc, on: ['kctu'], nc, non: ['news-a'], query: '가상'}).all.map(r => r.id), ['n:news-a']);
  assert.equal(mediaFits('movement', 'n:news-a'), false);
  assert.equal(mediaFits('media', 'r:domestic'), true);
  assert.equal(mediaFits('archive', 'g:labor'), false);
  assert.equal(keepMedia('media', 's:kctu'), 'all');
  assert.equal(mediaName('s:kctu', {oc}), '민주노총');
  assert.equal(mediaName('r:foreign'), '언론 국제');
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

test('S69 사설·칼럼 묶음: 매체 고르기에 [사설·칼럼] 한 칸(언론 국내 다음), 고르면 사설·칼럼 매체만 거른다', () => {
  const nc = [{key: 'news-a', name: '가상일보', region: 'domestic'}, {key: 'news-a-opinion', name: '가상일보 사설·칼럼', region: 'opinion'},
    {key: 'news-c-opinion', name: '나상신문 사설·칼럼', region: 'opinion'}, {key: 'news-b', name: 'Fake Times', region: 'foreign'}];
  const rows = mediaRows({tab: 'media', nc, non: ['news-a', 'news-a-opinion', 'news-c-opinion', 'news-b']}).all;
  assert.deepEqual(rows.map(r => r.id), ['all', 'r:domestic', 'n:news-a', 'r:opinion', 'n:news-a-opinion', 'n:news-c-opinion', 'r:foreign', 'n:news-b']);
  assert.equal(rows.find(r => r.id === 'r:opinion').name, '사설·칼럼');
  assert.equal(mediaName('r:opinion'), '사설·칼럼');
  assert.deepEqual(newsKeysOf('r:opinion', nc), ['news-a-opinion', 'news-c-opinion']);
  assert.deepEqual(newsKeysOf('r:domestic', nc), ['news-a'], '언론 국내에는 사설·칼럼이 섞이지 않음');
  // 꺼 둔 사설·칼럼 매체는 줄에 없고, 다 끄면 묶음도 없다.
  assert.ok(!mediaRows({tab: 'media', nc, non: ['news-a']}).all.some(r => r.id === 'r:opinion'));
});

test('[전체] 한 줄: 시각 최신 순, 시각 모르는 글은 맨 뒤', () => {
  const m = mergeFeed([{id: 'p1', at: '2026-11-06T00:00:00Z'}, {id: 'p2', at: ''}], [{id: 'n1', at: '2026-11-06T01:00:00Z'}]);
  assert.deepEqual(m.map(x => `${x.type}:${x.id}`), ['news:n1', 'outside:p1', 'outside:p2']);
});

// S51-14 NEWS-전면개편 P4c: 상세 원문 전체(app_feed_bodies 한 줄 → 그릴 모양).
test('저장 원문: 블록은 글자·https 사진만, 상태마다 까닭 한 줄', async () => {
  const {bodyView, cleanBlocks, httpsUrl, legacyBody, BODY_REASONS} = await import('../app/now-model.mjs');
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
  // 글자 크기 단계는 공용 text-size-model.mjs(tests/text-size-model.test.mjs).
});

test('S51-17 P5: 잠깐의 오류(늦은 답·사이트 오류)로 실패한 저장 원문만 누를 때 다시 읽는다(설계 7.1)', async () => {
  const {reopenBody} = await import('../app/now-model.mjs');
  assert.equal(reopenBody({state: 'failed', reason: 'timeout'}), true);
  assert.equal(reopenBody({state: 'failed', reason: 'http_5xx'}), true);
  assert.equal(reopenBody({state: 'failed', reason: 'robots'}), true, 'S68-25: robots로 비어 있던 기사도 열 때 읽어 옴');
  for (const reason of ['bot_check', 'paywall', 'http_4xx', 'no_body', 'off_host', 'relay', 'too_big', null]) assert.equal(reopenBody({state: 'failed', reason}), false, String(reason));
  for (const state of ['ok', 'lead', 'image_only']) assert.equal(reopenBody({state, reason: 'timeout'}), false, state);
  assert.equal(reopenBody(null), false);
});

// S52-12 NEWS-원문먼저번역: 원문 칸 [번역] — 외국어 뉴스 기사만, 번역 줄은 같은 순서의 글자 블록에(사진·캡션 자리 그대로).
test('번역 단추는 외국어 뉴스 기사와 사회운동 영어 소식에만(S52-36), 저장 길은 함수마다', () => {
  assert.equal(canTranslate({type: 'news'}, {lang: 'en'}), true);
  assert.equal(canTranslate({type: 'news'}, {lang: 'ko'}), false);
  assert.equal(canTranslate({type: 'news'}, {lang: ''}), false);
  assert.equal(canTranslate({type: 'outside'}, {lang: 'en'}), true);
  assert.equal(canTranslate({type: 'outside'}, {lang: 'ko'}), false);
  assert.equal(canTranslate({type: 'update'}, {lang: 'en'}), false);
  assert.equal(canTranslate({type: 'toString'}, {lang: 'en'}), false);
  assert.deepEqual({...TRANSLATE_FUNCTION}, {news: 'news-feed', outside: 'outside-feed'});
});
test('사회운동 소식 번역 줄 맞추기: 저장 블록의 글자 블록을 한 줄씩(서버 blocksText와 같은 줄)', () => {
  const blocks = [{t: 'p', text: ' First  line. '}, {t: 'img', src: 'https://x/a.jpg', cap: 'Cap'}, {t: 'h', text: 'Head'}, {t: 'quote', text: 'Q.'}];
  assert.equal(blocksBody(blocks), 'First line.\nHead\nQ.');
  assert.equal(blocksBody(null), '');
  const r = translatedBlocks(blocks, blocksBody(blocks), '첫 줄.\n소제목\n인용.');
  assert.equal(r.aligned, true);
  assert.deepEqual(r.blocks.map(b => b.text ?? b.cap), ['첫 줄.', 'Cap', '소제목', '인용.']);
});
test('번역 줄은 글자 블록 자리에 하나씩, 사진·캡션은 그대로', () => {
  const blocks = [{t: 'p', text: 'One.'}, {t: 'img', src: 'https://x/a.jpg', cap: 'Cap', alt: ''}, {t: 'h', text: 'Head'}, {t: 'quote', text: 'Q.'}, {t: 'p', text: 'Two.'}];
  const r = translatedBlocks(blocks, 'One.\nHead\nQ.\nTwo.', '하나.\n\n소제목\n인용.\n둘.');
  assert.equal(r.aligned, true);
  assert.equal(r.partial, false);
  assert.deepEqual(r.blocks.map(b => b.t), ['p', 'img', 'h', 'quote', 'p']);
  assert.deepEqual(r.blocks.map(b => b.text ?? b.cap), ['하나.', 'Cap', '소제목', '인용.', '둘.']);
  assert.equal(blocks[0].text, 'One.', '원래 블록은 바꾸지 않음');
});
test('앞부분만 번역(서버 표시 줄)이면 앞 블록만 바꾸고 나머지는 원문', () => {
  const blocks = [{t: 'p', text: 'A'}, {t: 'p', text: 'B'}, {t: 'p', text: 'C'}];
  const r = translatedBlocks(blocks, 'A\nB\nC', `가\n\n${TRANSLATE_REST_MARK}`);
  assert.deepEqual(r.blocks.map(b => b.text), ['가', 'B', 'C']);
  assert.equal(r.partial, true);
  assert.equal(r.aligned, true);
});
test('줄 수가 안 맞으면 번역 문단만 차례로, 사진은 아래에', () => {
  const blocks = [{t: 'p', text: 'A'}, {t: 'img', src: 'https://x/a.jpg', cap: '', alt: ''}, {t: 'p', text: 'B'}, {t: 'p', text: 'C'}];
  const r = translatedBlocks(blocks, 'A\nB\nC', '가나');
  assert.equal(r.aligned, false);
  assert.deepEqual(r.blocks.map(b => b.t), ['p', 'img']);
  assert.equal(translatedBlocks(blocks, 'A', ''), null);
  assert.equal(translatedBlocks(blocks, 'A', null), null);
});
test('번역 실패 한 줄', () => {
  assert.equal(translateError({status: 429, message: 'DAILY_LIMIT'}), '오늘 번역을 다 씀 · 내일 다시');
  assert.equal(translateError({status: 429, message: 'MONTHLY_LIMIT'}), '이번 달 번역 한도를 다 씀');
  assert.equal(translateError({status: 503, message: 'AI_UNAVAILABLE'}), '번역하지 못함 · HTTP 503');
  assert.equal(translateError(new Error('x')), '번역하지 못함 · 잠시 뒤 다시');
});

// S52-39 NEWS-원문복사선택: [복사] 글 = 제목 / 매체 · 날짜 / 본문 전체(문단 사이 빈 줄) / 원래 주소. 사진·캡션은 빼고, 주소는 https만.
test('원문 [복사] 글: 제목·매체·날짜·문단·주소', () => {
  const head = {meta: ['가상 매체', '국제', '2026. 11. 7. 09:30', '가상 글쓴이'], title: '가상  제목', url: 'https://news.example.org/a'};
  const blocks = [{t: 'p', text: '첫  문단.'}, {t: 'h', text: '소제목'}, {t: 'img', src: 'https://x/a.jpg', cap: '사진 설명', alt: ''}, {t: 'quote', text: '인용.'}, {t: 'p', text: ''}, {t: 'p', text: '끝 문단.'}];
  assert.equal(copyArticleText(head, blocks), '가상 제목\n가상 매체 · 2026. 11. 7. 09:30\n\n첫 문단.\n\n소제목\n\n인용.\n\n끝 문단.\n\nhttps://news.example.org/a');
  assert.equal(copyArticleText({...head, url: 'javascript:alert(1)'}, []), '가상 제목\n가상 매체 · 2026. 11. 7. 09:30');
  assert.equal(copyArticleText({title: 'T', meta: []}, [{t: 'p', text: 'B'}]), 'T\n\nB');
  assert.equal(copyArticleText(null, null), '');
});
test('⋯ [공유]는 제목·주소만(본문은 넘기지 않음)', () => {
  assert.deepEqual(shareArticleData({title: '제목', url: 'https://x.example.org/1', meta: ['m']}), {title: '제목', url: 'https://x.example.org/1'});
  assert.deepEqual(shareArticleData({title: '제목', url: 'http://x.example.org/1'}), {title: '제목', text: '제목'});
  assert.equal(shareArticleData({}), null);
});

// S67-05 NEWS-직접넣기 사진: 본문 칸 사진 줄(서버 handPhotoSrc·handBlocks와 같은 모양)
test('hand photos: photo lines in the body box, round trip from blocks, insert at caret, 20 photo limit', async () => {
  const M = await import('../app/now-model.mjs');
  assert.equal(M.handPhotoKind('https://img.example.org/a.jpg'), 'ext');
  assert.equal(M.handPhotoKind('https://img.example.org/view?id=1'), 'plain');
  assert.equal(M.handPhotoKind('https://img.example.org/view?id=1#사진'), 'marked');
  for (const bad of ['http://img.example.org/a.jpg', 'javascript:alert(1)', 'data:image/png;base64,AA', 'https://u:p@img.example.org/a.jpg', 'https://img.example.org:8443/a.jpg', 'https://localhost/a.jpg', 'https://img.example.org/a.jpg 설명', ''])
    assert.equal(M.handPhotoKind(bad), '', bad);
  assert.equal(M.handPhotoLine('https://img.example.org/view?id=1'), 'https://img.example.org/view?id=1#사진');
  assert.equal(M.handPhotoLine('https://img.example.org/a.png'), 'https://img.example.org/a.png');
  const blocks = [{t: 'p', text: '첫 문단'}, {t: 'img', src: 'https://img.example.org/a.jpg', cap: '현장', alt: null}, {t: 'h', text: '소제목'},
    {t: 'img', src: 'https://img.example.org/v?id=2', cap: 'ⓒ 매체', alt: 'x'}, {t: 'img', src: 'https://img.example.org/b.gif', cap: null, alt: null}, {t: 'quote', text: '인용'}];
  assert.equal(M.handBodyOf(blocks), '첫 문단\nhttps://img.example.org/a.jpg\n사진: 현장\n소제목\nhttps://img.example.org/v?id=2#사진\nⓒ 매체\nhttps://img.example.org/b.gif\n인용');
  assert.equal(M.handInitial({url: 'https://www.example.org/x'}, blocks).body, M.handBodyOf(blocks));
  assert.deepEqual(M.insertPhotoLine('앞뒤', 1, 'P'), {value: '앞\nP\n뒤', caret: 4});
  assert.deepEqual(M.insertPhotoLine('줄\n', 2, 'P'), {value: '줄\nP\n', caret: 4});
  assert.deepEqual(M.insertPhotoLine('', 0, 'P'), {value: 'P\n', caret: 2});
  const many = n => Array.from({length: n}, (_, i) => `문단 ${i}\nhttps://img.example.org/${i}.jpg`).join('\n');
  assert.equal(M.handPhotoCount(many(21)), 21);
  assert.deepEqual(M.handRequest('id', {title: 't', body: many(21)}, {body: ''}), {error: '사진은 20장까지'});
  assert.ok(M.handRequest('id', {title: 't', body: many(20)}, {body: ''}).body.body);
  assert.equal(M.handError({status: 400, message: 'TOO_MANY_PHOTOS'}), '사진은 20장까지');
});

// S67-06 NEWS-직접넣기 사진 붙여넣기: 내가 올린 사진 = '[사진 n]' 줄 ↔ 안쪽 표시 주소 줄.
test('own photos: [사진 n] lines round-trip through the saved blocks and go out as inside addresses', async () => {
  const M = await import('../app/now-model.mjs');
  const own = 'https://photo.web2.invalid/driveFile0000000001.png';
  const init = M.handInitial({title: '합성 제목', url: 'https://news.example.org/a/1'}, [{t: 'p', text: '첫 문단'}, {t: 'img', src: own, cap: '합성 설명'}, {t: 'img', src: 'https://news.example.org/b.jpg'}, {t: 'p', text: '끝'}]);
  assert.equal(init.body, '첫 문단\n[사진 1]\n사진: 합성 설명\nhttps://news.example.org/b.jpg\n끝');
  assert.deepEqual(init.photos, [{n: 1, src: own}]);
  const photos = new Map([[1, own], [2, 'https://photo.web2.invalid/driveFile0000000002.jpg']]);
  // 본문이 그대로면 본문을 보내지 않는다(사진도 서버에 그대로).
  assert.equal('body' in M.handRequest('id1', {title: '합성 제목', body: init.body}, init, photos).body, false);
  const req = M.handRequest('id1', {title: '합성 제목', body: init.body + '\n[사진 2]\n[사진 9]'}, init, photos);
  assert.equal(req.body.body, '첫 문단\n' + own + '\n사진: 합성 설명\nhttps://news.example.org/b.jpg\n끝\nhttps://photo.web2.invalid/driveFile0000000002.jpg\n[사진 9]');
  assert.deepEqual(M.tokensIn('가\n [사진 3] \n[사진 1]\n[사진 3]\n[사진 x]'), [3, 1]);
  assert.deepEqual(M.ownPhotoOf(own), {id: 'driveFile0000000001', ext: 'png'});
  assert.equal(M.ownPhotoOf('https://photo.web2.invalid.example.org/driveFile0000000001.png'), null);
  // 20장 넘으면 화면에서 먼저 막는다(주소 줄 + 내 사진 줄).
  const many = new Map(Array.from({length: 21}, (_, i) => [i + 1, `https://photo.web2.invalid/driveFile00000000${String(i).padStart(2, '0')}.png`]));
  assert.deepEqual(M.handRequest('id1', {title: '제목', body: [...many.keys()].map(M.photoToken).join('\n') + '\n글'}, init, many), {error: '사진은 20장까지'});
});

test('own photos: kind and size are checked before anything goes up; lines go in at the cursor', async () => {
  const M = await import('../app/now-model.mjs');
  assert.equal(M.photoFileError({type: 'image/png', size: 10}), '');
  assert.equal(M.photoFileError({type: 'image/heic', size: 10}), 'jpg·png·webp·gif 사진만 넣을 수 있어요');
  assert.equal(M.photoFileError({type: 'image/svg+xml', size: 10}), 'jpg·png·webp·gif 사진만 넣을 수 있어요');
  assert.equal(M.photoFileError({type: 'image/jpeg', size: 10 * 1024 * 1024 + 1}), '사진은 한 장 10MB까지');
  assert.equal(M.photoFileError({type: 'image/jpeg', size: 0}), '빈 파일이에요');
  assert.deepEqual(M.insertPhotoLines('앞글뒤글', 2, ['[사진 1]', '[사진 2]']), {value: '앞글\n[사진 1]\n[사진 2]\n뒤글', caret: '앞글\n[사진 1]\n[사진 2]\n'.length});
  assert.match(M.handError({status: 415, message: 'PHOTO_TYPE'}), /jpg/);
  assert.match(M.handError({status: 413, message: 'PHOTO_TOO_LARGE'}), /10MB/);
  assert.match(M.handError({status: 424, message: 'DRIVE_NOT_CONNECTED'}), /구글 드라이브/);
});

// S68-39 NEWS-직접넣기원문주소: 손으로 넣는 칸의 원문 주소 · 옛 본문 첫 줄 주소 옮기기 · 본문 안 주소 작은 링크 조각.
const M = await import('../app/now-model.mjs');
test('hand url: initial value, request only when changed, http/https only, server refusals in plain words', () => {
  const init = M.handInitial({title: '합성 제목', url: 'https://news.example.org/a/1'}, [{t: 'p', text: '본문'}]);
  assert.equal(init.url, 'https://news.example.org/a/1');
  assert.equal(M.handInitial({url: 'javascript:alert(1)'}, []).url, '');
  const base = {title: '합성 제목', body: init.body};
  assert.equal('url' in M.handRequest('id', {...base, url: 'https://news.example.org/a/1'}, init).body, false);
  assert.equal('url' in M.handRequest('id', {...base, url: '   '}, init).body, false);
  assert.equal(M.handRequest('id', {...base, url: ' http://news.example.org/a/2 '}, init).body.url, 'http://news.example.org/a/2');
  for (const bad of ['javascript:alert(1)', 'news.example.org/a', 'https://a b.example.org', 'ftp://x.example.org/a', 'https://u:p@x.example.org/a', `https://x.example.org/${'a'.repeat(2000)}`]) {
    assert.deepEqual(M.handRequest('id', {...base, url: bad}, init), {error: '원문 주소는 http·https 주소로 넣어 주세요'}, bad.slice(0, 40));
  }
  assert.equal(M.handError(Object.assign(new Error('INVALID_URL'), {status: 400})), '넣을 수 없는 원문 주소예요 · 기사 주소를 넣어 주세요');
  assert.equal(M.handError(Object.assign(new Error('URL_TAKEN'), {status: 409})), '그 주소의 기사가 이미 있어요 · 그 주소로 다시 저장해 주세요');
});

test('hand url: first body line that is only an address moves to the url field; otherwise nothing', () => {
  const url = 'https://www.example.org/portal/bbs/view.do?nttId=1&menuNo=2';
  assert.equal(M.bodyFirstUrl([{t: 'p', text: ` ${url} `}, {t: 'p', text: '본문'}]), url);
  assert.equal(M.bodyFirstUrl([{t: 'p', text: `보세요 ${url}`}]), '');
  assert.equal(M.bodyFirstUrl([{t: 'img', src: 'https://www.example.org/a.jpg'}, {t: 'p', text: url}]), '');
  assert.equal(M.bodyFirstUrl([]), '');
  assert.deepEqual(M.movedUrlValues({title: 't', url: 'https://old.example.org/a', body: `${url}\n본문 하나\n둘`}), {title: 't', url, body: '본문 하나\n둘'});
  assert.equal(M.movedUrlValues({body: '본문 하나'}), null);
  // S68-44: 주소를 옮기고 남는 본문이 비어도 옮긴다(본문 없이 저장 — 서버가 빈 본문을 받는다).
  assert.deepEqual(M.movedUrlValues({title: 't', url: '', body: url}), {title: 't', url, body: ''});
});

// S68-44(명진 11/23 11:07 "본문 글자 없이도 저장되게"): 제목·본문 글자는 필수가 아니다. 모두 빈 것만 막는다.
test('S68-44 hand request: body may be emptied or photos only; title may be empty; only a fully empty article is refused', () => {
  const init = M.handInitial({title: '합성 제목', url: 'https://news.example.org/a/1'}, [{t: 'p', text: '본문'}]);
  // 본문 비우기 → 빈 글자 그대로 보냄(서버 = 본문 없음).
  assert.equal(M.handRequest('id', {title: '합성 제목', url: init.url, body: '  \n '}, init).body.body, '');
  // 사진만.
  assert.equal(M.handRequest('id', {title: '합성 제목', url: init.url, body: 'https://img.example.org/a.jpg'}, init).body.body, 'https://img.example.org/a.jpg');
  // 제목을 비우면 원문 주소 칸 값을 함께 보낸다(바뀌지 않았어도).
  const t0 = M.handRequest('id', {title: '', url: init.url, body: init.body}, init).body;
  assert.equal(t0.title, ''); assert.equal(t0.url, 'https://news.example.org/a/1'); assert.equal('body' in t0, false);
  // 제목·주소를 비웠지만 본문 칸에 글이 있으면 본문을 함께 보낸다.
  assert.equal(M.handRequest('id', {title: '', url: '', body: init.body}, init).body.body, '본문');
  // 모두 비면 보내지 않는다.
  assert.deepEqual(M.handRequest('id', {title: ' ', url: '', body: ''}, init), {error: M.HAND_EMPTY});
  assert.deepEqual(M.handRequest('id', {title: '', url: '', body: ''}, {body: '', url: ''}), {error: M.HAND_EMPTY});
  assert.equal(M.handError(Object.assign(new Error('EMPTY_ARTICLE'), {status: 400})), M.HAND_EMPTY);
});

test('hand url: addresses inside a paragraph become link pieces; trailing punctuation stays text; unsafe schemes stay text', () => {
  const url = 'https://www.example.org/portal/bbs/view.do?nttId=1&menuNo=2';
  assert.deepEqual(M.textWithUrls(`원문: ${url}. 끝`), [{text: '원문: '}, {url, text: url}, {text: '. 끝'}]);
  assert.deepEqual(M.textWithUrls('그냥 글'), [{text: '그냥 글'}]);
  assert.deepEqual(M.textWithUrls('javascript:alert(1) data:text/html,x'), [{text: 'javascript:alert(1) data:text/html,x'}]);
  assert.deepEqual(M.textWithUrls('(https://x.example.org/a)'), [{text: '('}, {url: 'https://x.example.org/a', text: 'https://x.example.org/a'}, {text: ')'}]);
});

// S68-49(명진 11/23 12:43 "업데이트 됐는데도 여전히 못 읽음"): 봇 확인(bot_check)·robots 실패도 [원문 다시 가져오기], 두 갈래 같다.
// 열 때 저절로 다시 읽는 것(reopenBody)은 그대로 — 봇 확인은 누를 때만. 손 본문(manual@1)은 다시 읽지 않는다.
// S69-02(명진 11/24 "글 안에서도 원문 다시 불러오기 버튼 … 어디있지"): 못 읽은 글(lead·failed — 까닭 상관없이)은 까닭 줄 단추, 두 갈래 같다.
test('S69-02: canRefetch — 앞부분만·실패 본문은 까닭 상관없이 단추(뉴스·사회운동), 손 본문·읽힌 본문·없는 줄은 아님', async () => {
  const {canRefetch, reopenBody} = await import('../app/now-model.mjs');
  for (const type of ['news', 'outside', '']) {
    for (const reason of ['no_body', 'paywall', null]) assert.equal(canRefetch({state: 'lead', reason}, type), true, `lead ${reason} ${type}`);
    for (const reason of ['bot_check', 'robots', 'timeout', 'http_5xx', 'http_4xx', 'no_body', 'too_big', null]) assert.equal(canRefetch({state: 'failed', reason}, type), true, `failed ${reason} ${type}`);
  }
  for (const state of ['ok', 'image_only']) assert.equal(canRefetch({state}), false, state);
  assert.equal(canRefetch({state: 'lead', reason: 'no_body', rule: 'manual@1'}, 'news'), false, '손 본문은 사람 것');
  assert.equal(canRefetch({state: 'failed', reason: 'bot_check', rule: 'manual@1'}), false, '손으로 비운 본문');
  assert.equal(canRefetch(null), false);
  assert.equal(reopenBody({state: 'lead', reason: 'no_body'}), false, '열 때 저절로 다시 읽지는 않음');
  assert.equal(reopenBody({state: 'failed', reason: 'bot_check'}), false, '봇 확인은 열 때 저절로 다시 읽지 않음');
});
test('S69-02: canRefetchMenu — 다 읽은 글도 ⋯ 메뉴에, 손 본문만 아님 · unreadLead — 피드 소개만 있는 뉴스 기사', async () => {
  const {canRefetchMenu, unreadLead} = await import('../app/now-model.mjs');
  for (const state of ['ok', 'image_only', 'lead', 'failed']) assert.equal(canRefetchMenu({state}), true, state);
  assert.equal(canRefetchMenu(null), true, '저장 원문 줄이 없는 옛 글');
  assert.equal(canRefetchMenu({state: 'ok', rule: 'manual@1'}), false);
  assert.equal(unreadLead({state: 'ok', body_kind: 'lead', summary: '소개'}), true);
  assert.equal(unreadLead({state: 'ok', body_kind: null, summary: '소개'}), true);
  assert.equal(unreadLead({state: 'ok', body_kind: 'full'}), false);
  assert.equal(unreadLead({state: 'paywall', body_kind: 'lead'}), false, '유료벽으로 이미 읽은 글');
  assert.equal(unreadLead({state: 'ok', body_kind: 'lead', manual_at: '2026-11-23T00:00:00Z'}), false, '사람이 넣은 기사');
  assert.equal(unreadLead(null), false);
});

test('S68-49: isNoMaterial — 운영 서버 답 모양(error 칸 no_material, message는 일반 글)으로 판단', async () => {
  const {isNoMaterial} = await import('../app/now-model.mjs');
  assert.equal(isNoMaterial({status: 422, serverCode: 'no_material', message: 'AI 요청을 처리하지 못했어요.'}), true, '11/23 캡처의 실제 답');
  assert.equal(isNoMaterial({status: 422, message: 'no_material'}), true, 'message만 있는 옛 모양');
  assert.equal(isNoMaterial({status: 422, serverCode: 'other', message: 'AI 요청을 처리하지 못했어요.'}), false);
  assert.equal(isNoMaterial({status: 500, serverCode: 'no_material'}), false);
  assert.equal(isNoMaterial(null), false);
});

test('S68-49: 사회운동 글도 못 읽으면 [본문 붙여 넣기](canHandFill), 요청은 글 id·본문만, 빈 본문·너무 긴 본문은 보내지 않음', async () => {
  const {canHandFill, handBodyRequest, HAND_BODY_MAX} = await import('../app/now-model.mjs');
  assert.equal(canHandFill({type: 'outside'}, {state: 'failed', blocks: []}), true);
  assert.equal(canHandFill({type: 'news'}, {state: 'failed', blocks: []}), true);
  assert.equal(canHandFill({type: 'outside'}, {state: 'ok', blocks: [{t: 'p', text: 'x'}]}), false);
  assert.equal(canHandFill({type: 'outside'}, {failedLoad: true}), false);
  assert.equal(canHandFill({type: 'update'}, {state: 'failed', blocks: []}), false);
  assert.deepEqual(handBodyRequest(A, '첫 문단\n\n둘째 문단'), {body: {id: A, body: '첫 문단\n\n둘째 문단'}});
  assert.ok(handBodyRequest(A, '   \n ').error);
  assert.ok(handBodyRequest(A, 'ㄱ'.repeat(HAND_BODY_MAX + 1)).error);
  assert.equal(HAND_BODY_MAX, 50000);
});

// S69-01: 저장본을 바로 그릴지(full + 요약 있음만), 서버 답이 이미 그린 저장본과 같은지(같으면 다시 그리지 않음).
test('S69-01 savedUsable·sameDetail', async () => {
  const {savedUsable, sameDetail} = await import('../app/now-model.mjs');
  const full = {level: 'full', summary: '요약.', generated_at: '2026-11-23T04:00:00Z', context_at: null};
  assert.equal(savedUsable(full), true);
  assert.equal(savedUsable({...full, level: 'basic'}), false, '한도 넘은 날의 요약만은 서버가 채우므로 기다림');
  assert.equal(savedUsable({...full, summary: '  '}), false);
  assert.equal(savedUsable(null), false);
  assert.equal(sameDetail(full, {...full, related: []}), true);
  assert.equal(sameDetail(full, {...full, generated_at: '2026-11-24T00:00:00Z'}), false);
  assert.equal(sameDetail(full, {...full, summary: '새 요약.'}), false);
  assert.equal(sameDetail(null, full), false);
});

// S69 READ-첨부본문: 짧은 본문(마침표 하나 등)은 요약하지 않고 '본문이 짧아 요약하지 않았어요', 손 본문이 짧으면 [원문 다시 가져오기].
test('bodyShort·handShort·noMaterialLine: 글자(띄어쓰기·문장부호 빼고) 20자 미만이면 짧은 본문', async () => {
  const M = await import('../app/now-model.mjs');
  const hand = blocks => ({state: 'ok', hand: true, blocks});
  const dot = hand([{t: 'img', src: 'https://img.example.org/g.png'}, {t: 'p', text: '.'}]);
  assert.equal(M.BODY_SHORT_CHARS, 20);
  assert.equal(M.bodyShort(dot), true);
  assert.equal(M.handShort(dot), true);
  assert.equal(M.handNoText(dot), false);
  assert.equal(M.noMaterialLine(dot, '기다림'), '본문이 짧아 요약하지 않았어요');
  assert.equal(M.noMaterialLine(hand([{t: 'img', src: 'https://img.example.org/g.png'}]), '기다림'), '본문 없음');
  assert.equal(M.noMaterialLine({state: 'failed', blocks: [], reason: '사이트가 늦게 답해 읽지 못함'}, '기다림'), '사이트가 늦게 답해 읽지 못함');
  const long = {state: 'ok', blocks: [{t: 'p', text: '노동자들이 오늘 광장에 모여 임금 인상과 인력 충원을 요구했다.'}]};
  assert.equal(M.bodyShort(long), false);
  assert.equal(M.handShort({...long, hand: true}), false);
  assert.equal(M.noMaterialLine(long, '기다림'), '기다림');
  assert.equal(M.handShort({state: 'ok', blocks: [{t: 'p', text: '.'}]}), false, '손 본문이 아니면 아님');
});
