import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
// UI-눌림느낌(2026-10-27 명진 요청): 누르는 느낌은 공통 규칙 한 곳(ui-standard.css)에서 정의하고, 완료 표시('✓ 복사됨')는 press-feedback.js 하나가 맡는다.
// 여기서는 규칙 문장(움직임 줄이기 포함), 눌림 대상 판정, 완료 표시의 켜짐·복귀, 복사 버튼이 그 부품을 쓰는지를 확인한다.
const css = file => readFileSync(`app/${file}`, 'utf8');
const mod = await import('../app/press-feedback.js');
const {pressTarget, isWide, flashDone, COPIED, DONE_MS, NATIVE_PRESS} = mod;

test('눌림 규칙은 ui-standard.css 한 곳: 작아지기(scale)와 바탕 진해짐, 못 쓰는 버튼 제외', () => {
  const ui = css('ui-standard.css');
  const at = ui.indexOf('UI-눌림느낌');
  assert.ok(at > 0, '규칙 머리말');
  const rule = ui.slice(at);
  assert.match(rule, /\[data-pressing\]:not\(\[data-press="off"\]\)\{[^}]*scale:var\(--ds-press-scale\)/);
  assert.match(rule, /box-shadow:inset 0 0 0 999px var\(--ds-press-tint\) !important/);
  assert.match(rule, /:is\(button,summary,a\[href\][\s\S]*?\):active:not\(:disabled,\[aria-disabled="true"\]/);
  assert.match(rule, /\[data-pressing\]\[data-press-wide\]\{ scale:var\(--ds-press-scale-wide\); \}/);
});

test('움직임 줄이기: 작아지는 움직임 없이 색만 바뀐다', () => {
  const rule = css('ui-standard.css').split('UI-눌림느낌')[1];
  const reduced = rule.slice(rule.indexOf('@media (prefers-reduced-motion:reduce)'));
  assert.match(reduced, /:active:not\([^{]*\[data-pressing\]\s*\{\s*scale:none;\s*transition:none;\s*\}/);
  assert.doesNotMatch(reduced, /box-shadow:\s*none/, '색(안쪽 그림자)은 그대로 남긴다');
});

test('값은 토큰: 눌림 크기·진해짐·완료 글자색, 어두운 화면은 밝아지는 쪽', () => {
  const tokens = css('theme-tokens.css');
  assert.match(tokens, /--ds-press-scale:\.97;--ds-press-scale-wide:\.985;--ds-press-tint:rgb\(0 0 0 \/ 9%\)/);
  assert.match(tokens, /--ds-done-ink:var\(--kptu-success\)/);
  const dark = tokens.slice(tokens.indexOf('prefers-color-scheme:dark'));
  assert.match(dark, /--ds-press-tint:rgb\(255 255 255 \/ 13%\)/);
  assert.match(css('ui-standard.css'), /\[data-done\]\{ color:var\(--ds-done-ink\) !important; \}/);
});

test('화면별 :active 크기 규칙을 따로 만들지 않는다(공통 한 곳)', () => {
  const offenders = [];
  for (const file of readdirSync('app').filter(f => f.endsWith('.css'))) {
    for (const [i, line] of css(file).split('\n').entries()) {
      if (/:active/.test(line) && /(transform\s*:\s*scale|[^-]scale\s*:)/.test(line) && !(file === 'ui-standard.css' && /ds-press-scale/.test(line))) offenders.push(`${file}:${i + 1}`);
    }
  }
  assert.deepEqual(offenders, []);
});

// 가짜 요소: closest/matches/parentElement만 흉내 낸다.
const node = (name, {cursor = 'default', parent = null, native = false, off = false, disabled = false} = {}) => {
  const el = {nodeType: 1, name, cursor, parentElement: parent, native, off, disabled};
  el.closest = sel => {
    for (let n = el; n; n = n.parentElement) {
      if (sel === '[data-press="off"]' && n.off) return n;
      if (sel === NATIVE_PRESS && n.native) return n;
    }
    return null;
  };
  el.matches = sel => sel.includes(':disabled') && el.disabled;
  return el;
};
const cursorOf = el => el.cursor;
globalThis.document = {body: node('body')};

test('눌림 대상: 진짜 버튼이 먼저, 버튼이 아닌 줄·카드는 손가락 모양 사슬의 맨 위', () => {
  const card = node('card', {cursor: 'pointer', parent: document.body});
  const title = node('title', {cursor: 'pointer', parent: card});
  const inner = node('b', {cursor: 'pointer', parent: title});
  assert.equal(pressTarget(inner, {cursorOf}).name, 'card');
  const button = node('more', {cursor: 'default', parent: card, native: true});
  assert.equal(pressTarget(button, {cursorOf}).name, 'more', '카드 안 버튼을 누르면 버튼이 눌린다');
  const plain = node('plain', {cursor: 'default', parent: document.body});
  assert.equal(pressTarget(plain, {cursorOf}), null);
});

test('눌림 대상: 못 쓰는 버튼과 data-press="off"는 제외', () => {
  const off = node('handle', {parent: document.body, off: true, cursor: 'pointer'});
  assert.equal(pressTarget(node('x', {parent: off, cursor: 'pointer'}), {cursorOf}), null);
  assert.equal(pressTarget(node('b', {parent: document.body, native: true, disabled: true}), {cursorOf}), null);
});

test('큰 줄·카드는 덜 작아진다(폭 240 이상 또는 높이 60 이상)', () => {
  assert.equal(isWide({width: 80, height: 32}), false);
  assert.equal(isWide({width: 240, height: 32}), true);
  assert.equal(isWide({width: 120, height: 60}), true);
});

// 가짜 버튼과 시계로 완료 표시를 확인한다.
const fakeButton = (text, attrs = {}) => {
  const a = new Map(Object.entries(attrs));
  let kids = text ? [{text}] : [{icon: true}];
  return {
    isConnected: true, style: {minWidth: ''},
    get childNodes() { return kids; }, get textContent() { return kids.map(k => k.text || '').join(''); },
    replaceChildren(...n) { kids = n; },
    setAttribute(k, v) { a.set(k, String(v)); }, removeAttribute(k) { a.delete(k); }, getAttribute(k) { return a.has(k) ? a.get(k) : null; }, has: k => a.has(k),
    getBoundingClientRect: () => ({width: 52}),
  };
};
globalThis.document.createTextNode = text => ({text});
const clock = () => { const jobs = []; return {setTimer: (fn, ms) => { jobs.push({fn, ms}); return jobs.length; }, clearTimer: id => { jobs[id - 1].fn = null; }, jobs}; };

test('글자 버튼: 1.5초 동안 ✓ 복사됨(초록 표시)으로 바뀌었다 처음 글자로 돌아온다', () => {
  assert.equal(COPIED, '✓ 복사됨'); assert.equal(DONE_MS, 1500);
  const b = fakeButton('복사'), c = clock();
  assert.equal(flashDone(b, {setTimer: c.setTimer, clearTimer: c.clearTimer}), true);
  assert.equal(b.textContent, '✓ 복사됨'); assert.ok(b.has('data-done')); assert.equal(b.style.minWidth, '52px');
  assert.equal(c.jobs[0].ms, 1500);
  c.jobs[0].fn();
  assert.equal(b.textContent, '복사'); assert.ok(!b.has('data-done')); assert.equal(b.style.minWidth, '');
});

test('아이콘 버튼: ✓만 보이고 읽기 프로그램에는 복사됨, 끝나면 아이콘과 이름이 돌아온다', () => {
  const b = fakeButton('', {'aria-label': '요약 복사', title: '요약 복사'}), c = clock();
  flashDone(b, {setTimer: c.setTimer, clearTimer: c.clearTimer});
  assert.equal(b.textContent, '✓'); assert.equal(b.getAttribute('aria-label'), '복사됨');
  c.jobs[0].fn();
  assert.equal(b.getAttribute('aria-label'), '요약 복사'); assert.equal(b.getAttribute('title'), '요약 복사');
  assert.ok(b.childNodes[0].icon, '처음 아이콘으로 복귀');
});

test('연달아 두 번 눌러도 처음 모습이 유지되고 시간만 새로 센다 / 사라진 버튼은 무시', () => {
  const b = fakeButton('복사'), c = clock();
  flashDone(b, {setTimer: c.setTimer, clearTimer: c.clearTimer}); flashDone(b, {setTimer: c.setTimer, clearTimer: c.clearTimer});
  assert.equal(c.jobs[0].fn, null, '첫 타이머는 취소');
  c.jobs[1].fn();
  assert.equal(b.textContent, '복사');
  const gone = fakeButton('복사'); gone.isConnected = false;
  assert.equal(flashDone(gone), false);
  assert.equal(flashDone(() => null), false);
});

test('복사 버튼을 가진 화면은 모두 이 부품을 쓴다(알림만 있는 복사 없음)', () => {
  const users = ['summary-copy.js', 'basket.js', 'basket-notes.js', 'share-pages.js', 'journal-hwpx.js', 'todo-radar.js', 'inbox-todos.js', 'ed-window.js'];
  for (const file of users) assert.match(css(file), /import \{ ?flashDone ?\} from '\.\/press-feedback\.js'/, file);
  assert.match(css('loader-v2.js'), /import\('\.\/press-feedback\.js'\)/);
  assert.match(css('summary-copy.js'), /if \(ok && button\) flashDone\(button\)/);
});
