// NOTE-주소로 가져오기 2단계(화면): 순수 부품 단위 시험. 주소·이름·글은 모두 가짜(example.com, 예시).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readImportUrl, safeHttps, hostOf, shortAddress, makeSource, noteSource, isUrlOnly, urlOnlyDoc, urlOnlyTitle, blocksToDoc, importedNote, importedTitle,
  failInfo, requestFailReason, resultOutcome, doneText, dayText, fetchedText, sourceLabel, sourceByline, busyTitle, createImportQueue, NOTE_BODY_MAX} from '../app/note-import-model.mjs';
import {toPlain} from '../app/ed-text.mjs';

const URL1 = 'https://news.example.com/article/2026/11/10/1234';

test('주소 칸: https만 받고 http는 막는다', () => {
  assert.deepEqual(readImportUrl('  ' + URL1 + '  '), {ok: true, url: URL1});
  assert.deepEqual(readImportUrl('news.example.com/a'), {ok: true, url: 'https://news.example.com/a'});
  assert.equal(readImportUrl('').ok, false);
  assert.match(readImportUrl('http://news.example.com/a').message, /http 주소는 가져올 수 없어요/);
  assert.equal(readImportUrl('ftp://news.example.com/a').ok, false);
  assert.equal(readImportUrl('javascript:alert(1)').ok, false);
  assert.equal(readImportUrl('https://user:pw@news.example.com/').ok, false);
  assert.equal(readImportUrl('https://localhost/a').ok, false);
  assert.match(readImportUrl(URL1 + ' ' + URL1).message, /하나만/);
  assert.match(readImportUrl('https://news.example.com/' + 'a'.repeat(2100)).message, /길어요/);
});

test('safeHttps·사이트 이름·짧은 주소', () => {
  assert.equal(safeHttps('http://news.example.com/'), '');
  assert.equal(safeHttps('data:text/html,<b>x</b>'), '');
  assert.equal(safeHttps(URL1), URL1);
  assert.equal(hostOf('https://www.news.example.com/a?b=1'), 'news.example.com');
  assert.equal(shortAddress('https://www.news.example.com/article/1234?utm=1#top'), 'news.example.com/article/1234');
  assert.equal([...shortAddress('https://news.example.com/' + 'a'.repeat(200))].length, 60);
});

test('원문 정보: 모르는 칸은 버리고 https가 아니면 없는 것으로 본다', () => {
  const source = makeSource({url: URL1, site: ' 예시일보\n', author: '예시 기자', published_at: '2026-11-10T03:00:00+09:00', fetched_at: '2026-11-11T01:00:00Z', state: 'ok', reason: 'lead', extra: 'x'});
  assert.deepEqual(source, {url: URL1, state: 'ok', site: '예시일보', author: '예시 기자', published_at: '2026-11-09T18:00:00.000Z', fetched_at: '2026-11-11T01:00:00.000Z', reason: 'lead'});
  assert.equal(makeSource({url: 'http://news.example.com/', state: 'ok'}), null);
  assert.equal(makeSource({url: URL1, state: 'weird'}), null);
  assert.equal(makeSource({url: URL1, state: 'failed', reason: '<b>'}).reason, undefined);
  assert.deepEqual(noteSource({metadata: {source: {url: URL1, state: 'fetching'}, pinned_at: 'x'}}), {url: URL1, state: 'fetching'});
  assert.equal(noteSource({metadata: {source: 'https://news.example.com'}}), null);
  assert.equal(noteSource({metadata: null}), null);
  assert.equal(makeSource({url: URL1, state: 'failed', reason: 'robots', kept: true}).kept, true);
});

test("'주소만' 노트: 본문이 주소 그대로일 때만", () => {
  const source = makeSource({url: URL1, state: 'fetching'});
  assert.equal(isUrlOnly({raw_text: URL1 + '\n', metadata: {source}}), true);
  assert.equal(isUrlOnly({raw_text: URL1 + '\n내가 쓴 글', metadata: {source}}), false);
  assert.equal(isUrlOnly({raw_text: URL1}), false);
  assert.equal(toPlain(urlOnlyDoc(URL1)), URL1);
  assert.equal(urlOnlyTitle('https://www.news.example.com/a'), 'news.example.com');
});

test('블록 → 저장 모양: 글자는 글자 노드로만(꺾쇠가 든 글도 그대로 글자)', () => {
  const doc = blocksToDoc([
    {t: 'h', text: '예시 소제목'},
    {t: 'p', text: '첫 문단 <script>alert(1)</script> <img src=x onerror=1>'},
    {t: 'quote', text: '인용한 말\n둘째 줄'},
    {t: 'img', text: '사진 설명', src: 'https://img.example.com/a.jpg'},
    {t: 'p', text: '   '},
    {t: 'p', text: 12},
    null,
  ]);
  const kinds = doc.doc.content.map(n => n.type);
  assert.deepEqual(kinds, ['heading', 'paragraph', 'blockquote']);
  assert.equal(doc.doc.content[1].content[0].text, '첫 문단 <script>alert(1)</script> <img src=x onerror=1>');
  assert.equal(doc.doc.content[1].content[0].marks, undefined);
  assert.deepEqual(doc.doc.content[2].content[0].content.map(n => n.type), ['text', 'hard_break', 'text']);
  assert.equal(JSON.stringify(doc).includes('img.example.com'), false);
  assert.equal(blocksToDoc([]), null);
  assert.equal(blocksToDoc('글'), null);
});

test('서버 결과 → 노트: 제목은 글 제목 → 사이트 → 주소, 본문 없으면 null', () => {
  const note = importedNote({title: ' 예시 지역 교통 계획,\n주민 의견 수렴 시작 ', site: '예시일보', blocks: [{t: 'p', text: '첫 문단'}, {t: 'p', text: '둘째 문단'}]}, URL1);
  assert.equal(note.title, '예시 지역 교통 계획, 주민 의견 수렴 시작');
  assert.equal(note.text, '첫 문단\n\n둘째 문단');
  assert.equal(importedTitle({site: '예시일보'}, URL1), '예시일보');
  assert.equal(importedTitle({}, URL1), 'news.example.com');
  assert.equal([...importedTitle({title: '가'.repeat(500)}, URL1)].length, 200);
  assert.equal(importedNote({blocks: []}, URL1), null);
  const long = importedNote({title: '긴 글', blocks: Array.from({length: 40}, () => ({t: 'p', text: '가'.repeat(5000)}))}, URL1);
  assert.ok([...long.text].length <= NOTE_BODY_MAX);
});

test('실패 안내: 이유별 일상어와 [다시 시도] 여부', () => {
  assert.deepEqual(failInfo('robots'), {text: '가져오지 못했어요. 이 사이트가 읽기를 막아 두었어요.', retry: false});
  assert.equal(failInfo('timeout').retry, true);
  assert.equal(failInfo('blocked').retry, false);
  assert.match(failInfo('daily_limit').text, /오늘은 더 가져올 수 없어요/);
  assert.match(failInfo('login').text, /로그인이 풀렸어요/);
  assert.deepEqual(failInfo('처음 보는 이유'), failInfo('busy'));
  for (const reason of ['blocked', 'unreachable', 'robots', 'too_big', 'timeout', 'not_found', 'http_error', 'redirect', 'not_text', 'bot_check', 'paywall', 'no_body']) {
    const info = failInfo(reason);
    assert.ok(info.text && !/[A-Za-z_]{4,}/.test(info.text.replace('http', '')), reason);
  }
});

test('요청 실패 → 이유: 하루 횟수·로그인 만료', () => {
  assert.equal(requestFailReason({status: 429, message: 'DAILY_LIMIT'}), 'daily_limit');
  assert.equal(requestFailReason({status: 401, code: 'session_required'}), 'login');
  assert.equal(requestFailReason({code: 'session_changed'}), 'login');
  assert.equal(requestFailReason({status: 403}), 'forbidden');
  assert.equal(requestFailReason({status: 400}), 'blocked');
  assert.equal(requestFailReason({status: 503, message: 'LOOKUP_UNAVAILABLE'}), 'busy');
  assert.equal(requestFailReason(new Error('network')), 'busy');
});

test('서버 결과 → 끝 상태', () => {
  assert.deepEqual(resultOutcome({ok: true, state: 'ok'}), {state: 'ok', reason: null});
  assert.deepEqual(resultOutcome({ok: true, state: 'ok', truncated: true}), {state: 'ok', reason: 'cut'});
  assert.deepEqual(resultOutcome({ok: true, state: 'lead', reason: 'paywall'}), {state: 'ok', reason: 'lead'});
  assert.deepEqual(resultOutcome({ok: true, state: 'failed', reason: 'robots'}), {state: 'failed', reason: 'robots'});
  assert.deepEqual(resultOutcome({ok: true, state: 'failed', reason: 'DROP TABLE'}), {state: 'failed', reason: 'busy'});
  assert.deepEqual(resultOutcome(null), {state: 'failed', reason: 'busy'});
  assert.equal(doneText(null), '글을 가져왔어요.');
  assert.match(doneText('lead'), /앞부분만/);
});

test('날짜·원문 줄 글자', () => {
  assert.equal(dayText('2026-11-10T03:00:00Z'), '2026. 11. 10.');
  assert.equal(dayText('2026-11-10T16:00:00Z'), '2026. 11. 11.');
  assert.equal(fetchedText('2026-11-11T01:00:00Z'), '11. 11. 가져옴');
  assert.equal(dayText('아님'), '');
  const source = makeSource({url: URL1, site: '예시일보', author: '예시 기자', published_at: '2026-11-10T03:00:00Z', state: 'ok'});
  assert.equal(sourceLabel(source), '예시일보 · news.example.com/article/2026/11/10/1234');
  assert.equal(sourceLabel(makeSource({url: URL1, state: 'failed'})), 'news.example.com/article/2026/11/10/1234');
  assert.equal(sourceByline(source), '예시 기자 · 2026. 11. 10.');
  assert.equal(sourceByline(makeSource({url: URL1, state: 'ok'})), '');
  assert.equal(busyTitle(source), 'news.example.com에서 가져오는 중…');
});

test('뒤처리 줄: 한 번에 하나, 온 순서대로, 처리 중에 또 와도 줄 세운다', async () => {
  const order = [], events = [], gates = new Map();
  const queue = createImportQueue({
    run: job => new Promise(resolve => { order.push('start:' + job.id); gates.set(job.id, () => { order.push('end:' + job.id); resolve({state: 'ok'}); }); }),
    report: e => events.push(e.type + ':' + e.job.id),
  });
  assert.equal(queue.add({id: 'a'}), true);
  assert.equal(queue.add({id: 'b'}), true);
  assert.equal(queue.add({id: 'a'}), false, '같은 노트는 두 번 세우지 않는다');
  assert.equal(queue.size, 2);
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(order, ['start:a']);
  assert.equal(queue.has('a'), true); assert.equal(queue.has('b'), true);
  gates.get('a')();
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(order, ['start:a', 'end:a', 'start:b']);
  assert.equal(queue.add({id: 'c'}), true);
  gates.get('b')();
  await new Promise(r => setTimeout(r, 0));
  gates.get('c')();
  await queue.idle();
  assert.deepEqual(order, ['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c']);
  assert.equal(queue.size, 0); assert.equal(queue.has('a'), false);
  assert.deepEqual(events.filter(e => e.startsWith('done')), ['done:a', 'done:b', 'done:c']);
});

test('뒤처리 줄: 하나가 던져도 다음 것은 이어서 한다', async () => {
  const done = [];
  const queue = createImportQueue({run: async job => { if (job.id === 'x') throw new Error('boom'); return {state: 'ok'}; }, report: e => { if (e.type === 'done') done.push([e.job.id, e.outcome.state]); }});
  queue.add({id: 'x'}); queue.add({id: 'y'});
  await queue.idle();
  assert.deepEqual(done, [['x', 'failed'], ['y', 'ok']]);
});
