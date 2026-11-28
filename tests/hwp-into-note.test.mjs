import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {noteConvertText} from '../app/hwp-convert-model.mjs';
import {requestHwpConvert, takeHwpConvertRequest} from '../app/hwp-drive.js';
// S71-61 HWP-노트안으로(2026-11-26 사용자 결정 "노트 안에서만 열게 하자"): HWP 편집은 메뉴가 아니라 노트 안 화면.
// 노트 화면 ⋯ [HWP 편집], 노트 ⋯ [이 노트를 HWP로](노트 글 → 기존 [노조 서식으로 만들기] 흐름), 위치 줄 '노트 › HWP 편집'.
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('이 노트를 HWP로: 넘길 글은 제목(본문 첫 줄과 다를 때만) + 본문, 글이 없으면 빈 글', () => {
  assert.equal(noteConvertText({title: '회의 결과', raw_text: '첫째 안건\r\n둘째 안건'}), '회의 결과\n\n첫째 안건\n둘째 안건');
  assert.equal(noteConvertText({title: '회의 결과', raw_text: '# 회의 결과\n내용'}), '# 회의 결과\n내용', '본문 첫 줄이 제목이면 겹치지 않게');
  assert.equal(noteConvertText({title: '노트', raw_text: '내용만'}), '내용만', '기본 제목은 넣지 않는다');
  assert.equal(noteConvertText({title: '제목만', raw_text: ''}), '제목만');
  assert.equal(noteConvertText({title: '노트', raw_text: '  '}), '');
  assert.equal(noteConvertText(null), '');
});

test('이 노트를 HWP로: 한 번짜리 넘김은 로그인한 사람·작업공간에 묶이고 한 번만 꺼낸다', () => {
  const rt = who => ({context: {read: () => ({user: {id: who}, workspace: {id: 'w1'}})}});
  assert.equal(requestHwpConvert('글', {context: {read: () => null}}), false, '로그인 정보 없으면 넘기지 않음');
  assert.equal(requestHwpConvert('   ', rt('u1')), false, '빈 글은 넘기지 않음');
  assert.equal(requestHwpConvert('노트 글', rt('u1')), true);
  assert.equal(takeHwpConvertRequest(rt('u2')), null, '다른 사람이면 버린다');
  assert.equal(takeHwpConvertRequest(rt('u1')), null, '한 번 꺼내면 비어 있다');
  requestHwpConvert('노트 글', rt('u1'));
  assert.equal(takeHwpConvertRequest(rt('u1')), '노트 글');
  assert.equal(takeHwpConvertRequest(rt('u1')), null);
});

test('노트 ⋯: 화면 ⋯에 [HWP 편집], 노트 한 개 ⋯에 [이 노트를 HWP로] — 기존 화면·변환 흐름으로 간다', () => {
  const notes = read('app/basket-notes.js');
  assert.match(notes, /\['data-nx-hwp', 'HWP 편집'\],\s*\n\s*\['data-nx-help', '쓰는 법'\]/, '화면 ⋯ 쓰는 법 바로 위');
  assert.match(notes, /\['data-note-to-hwp', '이 노트를 HWP로'\]/);
  assert.match(notes, /from\.from === 'head' && b\.hasAttribute\('data-nx-hwp'\)\) \{ openHwpView\(\); return; \}/);
  assert.match(notes, /else if \(b\.hasAttribute\('data-note-to-hwp'\)\) noteToHwp\(note\);/);
  assert.match(notes, /KPTURouter\?\.go\?\.\('hwp', \{source:'delegated'\}\)/, '새 화면 없이 기존 ?view=hwp');
  const lab = read('app/hwp-lab.js');
  assert.match(lab, /const noteText=busy\?null:takeHwpConvertRequest\(rt\);/);
  assert.match(lab, /if\(noteText\)void startConvert\(noteText\);/);
  assert.match(lab, /openConvertDialog\(\{onMake:runConvert,text\}\)/, '기존 [노조 서식으로 만들기] 흐름(runConvert) 그대로');
  assert.match(read('app/hwp-convert.js'), /area\.value=cleanPasted\(text\);/);
});

test('메뉴에서 빠짐: 처음 화면(index.html) 왼쪽 메뉴·[메뉴] 창에 HWP 편집 줄이 없고, 위치 줄은 노트 › HWP 편집', () => {
  const html = read('app/index.html');
  assert.doesNotMatch(html, /class="nav-btn" data-view="hwp"/);
  assert.doesNotMatch(html, /<button type="button" data-view="hwp">/);
  assert.match(html, /<section id="hwpView"/, '화면은 그대로');
  const top = read('app/topbar-actions.js');
  assert.match(top, /projects:'reports',hwp:'note'[,}]/);
  assert.match(top, /note:\{name:'노트',view:'note'\}/);
  assert.match(top, /if\(go==='note'\)\{void openBasketKind\('note'\);return\}/);
  assert.doesNotMatch(top, /const ALL_KEYS=\[[^\]]*'hwp'/);
  assert.match(read('app/app-router.js'), /const inNote=noteMode\|\|target==='hwp';/);
});
