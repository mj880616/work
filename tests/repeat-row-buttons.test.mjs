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
  for (const word of ['다시 보내기', '수정', '거두기']) assert.match(src, new RegExp(`el\\('button','row-act','${word}'\\)`));
  assert.doesNotMatch(src, /el\('button','(?:rn-send )?mini'/);
});

test('공용 확인 상자 단추는 작은 크기, 위험 단추는 빨간 글자(채움 없음)', () => {
  const css = readFileSync('app/ui-standard.css', 'utf8');
  const block = css.slice(css.indexOf('/* ===== UI-반복단추줄이기 확인 상자'));
  assert.ok(block.length > 100);
  assert.match(block, /\.kptu-ask-actions button:is\(\.primary,\.secondary,\.ghost,\.danger\)[^{]*\{[^}]*height:var\(--ds-compact-height\) !important/);
  assert.match(block, /\.kptu-ask-actions button\.danger[^{]*\{[^}]*background:transparent !important;[^}]*border:0 !important;[^}]*color:var\(--kptu-danger\) !important/);
});

test('재발 방지: 반복 줄 안 테두리 단추가 기준표보다 늘지 않는다', () => {
  const baseline = JSON.parse(readFileSync(new URL('./repeat-row-buttons-baseline.json', import.meta.url), 'utf8'));
  const {grown, reduced} = compare(scan(), baseline);
  if (reduced.length) console.info('반복 줄 테두리 단추가 줄었어요. tests/repeat-row-buttons-baseline.json 숫자도 줄여 주세요:\n' + reduced.join('\n'));
  assert.deepEqual(grown, [], '줄·카드마다 되풀이되는 동작은 테두리 단추(secondary·ghost·danger·primary·mini) 대신 글자 단추(row-act) 또는 ⋮ 메뉴로 — '
    + 'docs/design-decisions.md UI-버튼기준 "반복 줄 단추"(2026-11-28 사용자 결정).');
});
