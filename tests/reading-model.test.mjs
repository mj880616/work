// S68-09 READ-읽을거리함: 읽을 거리 순수 계산(app/reading-model.mjs) + 메뉴·폰 공유 칸·화면 연결 정적 확인.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readingUrl, sharedReading, newRow, lineOf, filterEntries, filterOptions, nextFilter, keepFilter, entriesOf, linkOf, markKeysOf, entryMarked, emptyText, LIST_COLS, bodyText, bodyPatch, keepOwn, stateLine, canRetry,
  paragraphs, sourceOf, shortDay, BODY_MAX, FILTERS, needsRefetch, refetchBatches, stopsAuto, copyPatch, REFETCH_SINCE, AUTO_BATCH} from '../app/reading-model.mjs';
import {ITEMS, DEFAULT_REST, withFeatures, defaultLayout} from '../app/menu-model.mjs';
import {cleanSource} from '../app/text-highlights-model.mjs';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const ID = '41000000-0000-4000-8000-000000000001';

test('주소: https만 받아 다듬고(http는 https로), 앞머리 없는 주소는 https로 본다', () => {
  assert.deepEqual(readingUrl('news.example.com/a'), {ok: true, url: 'https://news.example.com/a'});
  assert.deepEqual(readingUrl('http://ex.com/b'), {ok: true, url: 'https://ex.com/b'});
  assert.equal(readingUrl('').ok, false);
  assert.equal(readingUrl('javascript:alert(1)').ok, false);
  assert.equal(readingUrl('https://user:pw@ex.com/').ok, false);
  assert.equal(readingUrl('두 낱말 주소').ok, false);
});

test('폰 공유: 글에서 주소 하나와 제목 한 줄, 주소가 없으면 빈 주소', () => {
  assert.deepEqual(sharedReading({subject: '', text: '오늘 읽을 글\nhttp://ex.com/a?x=1.'}), {url: 'https://ex.com/a?x=1', title: '오늘 읽을 글'});
  assert.equal(sharedReading({subject: '제목만', text: '주소 없음'}).url, '');
  assert.deepEqual(newRow('https://www.ex.com/a', '  긴\n제목 '), {url: 'https://www.ex.com/a', title: '긴 제목', site: 'ex.com'});
});

test('목록 줄: 안 읽음 점·제목(없으면 사이트)·사이트·날짜, 거르기 칩 [안 읽음 n][전체][밑줄]', () => {
  const rows = [
    {id: 'a', url: 'https://ex.com/1', title: '첫 글', site: 'ex.com', saved_at: '2026-11-21T15:30:00Z', read_at: null, body_state: 'ok'},
    {id: 'b', url: 'https://www.ex.org/2', title: null, site: null, saved_at: '2026-11-20T00:00:00Z', read_at: '2026-11-21T00:00:00Z', body_state: 'weird'},
  ];
  assert.deepEqual(lineOf(rows[0]), {id: 'a', url: 'https://ex.com/1', title: '첫 글', site: 'ex.com', day: '11/22', unread: true, area: null, state: 'ok'});
  assert.equal(lineOf(rows[1]).title, 'ex.org');
  assert.equal(lineOf(rows[1]).state, 'pending');
  // 직접 저장한 줄만(News 연결 없음).
  const only = entriesOf(rows);
  const keys = markKeysOf([{source_type: 'reading', source_id: 'b'}]);
  assert.deepEqual(filterEntries(only, 'unread').map(e => e.key), ['a']);
  assert.deepEqual(filterEntries(only, 'all').map(e => e.key), ['a', 'b']);
  assert.deepEqual(filterEntries(only, 'marks', keys).map(e => e.key), ['b']);
  assert.deepEqual(filterOptions(only, keys).map(o => o.label), ['안 읽음 1', '전체', '밑줄 1']);
  assert.equal(keepFilter('news'), 'unread', 'S68-29: [News] 칩 값은 없다');
  assert.equal(nextFilter('marks', 1), 'marks');
  assert.equal(keepFilter('x'), 'unread');
  assert.deepEqual(FILTERS, ['unread', 'all', 'marks']);
  assert.equal(nextFilter('unread', 1), 'all');
  assert.equal(nextFilter('marks', 1), 'marks');
  assert.equal(nextFilter('all', -1), 'unread');
  assert.equal(shortDay('없음'), '');
});

const N1 = '41000000-0000-4000-8000-0000000000a1', N2 = '41000000-0000-4000-8000-0000000000a2', R1 = '41000000-0000-4000-8000-0000000000b1', R2 = '41000000-0000-4000-8000-0000000000b2', R3 = '41000000-0000-4000-8000-0000000000b3';
test('한 목록(S68-27·S68-29): 읽을 거리 표 하나 — News에서 보낸 줄도 평범한 줄(따로 거르는 칩 없음), 밑줄만 원래 글 연결 칸으로 안다', () => {
  assert.match(LIST_COLS, /,origin,news_article_id,outside_article_id$/);
  const rows = [
    {id: R1, url: 'https://ex.com/a', title: '같은 글', site: 'ex.com', saved_at: '2026-11-20T00:00:00Z', read_at: null, origin: 'direct', news_article_id: N1},
    {id: R2, url: 'https://ex.org/b', title: '직접 저장', site: 'ex.org', saved_at: '2026-11-22T00:00:00Z', read_at: '2026-11-22T01:00:00Z', origin: 'direct'},
    {id: R3, url: 'https://movement.example/p/1', title: '가상 성명', site: null, saved_at: '2026-11-23T00:00:00Z', read_at: null, origin: 'outside', outside_article_id: N2},
    {url: 'https://x.example/', saved_at: '2026-11-25T00:00:00Z'},
  ];
  const all = entriesOf(rows);
  // 저장 시각순(최근 위), id 없는 줄은 뺀다. 연결 칸이 그 줄의 원래 글.
  assert.deepEqual(all.map(e => e.key), [R3, R2, R1]);
  assert.deepEqual(all.map(e => e.link), [{type: 'outside', id: N2}, null, {type: 'news', id: N1}]);
  assert.equal(linkOf({news_article_id: 'nope'}), null);
  // 밑줄: 이 줄에 그은 것(reading) 또는 News에서 원래 글에 그은 것(원래 행 그대로).
  const keys = markKeysOf([{source_type: 'news', source_id: N1}, {source_type: 'reading', source_id: R2}]);
  // S68-29(명진 11/23 02:23): 칩은 [안 읽음][전체][밑줄] 셋뿐 — News에서 보낸 줄을 따로 거르지 않는다.
  assert.deepEqual(filterOptions(all, keys).map(o => o.label), ['안 읽음 2', '전체', '밑줄 2']);
  assert.deepEqual(filterEntries(all, 'news', keys).map(e => e.key), [R3, R1], '옛 칩 값은 처음 칩(안 읽음)으로');
  assert.deepEqual(filterEntries(all, 'unread', keys).map(e => e.key), [R3, R1], '안 읽음은 줄의 읽음 칸 하나로');
  assert.deepEqual(filterEntries(all, 'all', keys).map(e => e.key), [R3, R2, R1]);
  assert.deepEqual(filterEntries(all, 'marks', keys).map(e => e.key), [R2, R1]);
  assert.equal(entryMarked(all[0], keys), false);
  assert.equal(keepFilter('news'), 'unread');
  assert.equal(nextFilter('marks', 1), 'marks');
  assert.doesNotMatch(emptyText('all', 3), /News/);
  assert.match(emptyText('unread', 0), /^읽을 거리가 없어요/);
});

test('화면 연결(S68-27·S68-29): 이 표 하나만 읽고, News 길은 기능 키가 있다는 답일 때만 — 열기는 라우터 openFrom, News에서 온 줄 삭제는 dropSaved', () => {
  const src = read('app/reading.js');
  assert.match(src, /Array\.isArray\(features\) && features\.includes\('outside'\)/);
  assert.match(src, /const entriesNow = \(\) => entriesOf\(state\.rows\);/);
  assert.match(src, /const newsLinkOf = id => \(state\.newsOn \? linkOf\(rowOf\(id\)\) : null\);/);
  assert.match(src, /router\.openFrom\('outside', \(\) => window\.KPTUOutside\?\.openItem\?\./);
  assert.match(src, /import\('\.\/now-row-acts\.js'\)/);
  assert.doesNotMatch(src, /now-saved\.js|readSavedRows|mergeEntries|state\.saved/, '두 곳을 읽어 합치는 길은 없앴다');
  assert.doesNotMatch(src, /\/rest\/v1\//, '서버 길은 reading-data.js·now-row-acts.js');
  // S68-29: News에서 온 줄도 직접 넣은 줄과 같은 모양·단추 — 'News' 꼬리표·[News] 칩·'읽을 거리에서 빼기'·'News에서 열기' 없음.
  assert.doesNotMatch(src, /rd-src-tag|rd-row-news|newsTag|News에서 보냄|data-rd-act="release"|data-rd-act="news-open"|읽을 거리에서 빼기/);
  assert.doesNotMatch(read('app/reading.css'), /rd-src-tag|rd-row-news/);
  assert.match(src, /dropSaved\(link, \{saved: true, text: DEL_TEXT, label: DEL_LABEL/);
  assert.match(src, /const DEL_TEXT = '삭제했어요', DEL_LABEL = '읽을 거리 삭제';/);
  const news = read('app/outside-statements.js');
  assert.doesNotMatch(news, /data-now-panel-saved|createNowSaved/);
  assert.doesNotMatch(news, /data-now-go-saved|보관 ↗/, 'S68-28: News 탭 줄의 보관 길은 없앴다');
  assert.match(news, /openItem: async item =>/);
});

test('원문 사본: note-import 글자 블록만 글자로(사진·다른 블록 빼고, 제어 문자 빼고), 상태는 표 검사와 같은 이름', () => {
  const blocks = [{t: 'h', text: '소제목'}, {t: 'p', text: '첫 문단\u0001 글'}, {t: 'img', src: 'https://ex.com/a.png'}, {t: 'quote', text: '인용'}, {t: 'p', text: '<script>alert(1)</script>'}];
  assert.equal(bodyText(blocks), '소제목\n\n첫 문단 글\n\n인용\n\n<script>alert(1)</script>');
  assert.equal([...bodyText([{t: 'p', text: '가'.repeat(BODY_MAX + 10)}])].length, BODY_MAX);
  const ok = bodyPatch({ok: true, state: 'ok', title: '원문 제목', site: '예시 신문', blocks}, '2026-11-22T00:00:00.000Z');
  assert.deepEqual(Object.keys(ok).sort(), ['body', 'body_at', 'body_state', 'site', 'title']);
  assert.equal(ok.body_state, 'ok');
  assert.equal(bodyPatch({ok: true, state: 'lead', blocks}).body_state, 'paywall');
  assert.deepEqual(bodyPatch({ok: true, state: 'failed', reason: 'robots'}, 'T'), {body: null, body_state: 'robots', body_at: 'T'});
  assert.equal(bodyPatch({ok: true, state: 'failed', reason: 'redirect'}).body_state, 'blocked');
  assert.equal(bodyPatch({ok: true, state: 'failed', reason: 'timeout'}).body_state, 'failed');
  assert.equal(bodyPatch({ok: true, state: 'ok', blocks: []}).body_state, 'failed');
  assert.equal(bodyPatch(null).body_state, 'failed');
  // 사람이 단 제목은 원문 제목으로 덮지 않는다.
  assert.equal(keepOwn({title: '내 제목', url: 'https://ex.com/a', site: 'ex.com'}, ok).title, undefined);
  assert.equal(keepOwn({title: null, url: 'https://ex.com/a', site: 'ex.com'}, ok).site, '예시 신문');
});

test('상태 한 줄과 [다시]: 받기 전·막힘·앞부분만, 막힌 주소·너무 큰 글은 다시 하지 않는다', () => {
  assert.equal(stateLine({body_state: 'ok'}), '');
  assert.equal(stateLine({body_state: 'pending'}), '원문을 아직 가져오지 않았어요.');
  assert.equal(stateLine({body_state: 'pending'}, {busy: true}), '원문을 가져오는 중…');
  assert.equal(stateLine({body_state: 'paywall', body: '앞'}), '공개된 앞부분만 가져왔어요.');
  assert.match(stateLine({body_state: 'bot_check'}), /읽기를 막아/);
  assert.match(stateLine({body_state: 'robots'}), /다시 시도/); // S68-23: 옛 robots 상태는 다시 하면 읽힐 수 있다
  assert.match(stateLine({body_state: 'too_big'}), /너무 커서/);
  assert.equal(canRetry({body_state: 'failed'}), true);
  assert.equal(canRetry({body_state: 'blocked'}), false);
  assert.equal(canRetry({body_state: 'ok'}), false);
  assert.deepEqual(paragraphs('첫\n줄\n\n\n둘째 '), ['첫\n줄', '둘째']);
});

test('밑줄 출처: 종류 reading, 공용 밑줄 부품이 받는 모양', () => {
  const src = sourceOf({id: ID, url: 'https://ex.com/a', title: '글', site: 'ex.com', saved_at: '2026-11-22T00:00:00Z'});
  assert.deepEqual(cleanSource(src), {type: 'reading', id: ID, title: '글', media: 'ex.com', date: '2026-11-22T00:00:00.000Z', url: 'https://ex.com/a'});
  assert.equal(sourceOf({id: 'x'}), null);
});

test('메뉴: [읽을 거리]는 모든 사람(기능 키 없음), 처음 자리는 잊지 말기 다음, 화면·모양·폰 공유 칸이 이어져 있다', () => {
  const item = ITEMS.find(i => i.id === 'reading');
  assert.equal(item.label, '읽을 거리');
  assert.equal(item.view, 'reading');
  assert.equal(item.feature, undefined);
  assert.deepEqual(DEFAULT_REST.slice(0, 2), ['basket', 'reading']);
  assert.ok(withFeatures(defaultLayout(), []).rest.includes('reading'), '운영자 기능이 없어도 보인다');
  const loader = read('app/view-loader.js');
  assert.match(loader, /async function reading\(\)\{ await module\('\.\/reading\.js'\); return \{ok:true\} \}/);
  assert.match(loader, /reading:\['\.\/feed\.css',[^\]]*'\.\/reading\.css'/);
  assert.match(read('app/index.html'), /data-view="reading" href="\.\/\?view=reading">읽을 거리</);
  const manifest = read('android-app/app/src/main/AndroidManifest.xml');
  const alias = manifest.match(/<activity-alias\s+android:name="\.ShareToReading"[\s\S]*?<\/activity-alias>/)?.[0] || '';
  assert.match(alias, /android:targetActivity="\.MainActivity"/);
  assert.match(alias, /android:label="WORK ON\+ 읽을 거리"/);
  assert.match(alias, /android:mimeType="text\/plain"/);
  assert.doesNotMatch(alias, /android:permission=|uses-permission/);
  assert.match(read('android-app/app/src/main/java/kr/or/kptu/work/ShellRules.kt'), /SHARE_TO_READING -> "reading"/);
  // 원문은 글자로만 그린다(HTML로 넣지 않음). 원문 받기는 기존 note-import 하나.
  const view = read('app/reading.js').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(view, /innerHTML\s*=|insertAdjacentHTML\('beforeend', *(state|row|para|l\.)/);
  assert.match(read('app/reading-data.js'), /const FN = '\/functions\/v1\/note-import';/);
  assert.doesNotMatch(read('app/reading-data.js'), /news-feed|ai-assist/);
});

// S68-32 READ-보관글원문다시: 다시 가져오기 단추·자동 다시 가져오기(한 줄 한 번, 2개씩)·News 본문 사본.
test('canRetry: 다시 해도 같은 상태(ok·blocked·too_big)만 숨기고 robots·bot_check·paywall·failed·pending은 보인다', () => {
  for (const s of ['robots', 'bot_check', 'paywall', 'failed', 'pending']) assert.equal(canRetry({body_state: s}), true, s);
  for (const s of ['ok', 'blocked', 'too_big']) assert.equal(canRetry({body_state: s}), false, s);
  assert.equal(canRetry({body_state: '이상한 값'}), true); // 모르는 값 = pending
});

test('needsRefetch: 빈 줄·옛 실패·옛 robots만, 고친 뒤 해 본 줄·다시 해도 같은 상태는 아님', () => {
  const r = extra => ({id: ID, url: 'https://ex.com/a', body_state: 'robots', body_at: '2026-11-22T10:00:00Z', ...extra});
  assert.equal(REFETCH_SINCE, '2026-11-23T04:00:00+09:00');
  assert.equal(needsRefetch(r({body_state: 'pending', body_at: null})), true);
  assert.equal(needsRefetch(r({})), true); // 옛 robots
  assert.equal(needsRefetch(r({body_state: 'failed'})), true);
  assert.equal(needsRefetch(r({body_at: '2026-11-23T05:00:00+09:00'})), false); // 자동으로 한 번 해 본 뒤 = body_at이 새 시각
  assert.equal(needsRefetch(r({body_state: 'failed', body_at: '2026-11-22T19:00:01Z'})), false);
  for (const s of ['ok', 'paywall', 'too_big', 'blocked']) assert.equal(needsRefetch(r({body_state: s})), false, s);
  assert.equal(needsRefetch(r({body_state: 'bot_check'})), false); // 직접 넣은 줄의 봇 확인은 다시 해도 같음
  assert.equal(needsRefetch(r({body_state: 'bot_check', news_article_id: ID})), true); // News 줄은 News 본문이 채워졌을 수 있다
  assert.equal(needsRefetch(r({url: ''})), false);
  assert.equal(needsRefetch(r({id: 'x'})), false);
});

test('refetchBatches: 2개씩, 해 본 id·가져오는 중인 id는 빼고 목록 순서대로', () => {
  const ids = [1, 2, 3, 4, 5, 6].map(n => `41000000-0000-4000-8000-00000000010${n}`);
  const rows = ids.map((id, i) => ({id, url: 'https://ex.com/' + i, body_state: i === 4 ? 'ok' : 'pending', body_at: i === 4 ? '2026-11-22T00:00:00Z' : null}));
  assert.equal(AUTO_BATCH, 2);
  const got = refetchBatches(rows, {tried: new Set([ids[1]]), busy: id => id === ids[2]});
  assert.deepEqual(got.map(b => b.map(r => r.id)), [[ids[0], ids[3]], [ids[5]]]);
  assert.deepEqual(refetchBatches(null), []);
  assert.equal(stopsAuto('daily_limit'), true);
  assert.equal(stopsAuto('login'), true);
  assert.equal(stopsAuto('busy'), false);
});

test('copyPatch: News 본문 ok·lead 글자 블록만, lead는 paywall, 옛 사회운동 문장은 빈칸으로, 없으면 null', () => {
  const now = '2026-11-23T00:00:00Z';
  assert.deepEqual(copyPatch({state: 'ok', blocks: [{t: 'p', text: ' 첫 \u0007문단 '}, {t: 'img', src: 'x'}, {t: 'h', text: '소제목'}]}, null, now),
    {body: '첫 문단\n\n소제목', body_state: 'ok', body_at: now});
  assert.equal(copyPatch({state: 'lead', blocks: [{t: 'p', text: '앞부분'}]}, null, now).body_state, 'paywall');
  assert.equal(copyPatch({state: 'failed', blocks: [{t: 'p', text: '안 씀'}]}, null, now), null);
  assert.equal(copyPatch({state: 'ok', blocks: []}, null, now), null);
  assert.equal(copyPatch(null, null, now), null);
  assert.deepEqual(copyPatch(null, [{idx: 0, text: '문장 하나.'}, {idx: 1, text: ' '}, {idx: 2, text: '문장 둘.'}], now), {body: '문장 하나. 문장 둘.', body_state: 'ok', body_at: now});
  assert.equal([...copyPatch({state: 'ok', blocks: [{t: 'p', text: '가'.repeat(BODY_MAX + 5)}]}, null, now).body].length, BODY_MAX);
});

test('화면 연결: 열릴 때 자동 다시 가져오기(기존 startFetch, 2개씩), News 줄은 News 본문 먼저(feed-shared 읽기 길)', () => {
  const view = read('app/reading.js'), data = read('app/reading-data.js');
  assert.match(view, /refetchBatches\(state\.rows, \{tried: autoTried, busy: fetching\}\)/);
  assert.match(view, /batch\.map\(row => startFetch\(row\)/);
  assert.match(view, /if \(state\.loaded && !state\.failed\) void autoRefetch\(\);/);
  assert.match(data, /import\('\.\/feed-shared\.js'\)/);
  assert.match(data, /const copy = await newsCopy\(row\);/);
});
