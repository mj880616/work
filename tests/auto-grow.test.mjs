import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {growHeight, oneLine, fitAll, SCREEN_SHARE} from '../app/auto-grow.js';

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('늘어나는 칸: 처음 한 줄, 글만큼 늘고 상한에서 멈춘다', () => {
  const base = {min: 26, line: 18, edge: 8, borders: 2};
  assert.deepEqual(growHeight({...base, scroll: 24}), {height: 26, scroll: false});
  assert.deepEqual(growHeight({...base, scroll: 60}), {height: 62, scroll: false});
  assert.deepEqual(growHeight({...base, scroll: 400, maxLines: 5}), {height: 98, scroll: true});
  assert.equal(growHeight({...base, scroll: 2000, screen: 700}).height, Math.round(700 * SCREEN_SHARE));
  assert.equal(growHeight({...base, scroll: 2000, screen: 700}).scroll, true);
});

test('홈 빠른 입력 셈과 같다(5줄 상한)', () => {
  // 옛 size(): max(min, min(line*5+edge, scrollHeight+borders))
  for (const scroll of [10, 50, 90, 200]) {
    const old = Math.max(46, Math.min(21 * 5 + 22, scroll + 2));
    assert.equal(growHeight({min: 46, line: 21, edge: 22, borders: 2, scroll, maxLines: 5}).height, old);
  }
  const quick = read('app/home-quick.js');
  assert.match(quick, /import \{fitHeight\} from '\.\/auto-grow\.js'/);
  assert.match(quick, /fitHeight\(input,\{maxLines:5,overflow:false\}\)/);
});

test('한 줄 칸: 끝 줄바꿈은 지우고 가운데 줄바꿈은 빈칸', () => {
  assert.equal(oneLine('가나\n'), '가나');
  assert.equal(oneLine('가\r\n나\n다'), '가 나 다');
  assert.equal(oneLine(null), '');
});

test('fitAll: 자리가 없어도 멈추지 않는다', () => {
  assert.doesNotThrow(() => fitAll(null));
  assert.doesNotThrow(() => fitAll({querySelectorAll: () => []}));
});

test('주간 정리 조직보고 줄: 옛 주별 표 고치기 칸은 지웠다(O-6, 옛 주는 읽기 전용) — 줄 입력 칸은 공용 늘어나기 칸 규칙', () => {
  assert.doesNotMatch(read('app/weekly-org-lines.js'), /<textarea|<input/);
  assert.match(read('app/base-ui.css'), /textarea\[data-autogrow\]\{box-sizing:border-box;resize:none\}/);
});

test('주간 정리 긴 글 칸 전부 = 공용 칸(화면마다 따로 늘리는 셈 없음)', () => {
  for (const f of ['weekly-learn-panel.js', 'weekly-flow-cells.js', 'weekly-hand-lines.js', 'weekly-hq-schedule.js', 'journal-weekly.js']) {
    assert.match(read(`app/${f}`), /lineField\(doc/, f);
  }
  // RECORD-한줄 B-5: 옛 주 2. 2)(weekly-detail-lines.js)는 읽기 전용 — 입력 칸이 없다.
  assert.doesNotMatch(read('app/weekly-detail-lines.js'), /lineField|<input|<textarea|createElement\('(input|textarea)'\)/);
  for (const f of ['weekly-discuss-table.js']) {
    const src = read(`app/${f}`);
    assert.match(src, /fitAll\((host|slot)\)/, f);
    assert.doesNotMatch(src, /function fitText|function fitTextarea|scrollHeight/, f);
  }
  // 줄바꿈이 필요 없는 칸은 Enter = 저장 그대로(textarea 도 받는다)
  assert.match(read('app/weekly-hand-lines.js'), /t\.type === 'text' \|\| t\.localName === 'textarea'/);
  assert.match(read('app/journal-hwpx.js'), /e\.target\.matches\?\.\('input, textarea'\)\) \{ e\.preventDefault\(\); void saveSchedEdit\(\)/);
  assert.match(read('app/weekly-flow-cells.js'), /closest\?\.\('\[data-flow-input\]'\)/);
});

test('나머지 긴 글 한 줄 칸 = 공용 칸(PR 2)', () => {
  const cases = [
    ['app/inbox-todos.js', /<textarea rows="1" class="inbox-todo-edit-title" data-inbox-todo-edit-title data-autogrow data-enter-field="single"/],
    ['app/basket-manual-link.js', /<textarea rows="1" data-manual-task-title data-autogrow data-enter-field="single"/],
    ['app/call-feed.js', /<textarea rows="1" class="\$\{cls\}" data-cf-title-input data-autogrow/],
    ['app/call-feed.js', /<textarea rows="1" class="feed-edit-input" data-cf-sum-line="\$\{i\}" data-autogrow/],
    ['app/telegram-feed.js', /<textarea rows="1" class="feed-edit-input" data-tg-se-head data-autogrow data-enter-field="single"/],
    ['app/basket-notes.js', /<textarea rows="1" data-note-title-input data-autogrow data-enter-field="single"/],
    ['app/project-system-v3.js', /<textarea rows="1" maxlength="500" aria-label="기록 요약" data-autogrow data-enter-field="single">/],
    ['app/google-tasks.js', /<textarea id="gtEditTitle" rows="1" data-autogrow data-enter-field="single">/],
    ['app/report-oneline.js', /data-ol-text data-autogrow/],
  ];
  for (const [f, re] of cases) assert.match(read(f), re, f);
  // form 안 한 줄 칸은 공용 Enter 저장(enter-save.js)이 넣기 버튼을 누른다
  assert.match(read('app/inbox-todos.js'), /<form class="inbox-todo-edit" data-inbox-todo-edit="\$\{id\}" data-enter-save>/);
});

test('공용 칸을 쓰는 파일은 모두 auto-grow.js 를 불러온다', async () => {
  const {readdirSync} = await import('node:fs');
  for (const f of readdirSync(new URL('../app/', import.meta.url))) {
    if (!f.endsWith('.js') || f === 'auto-grow.js') continue;
    const src = read(`app/${f}`);
    if (/\b(fitHeight|fitAll|lineField)\(/.test(src)) assert.match(src, /from '\.\/auto-grow\.js'/, f);
  }
});
