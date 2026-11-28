// DESIGN-검증하네스 ②: scripts/ci/css-token-check.mjs(글자 크기·버튼 높이 px 기준선 검사) 시험.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  findings, isButtonSelector, isButtonRule, compare, lowered, countAll, hasPx, baselinePath, targetFiles,
} from '../scripts/ci/css-token-check.mjs';

const kinds = css => findings(css).map(f => f.kind);

test('font-size·font 줄임의 px를 센다, var()·0px·주석은 세지 않는다', () => {
  assert.deepEqual(kinds('.a{font-size:13px}'), ['fontSize']);
  assert.deepEqual(kinds('.a{font:600 12px/1.4 sans-serif}'), ['fontSize']);
  assert.deepEqual(kinds('.a{font-size:var(--ds-text-row)}'), []);
  assert.deepEqual(kinds('.a{font-size:var(--ds-text-row,13px)}'), [], 'var 대신 값은 기준값 사용');
  assert.deepEqual(kinds('.a{font-size:calc(var(--ds-text-row) + 1px)}'), ['fontSize'], 'calc로 섞은 px는 센다');
  assert.deepEqual(kinds('.a{font-size:0px}'), []);
  assert.deepEqual(kinds('.a{font-size:1.2em;line-height:20px}'), []);
  assert.deepEqual(kinds('/* .a{font-size:13px} */.b{color:red}'), []);
  assert.deepEqual(kinds('.a::after{content:"font-size:13px"}'), []);
});

test('@media 안도 센다, @keyframes 안의 height는 버튼으로 보지 않는다', () => {
  assert.deepEqual(kinds('@media (max-width:760px){.a{font-size:11px}.b-btn{height:30px}}'), ['fontSize', 'buttonHeight']);
  assert.deepEqual(kinds('@keyframes x{from{height:10px}to{height:20px}}'), []);
});

test('버튼 선택자 판별: 맨 끝 대상 조각만 본다', () => {
  for (const s of ['button', '.bar button', 'button:hover', '.icon-btn', '.basket-icon-button', '#newEventBtn',
    '.row > .x-btn::before', 'input[type=submit]', 'input[type="button"]', '[role=button]', '.a :is(.b, .c-btn)',
    '.ds-seg-btn[aria-pressed="true"]']) {
    assert.equal(isButtonSelector(s), true, s);
  }
  for (const s of ['.btn-row', '.wl-btns', '.button-bar', '.icon-btn svg', 'button + .label', '.buttons',
    'input[type=text]', '.row:not(.x-btn)', '.subtitle']) {
    assert.equal(isButtonSelector(s), false, s);
  }
  assert.equal(isButtonRule('.a, .b-btn'), true, '목록 중 하나라도 버튼이면 버튼 규칙');
});

test('버튼 규칙 안의 height·min-height px만 센다', () => {
  assert.deepEqual(kinds('.x-btn{height:32px;min-height:44px;max-height:60px;width:20px}'), ['buttonHeight', 'buttonHeight']);
  assert.deepEqual(kinds('.panel{height:32px}'), []);
  assert.deepEqual(kinds('.x-btn{height:var(--ds-compact-height)}'), []);
  assert.deepEqual(kinds('.x-btn{height:calc(var(--ds-chip-row-height) + 4px)}'), ['buttonHeight']);
});

test('기준선 비교: 늘면 grown, 줄면 shrunk, 새 파일은 기준선 0', () => {
  const base = { 'app/a.css': { fontSize: 3, buttonHeight: 1 } };
  assert.deepEqual(compare({ 'app/a.css': { fontSize: 3, buttonHeight: 1 } }, base), { grown: [], shrunk: [] });
  const up = compare({ 'app/a.css': { fontSize: 4, buttonHeight: 1 }, 'app/new.css': { fontSize: 1, buttonHeight: 0 } }, base);
  assert.deepEqual(up.grown.map(g => `${g.file}:${g.kind}:${g.base}->${g.now}`),
    ['app/a.css:fontSize:3->4', 'app/new.css:fontSize:0->1']);
  const down = compare({ 'app/a.css': { fontSize: 2, buttonHeight: 0 } }, base);
  assert.equal(down.grown.length, 0);
  assert.equal(down.shrunk.length, 2);
});

test('기준선 쓰기는 줄이기만 한다', () => {
  const base = { 'app/a.css': { fontSize: 3, buttonHeight: 2 }, 'app/b.css': { fontSize: 1, buttonHeight: 0 } };
  assert.deepEqual(lowered({ 'app/a.css': { fontSize: 5, buttonHeight: 1 } }, base),
    { 'app/a.css': { fontSize: 3, buttonHeight: 1 } });
});

test('hasPx는 소수·여러 값도 본다', () => {
  assert.equal(hasPx('10.5px'), true);
  assert.equal(hasPx('clamp(var(--a), 2vw, 14px)'), true);
  assert.equal(hasPx('1.2rem'), false);
});

test('저장소의 현재 app/*.css 개수가 기준선과 같다', () => {
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')).files;
  const { grown, shrunk } = compare(countAll(), baseline);
  assert.deepEqual(grown, [], '기준선보다 늘어난 파일');
  assert.deepEqual(shrunk, [], '기준선을 같이 줄이지 않은 파일');
  assert.equal(targetFiles().includes('theme-tokens.css'), false, '기준값 파일은 검사에서 뺀다');
});
