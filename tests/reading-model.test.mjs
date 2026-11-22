// S68-09 READ-읽을거리함: 읽을 거리 순수 계산(app/reading-model.mjs) + 메뉴·폰 공유 칸·화면 연결 정적 확인.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readingUrl, sharedReading, newRow, lineOf, filterRows, filterOptions, nextFilter, keepFilter, bodyText, bodyPatch, keepOwn, stateLine, canRetry,
  paragraphs, sourceOf, shortDay, BODY_MAX, FILTERS} from '../app/reading-model.mjs';
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
  assert.deepEqual(filterRows(rows, 'unread').map(r => r.id), ['a']);
  assert.deepEqual(filterRows(rows, 'all').map(r => r.id), ['a', 'b']);
  assert.deepEqual(filterRows(rows, 'marks', new Set(['b'])).map(r => r.id), ['b']);
  assert.deepEqual(filterOptions(rows, new Set(['b'])).map(o => o.label), ['안 읽음 1', '전체', '밑줄 1']);
  assert.equal(keepFilter('x'), 'unread');
  assert.deepEqual(FILTERS, ['unread', 'all', 'marks']);
  assert.equal(nextFilter('unread', 1), 'all');
  assert.equal(nextFilter('marks', 1), 'marks');
  assert.equal(nextFilter('all', -1), 'unread');
  assert.equal(shortDay('없음'), '');
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
  assert.match(stateLine({body_state: 'robots'}), /읽기를 막아/);
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
