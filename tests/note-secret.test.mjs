// NOTE-비밀메모(2026-10-28 17:23 결정): 화면 공용 판별(app/note-secret.mjs)이 서버(ai-assist note-title.ts looksSecret)와 같은 규칙인지,
// 목록 제목 가리기·[AI에 보내지 않기]/[풀기] 표시. 예시 값은 모두 지어낸 가짜 글이다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {looksSecret, noteAiOff, noteMasked, SECRET_TITLE} from '../app/note-secret.mjs';
import {noteLineTitle} from '../app/note-tree.mjs';

const rules = src => {
  const a = src.indexOf('const SECRET_WORD'), b = src.indexOf('const LONG_RANDOM');
  assert.ok(a > 0 && b > a, '규칙 줄을 찾음');
  return src.slice(a, src.indexOf('\n', b)).split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
};
test('판별 규칙 줄이 서버 note-title.ts와 글자 그대로 같다', () => {
  const server = readFileSync(new URL('../supabase/functions/ai-assist/note-title.ts', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../app/note-secret.mjs', import.meta.url), 'utf8');
  assert.equal(rules(app), rules(server));
  // 함수 몸통(덩어리 검사)도 같은 모양.
  const body = s => s.slice(s.indexOf('for (const m of s.match(LONG_RANDOM)'), s.indexOf('return false;', s.indexOf('for (const m of s.match(LONG_RANDOM)'))).replace(/\(re\) =>/g, 're =>').replace(/\s+/g, ' ');
  assert.equal(body(app), body(server));
});

const fake = 'Ab3' + 'x'.repeat(10) + 'Q9z' + 'y'.repeat(12);
test('비밀 모양 글', () => {
  assert.equal(looksSecret('공유기 비밀번호: 아무거나'), true);
  assert.equal(looksSecret('API_KEY = 가짜'), true);
  assert.equal(looksSecret('-----BEGIN RSA PRIVATE KEY-----'), true);
  assert.equal(looksSecret(`붙여 둔 값 ${fake}`), true);
  assert.equal(looksSecret('회의 준비 메모, 3차 교섭'), false);
});

const note = (title, raw_text, metadata = {}) => ({title, raw_text, metadata});
test('목록 제목: 비밀 노트는 비밀 메모(직접 쓴 다른 제목은 그대로), 풀면 원래 제목', () => {
  const auto = note('와이파이 비밀번호: x', '와이파이 비밀번호: x');
  assert.equal(noteLineTitle(auto), SECRET_TITLE);
  assert.equal(noteMasked(auto), true);
  assert.equal(noteLineTitle(note('집 공유기', `메모\n${fake}`)), '집 공유기', '직접 쓴 제목은 비밀 모양이 아니면 그대로');
  assert.equal(noteLineTitle(note('', `첫 줄\npassword: x`, {ai_title:'공유기 메모'})), SECRET_TITLE, 'AI 제목보다 가림이 먼저');
  assert.equal(noteLineTitle(note('와이파이 비밀번호: x', '와이파이 비밀번호: x', {ai_off:false})), '와이파이 비밀번호: x', '[풀기]면 가리지 않음');
  assert.equal(noteLineTitle(note('장보기', '우유')), '장보기');
});
test('AI에 보내지 않기 표시', () => {
  assert.equal(noteAiOff(note('장보기', '우유')), false);
  assert.equal(noteAiOff(note('장보기', '우유', {ai_off:true})), true);
  assert.equal(noteAiOff(note('x', 'token: 가짜')), true, '비밀 모양이면 자동으로');
  assert.equal(noteAiOff(note('x', 'token: 가짜', {ai_off:false})), false, '[풀기]');
});
