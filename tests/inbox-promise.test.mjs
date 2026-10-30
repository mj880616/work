import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// INBOX-상대약속: 정리함 [챙길 것] shows the counterpart promises the radar already returns. No new judgement, nothing stored, never counted.
const radar = await import('../app/todo-radar-data.js');
const read = name => readFile(new URL(`../app/${name}`, import.meta.url), 'utf8');
const promise = {summary: '상대 측 자료 송부 약속', due: '2026-10-10', evidence: '보내기로 함', source_kind: 'meeting', source_id: 'c0000000-0000-4000-8000-000000000050', source_day: '2026-10-05'};

// HOME-업무일지홈: 옛 홈·업무일지 챙길 것 상자는 없앴다. 쓰기요청 문구 복사는 정리함 하나다.
test('the inbox copies the 쓰기요청 text (one place)', async () => {
  const inbox = await read('inbox-todos.js'), card = await read('todo-radar.js');
  assert.match(inbox, /ledgerRequestText\(p\)/);
  assert.doesNotMatch(card, /ledgerRequestText/);
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
