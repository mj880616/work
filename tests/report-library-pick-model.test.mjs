// S67-39: 사업 보고·조직 보고 '자료 +' [자료실에서 선택] 고르기 줄과 붙이기·빼기 글의 순수 규칙.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reportPickRows, attachResult, detachAsk, detachDone, PICK_RECENT, OTHER_TAG, OTHER_ORG_TAG} from '../app/report-library-pick-model.mjs';

const docs = [
  {id: 'a', title: '예산안', file_name: '예산안.pdf', meeting_id: null, organization_id: null},
  {id: 'b', title: '현장', file_name: '현장.jpg', meeting_id: 'm1', organization_id: null},
  {id: 'c', title: '다른 보고 자료', file_name: 'x.pdf', meeting_id: 'm2', organization_id: 'o1'},
];

test('사업 보고: 이 보고·고른 것은 이미 있음, 다른 보고는 흐림+꼬리표, 나머지는 고를 수 있음', () => {
  const {all, total} = reportPickRows({docs, column: 'meeting_id', targetId: 'm1', chosen: new Set(['a'])});
  assert.equal(total, 3);
  const by = Object.fromEntries(all.map(r => [r.id, r]));
  assert.deepEqual([by.a.enabled, by.a.current], [false, true]);
  assert.deepEqual([by.b.enabled, by.b.current], [false, true]);
  assert.deepEqual([by.c.enabled, by.c.current, by.c.tag], [false, false, OTHER_TAG]);
  const fresh = reportPickRows({docs, targetId: ''}).all;
  assert.equal(fresh.find(r => r.id === 'a').enabled, true);
  assert.equal(fresh.find(r => r.id === 'b').tag, OTHER_TAG, '새 보고에서는 어느 보고에 붙은 자료든 다른 보고');
});

test('조직 보고: organization_id 칸으로 판단하고 꼬리표는 다른 조직', () => {
  const {all} = reportPickRows({docs, column: 'organization_id', targetId: 'o2'});
  const by = Object.fromEntries(all.map(r => [r.id, r]));
  assert.equal(by.b.enabled, true, '사업 보고에 붙은 자료도 조직에는 붙일 수 있음');
  assert.equal(by.c.tag, OTHER_ORG_TAG);
  assert.equal(reportPickRows({docs, column: 'organization_id', targetId: 'o1'}).all.find(r => r.id === 'c').current, true);
});

test('찾기: 낱말이 모두 든 것만, 찾지 않을 때는 최근 PICK_RECENT개까지', () => {
  assert.deepEqual(reportPickRows({docs, query: '예산 pdf'}).all.map(r => r.id), ['a']);
  const many = Array.from({length: PICK_RECENT + 5}, (_, i) => ({id: 'd' + i, title: '자료 ' + i}));
  assert.equal(reportPickRows({docs: many}).all.length, PICK_RECENT);
});

test('붙이기 결과 글', () => {
  assert.equal(attachResult({}), null);
  assert.deepEqual(attachResult({attached: 2}), {text: '자료 2개를 붙였어요', error: false});
  assert.equal(attachResult({attached: 1, taken: 1}).text, '자료 1개를 붙였어요 · 1개는 다른 보고에 있어 그대로 두었어요');
  assert.equal(attachResult({taken: 1, column: 'organization_id'}).text, '다른 조직에 붙은 자료라 붙이지 않았어요');
  assert.equal(attachResult({failed: 2}).error, true);
});

test('빼기 글: 사진·자료, 원본은 그대로라고 말한다', () => {
  assert.equal(detachAsk('현장.jpg', 'photo').text, '“현장.jpg”을(를) 이 보고에서 뺄까요?');
  assert.equal(detachAsk('a.pdf').note, '자료와 파일은 자료실·Drive에 그대로 있고, 이 보고에 붙은 표시만 풀려요.');
  assert.match(detachAsk('a', 'photo').note, /^사진과 파일은/);
  assert.equal(detachDone('photo'), '이 보고에서 뺐어요. 사진은 자료실에 그대로 있어요.');
});

test('붙이기는 내 작업공간 + 아직 안 붙은 줄만 바꾸고 파일을 올리지 않는다(화면 코드 모양)', () => {
  const src = readFileSync(new URL('../app/report-library-pick.js', import.meta.url), 'utf8');
  assert.match(src, /workspace_id=eq\.\$\{enc\(workspace\)\}&id=in\.\(/);
  assert.match(src, /&\$\{column\}=is\.null&/);
  assert.doesNotMatch(src, /library-files|meeting-files|document-actions/);
});
