// NEWS-매체늘리기: take=keywords 글자 일치 거르기(AI 없음). 글은 모두 가짜.
import test from 'node:test';
import assert from 'node:assert/strict';
import {matchedKeywords} from '../supabase/functions/_shared/news-catalog.ts';
test('키워드 글자 일치: 제목+소개, 대소문자·공백 무시, 맞는 것만', () => {
  assert.deepEqual(matchedKeywords('가짜 철도 파업 소식\n지하철', ['철도', '버스']), ['철도']);
  assert.deepEqual(matchedKeywords('Union STRIKE news', [' strike ']), [' strike ']);
  assert.deepEqual(matchedKeywords('날씨 이야기', ['철도', '']), []);
  assert.deepEqual(matchedKeywords('철도 철도', ['철도', '철도']), ['철도']);
});
