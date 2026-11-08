import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
// UI-창아래버튼통일(2026-11-07 명진 요청 10:55, 시안 docs/design/mockups/sheet-footer-buttons.html 'A'): 창 아래 버튼 줄(삭제·완료·저장)은 한 가족.
// 높이·모서리·글자 크기·굵기·안쪽 여백이 같고 테두리 선이 없으며, 채움 정도만 다르다(저장 진하게 · 보조 연하게 · 삭제 빨간 글자, 왼쪽 끝).
// 모양은 app/ui-standard.css 끝 'UI-창아래버튼통일' 한 곳, 줄 부품은 .modal-action-footer(팝업)·.save-row(화면 안 창·칸). 재발 방지 시험(App smoke check).
const ui = readFileSync('app/ui-standard.css', 'utf8');
const head = '/* ===== UI-창아래버튼통일';
const block = ui.slice(ui.indexOf(head));
const FOOT = ':is(.modal-action-footer,.save-row,.home-choice-foot,.record-sheet-foot,.diary-od-foot)';
const FOOT_CLASS = 'modal-action-footer|save-row|home-choice-foot|record-sheet-foot|diary-od-foot';
const FAMILY = ['primary', 'secondary', 'ghost', 'danger', 'tl-danger', 'wd-danger', 'ps3-danger', 'ps3-danger-btn', 'ps3-record-danger', 'ps-danger', 'ci-delete'];
const DANGER = FAMILY.slice(3);
const NOT_FAMILY = ['icon-btn', 'row-act', 'ds-chip', 'ds-seg-btn', 'mini'];

test('창 아래 버튼 줄 공용 규칙이 ui-standard.css 한 곳에 있고 값은 토큰만 쓴다', () => {
  assert.ok(ui.indexOf(head) > ui.indexOf('/* ===== UI-버튼6가지'), 'UI-버튼6가지 뒤에 둔다');
  const rule = sel => { const i = block.indexOf(sel + '{'); assert.ok(i > 0, sel); return block.slice(i, block.indexOf('}', i)); };
  const base = rule(`${FOOT} button:is(.${FAMILY.join(',.')}):not(.${NOT_FAMILY.join(',.')})`);
  for (const d of ['height:var(--kptu-control-height) !important', 'min-height:var(--kptu-control-height) !important', 'padding:0 var(--ds-control-pad-x) !important',
    'border:0 !important', 'border-radius:var(--ds-radius-control) !important', 'font-size:var(--ds-text-button) !important', 'font-weight:var(--ds-weight-medium) !important'])
    assert.ok(base.includes(d), '같은 모양: ' + d);
  assert.match(rule(`${FOOT} button.primary:not(.${NOT_FAMILY.join(',.')})`), /background:var\(--kptu-primary\) !important; color:var\(--kptu-on-primary\) !important/, '저장 = 진한 채움');
  assert.match(rule(`${FOOT} button:is(.secondary,.ghost):not(.primary,.${DANGER.join(',.')},.${NOT_FAMILY.join(',.')})`), /background:var\(--kptu-primary-soft\) !important; color:var\(--kptu-ink\) !important/, '보조 = 연한 채움');
  const del = rule(`${FOOT} button:is(.${DANGER.join(',.')}):not(.primary,.${NOT_FAMILY.join(',.')})`);
  assert.match(del, /background:transparent !important; color:var\(--kptu-danger\) !important; margin-right:auto !important/, '삭제 = 바탕 없는 빨간 글자, 왼쪽 끝');
  const rules = block.slice(block.indexOf('*/') + 2);
  assert.doesNotMatch(rules.replace(/var\([^)]*\)/g, ''), /\b[1-9]\d*px\b|#[0-9a-f]{3,8}\b|rgb\(/i, '숫자 없이 토큰만');
});

// 화면 코드의 창 아래 버튼 줄(.modal-action-footer·.save-row) 안 버튼을 모은다.
function footers() {
  const out = [], dir = new URL('../app/', import.meta.url);
  for (const f of readdirSync(dir).sort()) {
    if (!/\.(js|mjs|html)$/.test(f)) continue;
    const s = readFileSync(new URL(f, dir), 'utf8');
    const re = new RegExp(`<(div|footer)\\b[^>]*class=(["'\`])([^"'\`]*\\b(?:${FOOT_CLASS})\\b[^"'\`]*)\\2[^>]*>`, 'g');
    for (let m; (m = re.exec(s));) {
      const start = m.index + m[0].length, tag = /<\/?(div|footer)\b[^>]*>/g;
      let depth = 1, end = s.length;
      tag.lastIndex = start;
      for (let t; (t = tag.exec(s));) { depth += t[0][1] === '/' ? -1 : 1; if (!depth || t.index - start > 4000) { end = t.index; break; } }
      const buttons = [...s.slice(start, end).matchAll(/<button\b([^>]*)>/g)].map(b => ((b[1].match(/class=(["'`])([\s\S]*?)\1/) || [])[2] || '').split(/\s+/).filter(Boolean));
      if (buttons.length) out.push({file:f, foot:m[3], buttons});
    }
  }
  return out;
}
// 가족 클래스가 아닌 줄 안 버튼 예외표. 업무일지 표·줄 안 버튼은 콤팩트 결정대로 작은 버튼(.mini) 유지(journal.spec 1835) — 새 예외를 더하지 않는다.
const LEFTOVER = {'journal.js':3};

test('줄 안 삭제는 맨 앞(왼쪽 끝), 저장(주 동작)은 맨 뒤(오른쪽 끝)', () => {
  const list = footers();
  assert.ok(list.length >= 25, '창 아래 버튼 줄을 찾는다: ' + list.length);
  for (const {file, foot, buttons} of list) {
    const fam = buttons.filter(c => c.some(x => FAMILY.includes(x)) && !c.some(x => NOT_FAMILY.includes(x)));
    const di = fam.findIndex(c => c.some(x => DANGER.includes(x)) && !c.includes('primary'));
    if (di >= 0) assert.equal(di, 0, `${file} ${foot}: [삭제]는 줄 맨 앞`);
    const pi = fam.findIndex(c => c.includes('primary'));
    if (pi >= 0) assert.equal(pi, fam.length - 1, `${file} ${foot}: [저장]은 줄 맨 뒤`);
  }
});

test('재발 방지: 줄 안 버튼은 가족 클래스(.primary·.secondary·.ghost·지우기)를 쓴다 — 남은 것은 줄기만', () => {
  const count = {};
  for (const {file, buttons} of footers())
    for (const c of buttons) if (!c.some(x => FAMILY.includes(x)) || c.some(x => NOT_FAMILY.includes(x))) count[file] = (count[file] || 0) + 1;
  for (const [f, n] of Object.entries(count)) assert.ok(n <= (LEFTOVER[f] || 0), `${f}: 창 아래 버튼 줄의 버튼은 .primary(저장)·.secondary(보조)·.danger(삭제) 중 하나 (${n} > ${LEFTOVER[f] || 0})`);
  for (const [f, n] of Object.entries(LEFTOVER)) if ((count[f] || 0) < n) console.info(`UI-창아래버튼통일: ${f} 남은 수가 ${n} → ${count[f] || 0}. LEFTOVER도 줄여 주세요.`);
});

test('할 일 수정 창 줄: [삭제][완료][저장] 순서, 화면별 높이 규칙 없음', () => {
  const gt = readFileSync('app/google-tasks.js', 'utf8');
  assert.match(gt, /<button id="gtDeleteBtn" class="ghost tl-danger hidden"[^>]*>삭제<\/button><button id="gtToggleBtn" class="ghost hidden"[^>]*>완료<\/button><button id="gtSaveBtn" data-enter-save-submit class="primary"/);
  const html = readFileSync('app/index.html', 'utf8');
  assert.match(html, /<button id="taskModalDelete" class="ghost tl-danger hidden"[^>]*>삭제<\/button><button id="taskModalToggle" class="secondary"/);
  const css = ['ui-standard.css', 'google-tasks.css'].map(f => readFileSync('app/' + f, 'utf8')).join('\n');
  assert.doesNotMatch(css, /#gt(Delete|Toggle|Save)Btn[^{}]*\{[^}]*(height|border|background|padding)\s*:/, '[삭제][완료][저장] 모양은 공용 규칙 한 곳');
});

test('② 이름이 다른 창 아래 줄(고르기·노트 기록·원드라이브 설정)도 같은 부품, 화면 CSS에 그 버튼 모양 규칙 없음', () => {
  const css = ['choice-sheet.css', 'record-sheet.css', 'diary.css'].map(f => readFileSync('app/' + f, 'utf8')).join('\n');
  assert.doesNotMatch(css, /(home-choice-foot|record-sheet-foot|diary-od-foot)\s+(button(?![:\w])|\.home-choice-save)[^{]*\{[^}]*(height|border|background|padding|font-size)\s*:/, '모양은 UI-창아래버튼통일 한 곳');
  const cs = readFileSync('app/choice-sheet.js', 'utf8');
  assert.match(cs, /class="secondary home-choice-cancel" data-sheet-cancel/);
  assert.match(cs, /class="primary home-choice-save" data-sheet-save/);
});
