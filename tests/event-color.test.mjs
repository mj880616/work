// S67-65 CAL-꽉찬색(E1): 일정 칩 색 표 하나 + 글자 대비 자동 판정.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EVENT_COLOR_IDS, CALENDAR_COLOR_TONES, COLOR_TONES, toneColor, eventInk, eventChip, contrastRatio, INK_LIGHT, INK_DARK, DEFAULT_GOOGLE} from '../app/event-color.mjs';
import {eventColor, eventSourceColor} from '../app/home-read-model.js';

test('구글 일정 색 11가지 모두 표에 있고, 옛 값·새 값이 같은 톤으로 바뀐다', () => {
  assert.deepEqual(Object.keys(EVENT_COLOR_IDS).map(Number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  for (const row of Object.values(EVENT_COLOR_IDS)) for (const hex of row.google) assert.equal(toneColor(hex), row.tone, hex);
  // 11가지 톤은 서로 다르다(구분이 잘 되게).
  assert.equal(new Set(Object.values(EVENT_COLOR_IDS).map(r => r.tone)).size, 11);
});

test('표의 모든 색(일정 11가지·캘린더 기본색)은 글자 대비 4.5:1 이상', () => {
  for (const [google, tone] of Object.entries(COLOR_TONES)) {
    const ink = eventInk(tone);
    assert.ok(contrastRatio(ink, tone) >= 4.5, `${google} → ${tone} / ${ink}: ${contrastRatio(ink, tone).toFixed(2)}`);
  }
  assert.ok(CALENDAR_COLOR_TONES[DEFAULT_GOOGLE]);
});

test('대부분 흰 글자, 노랑처럼 밝은 바탕만 진한 글자', () => {
  assert.equal(eventChip('#dc2127').ink, INK_LIGHT);
  assert.equal(eventChip('#5484ed').ink, INK_LIGHT);
  assert.equal(eventChip('#e1e1e1').ink, INK_LIGHT);
  assert.equal(eventChip('#fbd75b').ink, INK_DARK);
  assert.equal(eventChip('#f6bf26').background, '#e0b54a');
  assert.equal(INK_DARK, '#2a2410');
});

test('표에 없는 색도 같은 규칙: 톤을 낮추고 대비 4.5:1 이상', () => {
  for (const hex of ['#123456', '#ff00ff', '#00ffff', '#ffff00', '#e8e000', '#000000', '#ffffff', '#7cb342', '#abc', 'ABCDEF']) {
    const chip = eventChip(hex);
    assert.match(chip.background, /^#[0-9a-f]{6}$/);
    assert.ok(contrastRatio(chip.ink, chip.background) >= 4.5, `${hex} → ${chip.background}`);
  }
  // 이상한 값·빈 값은 기본 파랑의 톤.
  assert.equal(toneColor('red;background:url(x)'), toneColor(DEFAULT_GOOGLE));
  assert.equal(eventChip('').background, toneColor(DEFAULT_GOOGLE));
  assert.equal(toneColor('#DC2127'), EVENT_COLOR_IDS[11].tone);
});

test('eventColor는 고르는 순서를 지키고 칠하는 색은 톤 낮춘 값, 색이 없으면 빈 값', () => {
  const status = {colors: {mine: '#f6bf26'}, calendars: [{id: 'mine', backgroundColor: '#d50000'}, {id: 'cal', backgroundColor: '#16a765'}]};
  assert.equal(eventSourceColor({color: '#8e24aa', calendarId: 'mine'}, status), '#8e24aa');
  assert.equal(eventColor({color: '#8e24aa', calendarId: 'mine'}, status), EVENT_COLOR_IDS[3].tone);
  assert.equal(eventColor({calendarId: 'mine'}, status), '#e0b54a');
  assert.equal(eventColor({calendarId: 'cal'}, status), CALENDAR_COLOR_TONES['#16a765']);
  assert.equal(eventColor({calendarId: 'none'}, status), '');
});
