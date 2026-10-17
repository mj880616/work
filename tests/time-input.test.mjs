import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTime,completeTime,shiftedEnd,DEFAULT_EVENT_SPAN} from '../app/time-input.js';

test('시간 4자리 입력 정리', () => {
  for (const [raw, want] of [['0900','09:00'],['930','09:30'],['1405','14:05'],['9','09:00'],['14','14:00'],['0000','00:00'],['2359','23:59'],['9:05','09:05'],['09:30','09:30'],['9.30','09:30'],[' 1405 ','14:05'],['','']])
    assert.equal(normalizeTime(raw), want, raw);
  for (const raw of ['2400','1260','093','24','99','12345','ab','9:5','25:00','-100'])
    assert.equal(normalizeTime(raw), null, raw);
});

test('네 자리·H:MM이면 바로 정리, 짧은 숫자는 칸을 떠날 때 정리', () => {
  for (const raw of ['0900','1405','9:30','09:30']) assert.equal(completeTime(raw), true, raw);
  for (const raw of ['9','14','930','']) assert.equal(completeTime(raw), false, raw);
});

for (const tz of ['Asia/Seoul','Europe/Rome','America/Los_Angeles']) test(`종료 자동 계산(한국 시각) ${tz}`, () => {
  const previous = process.env.TZ; process.env.TZ = tz;
  try {
    assert.equal(DEFAULT_EVENT_SPAN, 2 * 3600000);
    assert.deepEqual(shiftedEnd('2026-10-17','09:00'), {date:'2026-10-17', time:'11:00'});
    assert.deepEqual(shiftedEnd('2026-10-17','23:00'), {date:'2026-10-18', time:'01:00'});
    assert.deepEqual(shiftedEnd('2026-12-31','22:30'), {date:'2027-01-01', time:'00:30'});
    assert.deepEqual(shiftedEnd('2026-10-17','10:15',45 * 60000), {date:'2026-10-17', time:'11:00'});
    assert.deepEqual(shiftedEnd('2026-10-17','23:30',3 * 3600000), {date:'2026-10-18', time:'02:30'});
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
