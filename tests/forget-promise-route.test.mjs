import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// S61-11 FORGET-요청방향 2단계(명진 11/13 05:19): 내가 남에게 부탁한 일은 명진 할 일(처리 전)에서 빼고 잊지 말기 맨 아래 '상대 약속' 줄로.
const m = await import('../app/forget-news-data.js');
const fl = await import('../app/forget-list.js');
const row = (id, kind, extra = {}) => ({id, day: '2026-11-08', source: 'telegram', feed_item_id: 'f' + id, org_name: '가상지부', line: '가상지부 자료 보내기', status: 'suggested',
  final_line: null, picked_at: '2026-11-08T01:00:00Z', decided_at: null, app_journal_memorable_picks: kind ? {kind, reason: kind === 'promise' ? '상대 약속 · 자료 요청' : '할 일 · x', picked_at: extra.pickedAt || '2026-11-08T01:00:00Z'} : null, ...extra});

test('소식 종류 promise: 처리 전 할 일·빨간 숫자에서 빠지고 상대 약속 줄로만 간다', () => {
  const rows = m.newsRows([row('a', 'promise'), row('b', 'task'), row('c', null), row('d', 'promise', {status: 'dropped'})]);
  assert.deepEqual(rows.map(r => r.kind), ['promise', 'task', '', 'promise']);
  assert.deepEqual(m.openNews(rows, true).map(r => r.id), ['b'], 'promise lines are not counted as open');
  assert.deepEqual(m.promiseNews(rows).map(r => r.id), ['a'], 'only open promise lines');
  assert.deepEqual(fl.newsFor('open', rows, true).map(r => r.id), ['b']);
  assert.deepEqual(fl.newsFor('dismissed', rows, true).map(r => r.id), ['d'], 'a dismissed promise line stays in 무시 (undo path)');
});

test('다시 판정 대상: 방향 규칙 전에 할 일로 고른 처리 전 줄만(서버와 같은 시각)', () => {
  const rows = m.newsRows([row('a', 'task'), row('b', 'task', {pickedAt: '2026-11-13T01:00:00Z'}), row('c', 'event'), row('d', 'task', {status: 'kept'})]);
  assert.deepEqual(m.suspectNews(rows, true).map(r => r.id), ['a']);
  assert.deepEqual(m.suspectNews(rows, false), [], 'unknown picks → none');
  const server = readFileSync('supabase/functions/ai-assist/journal-memorable.ts', 'utf8');
  assert.match(server, new RegExp(`MEMORABLE_DIRECTION_SINCE = "${m.NEWS_DIRECTION_SINCE}"`));
});

test('상대 약속 줄: 출처 꼬리표·버튼(원장으로·받음·무시)·원장 글에 사람 이름·연락처 없음', () => {
  assert.deepEqual(fl.PROMISE_NEWS_ACTS.map(a => a[0]), ['ledger', 'done', 'dismissed']);
  const [r] = m.newsRows([row('a', 'promise')]);
  const text = fl.promiseNewsLedger(r);
  assert.match(text, /^쓰기요청\n- 종류: 약속\(상대·제3자\)\n- 내용: 가상지부 · 가상지부 자료 보내기\n/);
  assert.match(text, /- 출처: Web2 소식\(텔레그램\) 2026-11-08$/);
  const src = readFileSync('app/forget-list.js', 'utf8');
  assert.match(src, /src: `\$\{SOURCE_TAG\.promise\} · \$\{SOURCE_TAG\.todo\}`/, 'radar promises tagged 상대 약속 · 챙길 것');
  assert.match(src, /src: `\$\{SOURCE_TAG\.promise\} · \$\{r\.source === 'telegram' \? '텔레그램' : '통화'\}`/, 'news promises tagged 상대 약속 · 텔레그램/통화');
  // 다시 판정: 미리 보기 수를 먼저 보이고 [확인]을 눌러야 실행(기존 화면 재사용), 상대 약속으로 옮길 수도 보인다.
  assert.match(src, /개는 상대 약속으로/);
  assert.match(src, /suspectNews\(news, nPicks\)\.length/);
});
