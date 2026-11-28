import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
// S70-29 APP-일회용기능정리(2026-11-25 명진 '다 없애 1회용 기능'): ORG-기록첨부 옛줄바꾸기(S67-13)의
// 조직 관리 ⋯ [옛 사진 기록 채우기]와 기록 줄 ⋯ [이전 줄로 되돌리기]는 11/19 전 기록용 한 번 정리라 지웠다.
// 새 기록 줄은 저장할 때 서버 AI가 만든다(record-attach.js). 서버 photo-brief는 다른 곳도 쓰므로 남는다.
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('옛 사진 기록 채우기: 파일·메뉴·되돌리기 줄이 없다', () => {
  for (const f of ['app/record-line-backfill.js', 'app/record-line-backfill.mjs', 'app/record-line-briefs.js']) assert.equal(existsSync(new URL('../' + f, import.meta.url)), false, f);
  const code = ['app/suborganizations.js', 'app/basket-link-records.js', 'app/project-system-v3.js'].map(read).join('\n');
  assert.doesNotMatch(code, /옛 사진 기록 채우기|data-so-line-backfill|record-line-backfill|record-line-briefs/);
  assert.doesNotMatch(code, /이전 줄로 되돌리기|line-revert|line_revert|lineRevertItem|markLineRevert|data-basket-link-revert/);
});

test('남기는 것: 서버 photo-brief 요청 길과 기록 글 수정(⋯ [수정], RECORD-기록하나로)은 그대로', () => {
  assert.equal(existsSync(new URL('../app/photo-brief-request.js', import.meta.url)), true);
  const links = read('app/basket-link-records.js');
  assert.match(links, /export async function updateLinkSummary|export const updateLinkSummary|updateLinkSummary=/);
  assert.match(links, /recordMenuHtml\('basket-link-action'/);assert.match(links, /if\(name==='edit'\)\{open\(id\);return;\}/);
});
