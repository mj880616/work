// FILES-폴드나무목록 ⑥(S51-18): 펼친 폴드 판정은 공용 한 곳(app/screen-width.mjs). 갤럭시 Z 폴드 펼침의 실제 CSS 폭(약 673~884px)이
// 칸 나누기(나무 | 목록)로, 접은 폴드·보통 폰(344~480px)은 폰 한 칸으로 잡히는지, 그리고 그 판정을 쓰는 화면이 옛 760px 판정을 다시 쓰지 않는지 본다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SPLIT_MIN_WIDTH, SPLIT_QUERY, NARROW_QUERY, splitsAt} from '../app/screen-width.mjs';
import {COL_PC_MIN_WIDTH} from '../app/col-widths-model.mjs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('펼친 폴드 폭은 칸 나누기, 접은 폴드·폰은 한 칸', () => {
  assert.equal(SPLIT_MIN_WIDTH, 600);
  assert.equal(SPLIT_QUERY, '(min-width:600px)');
  assert.equal(NARROW_QUERY, '(max-width:599px)');
  for (const w of [673, 690, 700, 707, 768, 800, 884, 1104, 1280]) assert.equal(splitsAt(w), true, `${w}px는 폴드·PC`);
  for (const w of [344, 360, 390, 412, 430, 480, 599]) assert.equal(splitsAt(w), false, `${w}px는 폰`);
});

test('파일·노트·할 일은 공용 판정을 불러 쓴다(따로 760/761 판정 없음)', () => {
  const files = read('app/files.js');
  assert.match(files, /import \{NARROW_QUERY, SPLIT_QUERY\} from '\.\/screen-width\.mjs'/);
  assert.match(files, /const PHONE = window\.matchMedia\(NARROW_QUERY\)/);
  assert.match(files, /query: SPLIT_QUERY, active:/);
  const notes = read('app/basket-notes.js');
  assert.match(notes, /const wideList = window\.matchMedia\(SPLIT_QUERY\)/);
  assert.match(notes, /query:SPLIT_QUERY, active:/);
  const tasks = read('app/google-tasks.js');
  assert.match(tasks, /import \{ SPLIT_QUERY \} from '\.\/screen-width\.mjs'/);
  assert.doesNotMatch(tasks, /const SPLIT_QUERY=/);
});

test('[파일] 칸 모양 CSS는 같은 600px 경계(창 자리 규칙만 앱 틀 761px)', () => {
  const css = read('app/files.css');
  assert.doesNotMatch(css, /max-width:760px/);
  const wideRules = [...css.matchAll(/@media \(min-width:761px\) \{ \.fx-(\w+)/g)].map(m => m[1]).sort();
  assert.deepEqual(wideRules, ['askbox', 'dest', 'jobs'], '761px은 하단바 위 창 자리(앱 틀)만');
  assert.match(css, /@media \(min-width:600px\) \{\n  \.fx-cols/);
});

// FOLD-넓은화면 ④(S57-16): 홈 [하루] 카드 두 단은 공용 600px 경계(폴드 펼침)에서 시작해 PC(1200px) 바로 앞에서 끝난다. 폰·PC에서는 새 묶음 두 개가 없는 것과 같다.
test('홈 하루 카드 두 단: 공용 600px~PC 1200px 앞, 묶음 두 개는 그 밖에서 display:contents', () => {
  const css = read('app/journal.css'), js = read('app/journal.js');
  const range = `@media \\(min-width:${SPLIT_MIN_WIDTH}px\\) and \\(max-width:${COL_PC_MIN_WIDTH - 1}px\\)`;
  assert.match(css, new RegExp(`${range}\\{\\n  #appView #homeView \\.journal-day\\{ display:grid; grid-template-columns:repeat\\(2,minmax\\(0,1fr\\)\\);`));
  assert.match(css, /\.journal-schedule-body,\n#appView #homeView \.journal-day-right\{ display:contents; \}/);
  assert.match(js, /<div class="journal-day-right" data-journal-day-right>/);
  assert.match(js, /body\.className = 'journal-schedule-body'/);
  // 날짜 칸: 요일 글자는 400px 미만 접은 폰에서만 숨긴다(옛 전체 숨김 규칙 없음).
  assert.doesNotMatch(css, /\.journal-head \.journal-weekday\{ display:none; \}\n/);
  assert.match(css, /@media\(max-width:399px\)\{ #appView #homeView \.journal-head \.journal-weekday\{ display:none; \} \}/);
});
