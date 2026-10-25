import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// INBOX-상대약속: 정리함 [챙길 것] shows the counterpart promises the radar already returns. No new judgement, nothing stored, never counted.
const radar = await import('../app/todo-radar-data.js');
const read = name => readFile(new URL(`../app/${name}`, import.meta.url), 'utf8');
const promise = {summary: '상대 측 자료 송부 약속', due: '2026-10-10', evidence: '보내기로 함', source_kind: 'meeting', source_id: 'c0000000-0000-4000-8000-000000000050', source_day: '2026-10-05'};

test('the inbox copies the same 쓰기요청 text as the home card', async () => {
  const inbox = await read('inbox-todos.js'), card = await read('todo-radar.js');
  assert.match(inbox, /ledgerRequestText\(p\)/);
  assert.match(card, /ledgerRequestText\(p\)/);
  assert.match(radar.ledgerRequestText(promise), /^쓰기요청\n- 종류: 약속\(상대·제3자\)\n- 내용: 상대 측 자료 송부 약속\n- 기한: 2026-10-10/);
});

test('the promises come from the radar module and are not stored or counted', async () => {
  const inbox = await read('inbox-todos.js'), count = await read('inbox-count.js');
  assert.match(inbox, /radarPromises/);
  assert.doesNotMatch(inbox, /fetch\(|rt\.api\([^)]*promise/i);
  assert.doesNotMatch(count, /radarPromises|ledgerRequestText|상대 약속/);
  // The number on the screen stays the open candidates only.
  assert.match(inbox, /const count = \(\) => state === 'ok' \? openRows\(\)\.length : null;/);
});
