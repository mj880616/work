import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {scan, compare, countFile, borderedOnLine} from './repeat-row-buttons.mjs';
// UI-반복단추줄이기(2026-11-28 14:05 사용자 결정 "이렇게 여러 번 반복될 때는 이런 방식의 버튼은 지양"): 반복 줄 안 테두리 단추는 늘지 않고 줄기만 한다.

test('검사기: 반복 줄(.map·.forEach·for) 안 테두리 단추만 센다', () => {
  assert.deepEqual(borderedOnLine(`<button type="button" class="secondary" data-x>열기</button>`), ['secondary']);
  assert.deepEqual(borderedOnLine(`<button class="row-act">수정</button><button class="icon-btn">⋯</button>`), []);
  assert.deepEqual(borderedOnLine(`const b=el('button','rn-send mini');`), ['rn-send mini']);
  assert.equal(countFile(`items.map(i=>\`<button class="danger">삭제</button>\`)`).length, 1);
  assert.equal(countFile(`const one='<button class="primary">저장</button>';`).length, 0, '반복 밖 한 번 그리는 단추는 세지 않는다');
  assert.equal(countFile(`items.map(i=>\`<button class="mini">x</button>\`) // repeat-row-ok`).length, 0);
});

test('업데이트 기록 줄의 [보냄]·[보내기]·[다시 보내기]·[수정]·[거두기]는 글자 단추(row-act)', () => {
  const src = readFileSync('app/release-notes-ui.js', 'utf8');
  assert.match(src, /el\('button','rn-send row-act'\)/);
  for (const word of ['다시 보내기', '수정', '거두기']) assert.match(src, new RegExp(`el\\('button','row-act(?: is-now)?','${word}'\\)`));
  assert.doesNotMatch(src, /el\('button','(?:rn-send )?mini'/);
});

test('공용 확인 상자 단추는 작은 크기(28px·글자 meta), [취소]는 글자, 위험 단추는 빨간 글자(채움 없음)', () => {
  const css = readFileSync('app/ui-standard.css', 'utf8');
  const block = css.slice(css.indexOf('/* ===== UI-반복단추줄이기 확인 상자'));
  assert.ok(block.length > 100);
  // DESIGN-단추정리 ②(2026-11-28 15:37 사용자 결정 시안 ②)
  assert.match(block, /\.kptu-ask-actions button:is\(\.primary,\.secondary,\.ghost,\.danger\)[^{]*\{[^}]*height:var\(--ds-compact-height-sm\) !important[^}]*font-size:var\(--ds-text-meta\) !important/);
  assert.match(block, /\.kptu-ask-actions button:is\(\.primary,\.secondary,\.ghost,\.danger\)[^{]*::after\{[^}]*height:var\(--kptu-touch-target\)/, '누르는 범위 44px');
  assert.match(block, /\.kptu-ask-actions button:is\(\.secondary,\.ghost\)[^{]*\{[^}]*background:transparent !important;[^}]*border:0 !important;/, '[취소] = 테두리 없는 글자');
  assert.match(block, /\.kptu-ask-actions button\.danger[^{]*\{[^}]*background:transparent !important;[^}]*border:0 !important;[^}]*color:var\(--kptu-danger\) !important/);
});

test('재발 방지: 반복 줄 안 테두리 단추가 기준표보다 늘지 않는다', () => {
  const baseline = JSON.parse(readFileSync(new URL('./repeat-row-buttons-baseline.json', import.meta.url), 'utf8'));
  const {grown, reduced} = compare(scan(), baseline);
  if (reduced.length) console.info('반복 줄 테두리 단추가 줄었어요. tests/repeat-row-buttons-baseline.json 숫자도 줄여 주세요:\n' + reduced.join('\n'));
  assert.deepEqual(grown, [], '줄·카드마다 되풀이되는 동작은 테두리 단추(secondary·ghost·danger·primary·mini) 대신 글자 단추(row-act) 또는 ⋮ 메뉴로 — '
    + 'docs/design-decisions.md UI-버튼기준 "반복 줄 단추"(2026-11-28 사용자 결정).');
});

// DESIGN-단추정리 ①(2026-11-28 15:37 사용자 결정 시안 ①, docs/design/button-audit.md 공통 원인 A·B): 줄 끝 동작은 공용 자리 .row-acts 하나.
test('공용 줄 끝 동작 자리(.row-acts): 오른쪽 끝·줄바꿈 없음·안은 글자 버튼, 값은 토큰만', () => {
  const css = readFileSync('app/ui-standard.css', 'utf8');
  const block = css.slice(css.indexOf('/* ===== DESIGN-단추정리 ① 줄 끝 동작 자리'));
  assert.ok(block.length > 100, '공용 규칙 한 곳');
  assert.match(block, /\.row-acts\{[^}]*flex:none;[^}]*margin-left:auto;[^}]*white-space:nowrap;/);
  assert.match(block, /\.row-acts button\.row-act[^{]*\{ font-size:var\(--ds-text-meta\); \}/);
  assert.match(block, /button\.row-act\.is-now\{[^}]*text-decoration:underline/, '바로 일이 생기는 것만 밑줄');
  assert.doesNotMatch(block.slice(block.indexOf('*/') + 2).replace(/var\([^)]*\)/g, ''), /\b\d+px\b|#[0-9a-f]{3,8}\b/i);
});

test('조사표 반복 줄(#3·#4·#7–#13)은 테두리 단추 없이 글자 단추·⋯·줄 누르기', () => {
  const src = f => readFileSync(`app/${f}`, 'utf8');
  // 업무일지 줄은 WEEKLY-화면정돈 ⑤로 줄 끝 ⋯ 하나(공용 rowMore) — 수정·삭제 글자 단추는 줄에 없다.
  assert.match(src('journal.js'), /rowMore\(document, \{label:`\$\{index \+ 1\}번째 줄 수정·삭제`/);
  assert.doesNotMatch(src('journal.js'), /journal-line-actions/);
  const ps = src('project-system-v3.js');
  assert.match(ps, /<span class="row-acts"><button type="button" class="row-act" data-ps3-edit-milestone=/);
  assert.match(ps, /class="row-act is-now ps3-prow-restore" data-ps3-restore=/);
  assert.match(ps, /class="row-act is-now ps3-prow-restore" data-ps3-trash-restore=/);
  assert.match(src('suborganizations.js'), /<span class="row-acts"><button type="button" class="row-act is-now so-unarchive"/);
  assert.match(src('files.js'), /<span class="row-acts"><button type="button" class="row-act is-now" data-fx-job-act=/);
  assert.match(src('workplace-report.js'), /<button type="button" class="war-report" data-war-detail=/, '보고 줄 전체를 누르면 열기');
  assert.doesNotMatch(src('workplace-report.js'), />열기<\/button>/);
  const tf = src('task-files.js');
  assert.match(tf, /class="gt-att-name gt-att-open" [^`]*data-fa-menu="open"/, '첨부 이름 누르기 = 열기');
  assert.match(tf, /<details class="journal-kind-more row-more gt-att-more-menu">/, '내려받기·교체·빼기는 줄 끝 ⋯');
  assert.doesNotMatch(tf, /class="ghost gt-att-btn"/);
  const it = src('inbox-todos.js');
  assert.doesNotMatch(it, /class="inbox-todo-btn/, '화면 전용 테두리 단추 클래스 없음');
  assert.doesNotMatch(readFileSync('app/meeting-ui.css', 'utf8'), /button\.inbox-todo-btn\{/);
});
