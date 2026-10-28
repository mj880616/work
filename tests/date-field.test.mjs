// UI-날짜칸(2026-10-28 화면정리 A4): 사이트 공용 날짜 칸 표기와 붙이는 자리.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dateLabel, WEEKDAYS} from '../app/date-field.js';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('날짜 글자는 "10. 6. (화)", 올해가 아니면 연도를 붙인다', () => {
  assert.equal(dateLabel('2026-10-06', {today: '2026-10-28'}), '10. 6. (화)');
  assert.equal(dateLabel('2026-10-28', {today: '2026-10-28'}), '10. 28. (수)');
  assert.equal(dateLabel('2025-10-06', {today: '2026-10-28'}), '2025. 10. 6. (월)');
  assert.equal(dateLabel('2026-10-06', {today: '2026-10-28', year: true}), '2026. 10. 6. (화)');
  assert.equal(dateLabel(''), '');
  assert.equal(dateLabel('10/06/2026'), '');
  assert.equal(dateLabel('2026-02-30', {today: '2026-01-01'}), '');
  assert.equal(WEEKDAYS.length, 7);
});

test('공용 날짜 칸은 모든 화면 전에 한 번 불려 오고, 숨은 달력·칩·일시 칸은 건드리지 않는다', () => {
  assert.match(read('app/loader-v2.js'), /import\('\.\/date-field\.js'\)/);
  const src = read('app/date-field.js');
  assert.match(src, /getAttribute\('tabindex'\) === '-1'/);
  assert.match(src, /\.dt-date,\.due-chip,\.date-field/);
  assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB/);
  const css = read('app/ui-standard.css');
  assert.match(css, /\.date-field>input\[type="date"\]\{[^}]*opacity:0/);
  assert.match(css, /:where\(select:not\(\[multiple\],\[size\]\)\)\{[^}]*appearance:none/);
  assert.match(css, /:where\(button:not\(\[class\]\)\)\{/);
});
