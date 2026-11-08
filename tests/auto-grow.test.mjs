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

test('주간 정리 조직보고 줄 고치기 칸 = 늘어나는 공용 칸', () => {
  const src = read('app/weekly-org-lines.js');
  assert.match(src, /<textarea rows="1" class="wl-f-body" data-wl-field="body" data-autogrow data-enter-field="single"/);
  assert.doesNotMatch(src, /<input type="text" class="wl-f-body"/);
  assert.match(src, /fitAll\(ctl\.host\)/);
  assert.match(read('app/base-ui.css'), /textarea\[data-autogrow\]\{box-sizing:border-box;resize:none\}/);
});
