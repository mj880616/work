// UI-설정줄(S71-36 PROFILE-설정화면): 공용 설정 줄 부품(app/settings-list.mjs)의 글자 규칙.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {navRow, switchRow, actionRow, linkRow, infoRow, foldRow, groupHtml, noteHtml, pageHeadHtml, shortTime, attrsHtml} from '../app/settings-list.mjs';

test('들어가는 줄: 이름 + 오른쪽 회색 요약 + ›, 공용 글자 버튼(row-act) 한 종류', () => {
  const html = navRow({label: '알림 설정', sum: '켜짐 · 조용한 시간 23–07', attrs: {'data-ps-open': 'push'}});
  assert.match(html, /^<button type="button" class="row-act sl-row sl-nav" data-ps-open="push">/);
  assert.match(html, /<span class="sl-label">알림 설정<\/span>.*<span class="sl-sum">켜짐 · 조용한 시간 23–07<\/span><span class="sl-end sl-chev" aria-hidden="true">›<\/span><\/button>$/);
});

test('스위치 줄: 줄 전체가 label, 체크칸은 role=switch 하나(이름·설명·켜짐·꺼짐)', () => {
  const on = switchRow({label: '할 일 기한', desc: '기한이 다가오면', checked: true, attrs: {'data-ps-push-kind': 'task_due'}, ariaLabel: '할 일 기한 알림'});
  assert.match(on, /^<label class="sl-row sl-switch-row">/);
  assert.match(on, /<span class="sl-desc">기한이 다가오면<\/span>/);
  assert.match(on, /<input type="checkbox" role="switch" class="sl-switch" data-ps-push-kind="task_due" checked aria-label="할 일 기한 알림"><\/label>$/);
  assert.doesNotMatch(switchRow({label: 'x', checked: false, disabled: true}), / checked/);
  assert.match(switchRow({label: 'x', disabled: true}), / disabled /);
});

test('위험 줄은 빨간 글자(sl-danger), 붙인 class는 부품 class 뒤에 하나로 합친다', () => {
  assert.match(actionRow({label: '계정 삭제', danger: true, attrs: {'data-account-delete': true}}), /^<button type="button" class="row-act sl-row sl-action sl-danger" data-account-delete>/);
  const html = infoRow({label: 'a', sum: 'b', sumAttrs: {class: 'mr-r mr-ok'}, attrs: {class: 'k', 'data-z': 1}});
  assert.equal((html.match(/class=/g) || []).length, 4, '줄·글·이름·요약에 class 속성이 하나씩');
  assert.match(html, /^<div class="sl-row sl-info k" data-z="1">/);
  assert.match(html, /<span class="sl-sum mr-r mr-ok">b<\/span>/);
});

test('글자는 모두 escape한다(이름·설명·요약·속성 값·주소)', () => {
  const html = navRow({label: '<b>', sum: '"x"', attrs: {'data-a': '"><script>'}}) + linkRow({label: 'l', href: 'https://drive.google.com/drive/folders/a"b'});
  assert.doesNotMatch(html, /<b>|<script>|a"b/);
  assert.match(html, /&lt;b&gt;/);
  assert.equal(attrsHtml({a: true, b: false, c: null, d: 0}), ' a d="0"');
});

test('밖으로 여는 줄은 새 창·noopener, 접는 줄은 키보드로 여닫는 details', () => {
  assert.match(linkRow({label: '백업 폴더 열기', href: 'https://drive.google.com/drive/folders/abcdefghij12'}), /target="_blank" rel="noopener noreferrer".*↗<\/span><\/a>$/);
  const fold = foldRow({label: '등록된 폰', sum: '2대', body: '<div class="sl-row">x</div>', open: true});
  assert.match(fold, /^<details class="sl-fold" open><summary class="sl-row sl-nav">.*<\/summary><div class="sl-fold-body"><div class="sl-row">x<\/div><\/div><\/details>$/);
});

test('묶음: 빈 줄은 빼고 줄이 없으면 묶음도 없다. 제목은 위 작은 회색 글', () => {
  assert.equal(groupHtml([false, '', null]), '');
  assert.equal(groupHtml(['<i>a</i>'], {title: '앱'}), '<div class="sl-group-title">앱</div><div class="sl-group"><i>a</i></div>');
  assert.equal(noteHtml(''), '');
  assert.match(pageHeadHtml('알림 설정'), /<button type="button" class="icon-btn sl-back" data-sl-back aria-label="뒤로">‹<\/button><h2 class="sl-page-title">알림 설정<\/h2>/);
});

test('요약용 시각: 정각은 시만(23–07), 아니면 그대로', () => {
  assert.equal(shortTime('23:00'), '23');
  assert.equal(shortTime('07:00'), '07');
  assert.equal(shortTime('22:30'), '22:30');
  assert.equal(shortTime('x'), 'x');
});

test('모양은 ui-standard.css UI-설정줄 한 곳: 줄 44px·묶음 공용 상자·스위치·위험 빨강, 값은 토큰', () => {
  const css = readFileSync(new URL('../app/ui-standard.css', import.meta.url), 'utf8');
  const at = css.indexOf('/* ===== UI-설정줄');
  assert.ok(at > 0 && at < css.indexOf('/* ===== UI-버튼6가지'), 'UI-설정줄 묶음은 UI-버튼6가지 묶음 앞에 있다(그 묶음의 토큰만 검사에 섞이지 않게)');
  const block = css.slice(at, css.indexOf('/* =====', at + 10));
  assert.ok(block.length > 100);
  assert.match(block, /\.sl-group \.sl-row,[^{]*\{[^}]*min-height:var\(--kptu-touch-target,44px\)/);
  assert.match(block, /\.sl-group\{[^}]*border-radius:var\(--ds-radius-box,12px\)/);
  assert.match(block, /\.sl-group \.sl-row\.sl-danger:not\(#sl-none\),\.sl-danger \.sl-label\{color:var\(--kptu-danger\)\}/);
  assert.match(block, /input\.sl-switch:checked\{background:var\(/);
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|rgb\(/i, '색은 토큰만');
  for (const f of ['profile-settings.css']) assert.doesNotMatch(readFileSync(new URL(`../app/${f}`, import.meta.url), 'utf8'), /\.sl-(row|group|switch)\{/, `${f}는 줄 모양을 새로 정하지 않는다`);
});
