import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// UI-누름움직임(2026-11-06 명진 요청 22:44): 누를 때 '명확하게 눌렸다'는 움직임과 할 일 체크 움직임.
// 눌림은 공용 규칙 한 곳(ui-standard.css UI-눌림느낌 + 이 절)이고, 체크 움직임은 check-motion.js + [data-check-pop] 규칙 한 곳이다.
const read = file => readFileSync(file, 'utf8');
const ui = read('app/ui-standard.css');
const {CHECK_MS, noteChecked, noteUnchecked, checkElapsed, checkPopAttr, checkPopStyle, applyCheckPop} = await import('../app/check-motion.js');

test('눌림은 버튼 부품 전체에 한 규칙: 버튼류(:active)·눌리는 줄([data-pressing]) 모두 --ds-press-scale(.94)·--ds-press-tint', () => {
  const at = ui.indexOf('UI-눌림느낌');
  const rule = ui.slice(at, ui.indexOf('UI-누름움직임', at));
  for (const kind of ['button', 'summary', 'a\\[href\\]', '\\[role="button"\\]', '\\[role="tab"\\]', '\\[role="menuitem"\\]', '\\[role="option"\\]'])
    assert.match(rule, new RegExp(`:is\\([^)]*${kind}`), kind);
  assert.match(rule, /scale:var\(--ds-press-scale\)/);
  assert.match(read('app/theme-tokens.css'), /--ds-press-scale:\.94;/);
  assert.match(read('app/theme-tokens.css'), /--ds-check-ms:240ms;/);
});

test('폰은 손가락을 대는 순간부터: pointerdown에 켜고, 톡 쳐도 끝까지 작아지게 0.04초', () => {
  const src = read('app/press-feedback.js');
  assert.match(src, /addEventListener\('pointerdown', onDown/);
  assert.match(read('app/theme-tokens.css'), /--ds-press-ms:40ms;/);
  assert.match(ui, /transition:scale var\(--ds-press-ms\) ease-out/);
});

test('체크 움직임: 끝낸 지 0.24초 안의 줄만 지난 시간만큼 앞당겨 한 번, 그 뒤·되돌림은 없음', () => {
  assert.equal(CHECK_MS, 240);
  noteChecked('a', 1000);
  assert.equal(checkElapsed('a', 1100), 100);
  assert.equal(checkPopAttr('a', 1100), ' data-check-pop style="--check-t:-100ms"');
  assert.equal(checkPopStyle('a', 1100), '--check-t:-100ms;');
  assert.equal(checkElapsed('a', 1240), null);
  assert.equal(checkPopAttr('a', 1100), '', '한 번 지나면 잊는다');
  noteChecked('b', 0); noteUnchecked('b');
  assert.equal(checkPopAttr('b', 10), '');
  assert.equal(checkPopAttr('', 10), '');
  const attrs = new Map(), props = new Map();
  const el = {offsetWidth: 1, setAttribute: (k, v) => attrs.set(k, v), removeAttribute: k => attrs.delete(k), style: {setProperty: (k, v) => props.set(k, v)}};
  noteChecked('c', 0);
  assert.equal(applyCheckPop(el, 'c', 50), true);
  assert.ok(attrs.has('data-check-pop')); assert.equal(props.get('--check-t'), '-50ms');
  assert.equal(applyCheckPop(null, 'c', 60), false);
});

test('체크 움직임 모양은 ui-standard.css 한 곳: 물결·튀어나옴 → 채움·체크 그리기 → 줄 긋기, 움직임 줄이기는 멈춤', () => {
  const at = ui.indexOf('UI-누름움직임');
  assert.ok(at > 0);
  const rule = ui.slice(at, ui.indexOf('[복사]처럼', at));
  for (const name of ['ds-check-pop', 'ds-check-fill', 'ds-check-draw', 'ds-check-strike']) assert.match(rule, new RegExp(`@keyframes ${name}`), name);
  assert.match(rule, /@keyframes ds-check-pop\{[^}]*scale:\.82[^}]*box-shadow/);
  for (const el of ['journal-check', 'gt-check', 'cmv-task-mark']) assert.match(rule, new RegExp(`\\[data-check-pop\\][^{]*\\.${el}`), el);
  assert.match(rule, /@media \(prefers-reduced-motion:reduce\)\{[\s\S]*animation:none/);
  // 할 일 화면 목록의 자체 움직임도 0.25초 안(채움 120 · 체크·줄 90+150)이고 같은 물결을 쓴다.
  const gt = read('app/google-tasks.css');
  assert.match(gt, /gt-anim-on \.gt-check\{animation:gt-fill 120ms[^}]*ds-check-pop var\(--ds-check-ms\)/);
  assert.match(gt, /gt-anim-on \.gt-check::after\{animation:gt-draw 150ms ease-out calc\(var\(--gt-t,0ms\) \+ 90ms\)/);
});

test('할 일 체크가 있는 모든 목록이 같은 부품을 쓴다(따로 만든 체크 움직임 없음)', () => {
  assert.match(read('app/google-tasks.js'), /if\(p\.want\)noteChecked\(task\.id\);else noteUnchecked\(task\.id\);/, '저장 길 한 곳에서 기억');
  assert.match(read('app/task-inline.js'), /if \(done\) noteChecked\(id\); else noteUnchecked\(id\);[^\n]*\n\s*start\(id\); apply\?\.\(id, done, task\);/, '바로 다시 그리기 전에 기억');
  assert.match(read('app/journal.js'), /applyCheckPop\(li, item\.id\)/, '홈 업무일지 한 일');
  assert.match(read('app/calendar-tasks.js'), /if\(done===true\)applyCheckPop\(rowOf\(id\),id\)/, '일정 날짜 목록');
  assert.match(read('app/google-tasks.js'), /data-task-inline-row\$\{isDone\(t\)\?checkPopAttr\(t\.id\):''\}/, '담당조직·사업 보고 연결 목록');
  assert.match(read('app/meeting-round-detail.js'), /checkPopAttr\(t\.id\)/, '회의 상세');
});

test('끌기 조각은 눌림 움직임(작아짐)을 뺀 원래 크기·자리에서 시작한다(달력 할 일 끌기)', () => {
  assert.match(read('app/calendar-drag.js'), /w=g\.el\.offsetWidth\|\|b\.width,h=g\.el\.offsetHeight\|\|b\.height,r=\{left:b\.left\+\(b\.width-w\)\/2,top:b\.top\+\(b\.height-h\)\/2/);
});
