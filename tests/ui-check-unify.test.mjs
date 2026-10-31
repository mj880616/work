// UI-체크칸통일(2026-10-31): 앱의 체크칸·라디오 모양은 ui-standard.css의 공용 규칙 하나가 정한다(작은 16px 네모, 앱 기본색).
// 글 칸 기본(base-ui.css input{width:100%})이 체크칸을 큰 칸으로 만들던 일이 다시 생기거나, 화면마다 체크칸 크기를 따로 정하면 실패한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const app = fileURLToPath(new URL('../app/', import.meta.url));
const read = name => readFileSync(app + name, 'utf8');
const ui = read('ui-standard.css');
const block = sel => { const i = ui.indexOf(sel + '{'); assert.ok(i >= 0, `${sel} 규칙이 있어야 한다`); return ui.slice(i, ui.indexOf('}', i)); };

test('공용 체크칸 규칙: 16px, 글 칸 모양을 지움, 앱 기본색, 강도는 input 기본과 같음(:where)', () => {
  const b = block('input:where([type="checkbox"],[type="radio"])');
  for (const d of ['width:16px', 'height:16px', 'min-height:0', 'padding:0', 'border:0', 'flex:none', 'accent-color:var(--kptu-primary)']) assert.ok(b.includes(d), d);
  // 공용 규칙은 base-ui.css(글 칸 기본)보다 뒤에 읽히는 파일에 있어야 이긴다: 모든 화면 묶음이 ui-standard.css를 마지막에 읽는다.
  const loader = read('view-loader.js');
  const lines = loader.split('\n').filter(l => /^\s+\w+:\[.*\.css'/.test(l));
  assert.ok(lines.length > 10);
  for (const l of lines) assert.match(l, /'\.\/ui-standard\.css'\]/, l.trim());
});

test('체크칸 줄은 한 줄(☐ 글자)이고 목록 점이 없다', () => {
  assert.match(ui, /label:where\(:has\(> input:is\(\[type="checkbox"\],\[type="radio"\]\)\)\)\{ flex-direction:row; align-items:center;/);
  assert.match(ui, /li:where\(:has\(> label > input:is\(\[type="checkbox"\],\[type="radio"\]\)\)\)\{ list-style:none; \}/);
  const list = block(':root .check-list');
  assert.ok(list.includes('list-style:none') && list.includes('padding:0'));
});

test('한글 상자 "다음 주에도 쓸까요?" 목록은 공용 체크 목록을 쓴다', () => {
  const js = read('journal-hwpx.js');
  const i = js.indexOf('function renderRemember');
  const part = js.slice(i, js.indexOf('\n  }\n', i));
  assert.match(part, /el\('ul', 'check-list/);
  assert.match(part, /label\.append\(box_, text\)/);
});

test('화면 CSS는 보이는 체크칸의 크기·색을 따로 정하지 않는다(공용 규칙 하나)', () => {
  // 예외: 칩 위 투명 체크칸(ledger .lb-chip), 자료실 줄 위 겹친 고르기 칸(.lu-pick 위치), 할 일 완료 칸(task-layout, 별도 부품).
  const allowed = new Set(['ui-standard.css', 'library-upload.css', 'task-layout.css']);
  const bad = [];
  for (const name of readdirSync(app).filter(n => n.endsWith('.css'))) {
    if (allowed.has(name)) continue;
    const css = read(name);
    if (/accent-color/.test(css)) bad.push(`${name}: accent-color`);
    for (const m of css.matchAll(/([^{}]*\binput(?:\[type="?(?:checkbox|radio)"?\])?)\s*\{([^}]*)\}/g)) {
      const [sel, body] = [m[1].trim(), m[2]];
      if (!/(check|pick|toggle|ci-all|mtd-attach|org-box|aff)/.test(sel)) continue;
      if (/opacity:\s*0\b/.test(body)) continue; // 일부러 감춘 체크칸
      if (/(^|;|\s)(width|height)\s*:/.test(body)) bad.push(`${name}: ${sel}`);
    }
  }
  assert.deepEqual(bad, []);
});
