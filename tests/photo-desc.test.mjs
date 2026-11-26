import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DESC_MAX, tidyDesc, descLength, addWord, canSave} from '../app/photo-desc-model.mjs';

// S71-62 PHOTO-설명(E1): 설명 칸 하나 + 자주 쓴 낱말 칩. 계산은 photo-desc-model.mjs.
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('E1 칩 넣기: 칸 끝에 한 번, 이미 있는 낱말은 그대로, 빈칸 하나', () => {
  assert.equal(addWord('', '가상바다'), '가상바다');
  assert.equal(addWord('가상 하늘 ', '가상바다'), '가상 하늘 가상바다');
  assert.equal(addWord('가상바다 하늘', '가상바다'), '가상바다 하늘', '이미 있으면 그대로');
  assert.equal(addWord('가상', '  '), '가상');
  assert.equal(tidyDesc(' 가\n\n나\t 다  '), '가 나 다');
  assert.equal(descLength('가😀'), 2, '글자 수는 낱자 기준');
});

test('E1 저장 단추: 바꾸기는 처음 글과 다를 때, 붙이기는 글이 있을 때, 500자 넘으면 꺼짐', () => {
  assert.equal(DESC_MAX, 500);
  assert.equal(canSave({mode: 'set', text: '가상', before: '가상'}), false);
  assert.equal(canSave({mode: 'set', text: ' 가상 ', before: '가상'}), false);
  assert.equal(canSave({mode: 'set', text: '', before: '가상'}), true, '비우기 = 설명 삭제');
  assert.equal(canSave({mode: 'add', text: ''}), false);
  assert.equal(canSave({mode: 'add', text: '가상'}), true);
  assert.equal(canSave({mode: 'set', text: '가'.repeat(501)}), false);
});

test('E1 설명 글은 글자로만 그린다(innerHTML에 넣지 않음), 기기 저장 없음, 태그 칸 없음', () => {
  const ui = read('app/photo-desc.js'), photos = read('app/photos.js');
  assert.doesNotMatch(ui, /localStorage|sessionStorage|indexedDB/);
  assert.match(ui, /textContent: w/, '칩 글자는 textContent');
  // innerHTML에 끼우는 값은 고정 글(DESC_MAX)·기다림 표시뿐 — 설명·낱말은 끼우지 않는다.
  const slots = [...ui.matchAll(/\$\{([^}]+)\}/g)].map(m => m[1].trim());
  const htmlPart = ui.slice(ui.indexOf('dialog.innerHTML'), ui.indexOf('document.body.append(dialog)'));
  assert.deepEqual([...htmlPart.matchAll(/\$\{([^}]+)\}/g)].map(m => m[1].trim()), ['DESC_MAX'], '창 틀에 끼우는 값은 DESC_MAX뿐');
  assert.ok(slots.length > 0);
  assert.deepEqual(ui.split('\n').filter(l => /innerHTML/.test(l)).map(l => l.trim().slice(0, 40)), ['dialog.innerHTML = `<header class="pd-he', "s.loading = true; $('[data-pd-status]')."]);
  const code = ui.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(code, /태그/, '태그 칸·말 없음(설명 하나로)');
  // 크게 보기 한 줄은 photo-strip의 caption(textContent)으로만.
  assert.match(photos, /caption:item => \{ descFetch\(item\); return descOf\(item\); \}/);
  assert.match(read('app/photo-strip.js'), /captionEl\.textContent = caption\(item\) \|\| ''/);
  assert.doesNotMatch(photos.split('\n').filter(l => /descOf|descById/.test(l)).join('\n'), /localStorage|innerHTML/);
});
