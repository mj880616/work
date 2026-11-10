// NOTE-AI제외정리(2026-11-10 17:41 명진 결정 A — 10/28 NOTE-비밀메모를 바꿈): 화면은 비밀 모양 글을 가리지 않는다.
// 노트 ⋯ [AI에 보내지 않기]/[AI 제외 풀기] 메뉴와 목록·검색 '비밀 메모' 제목 가림을 지웠고, 화면 공용 판별 모듈(app/note-secret.mjs)도 지웠다.
// 비밀번호·토큰·키 모양 부분은 서버(ai-assist note-secret.ts maskSecret)가 AI로 보낼 때만 가린다(tests/note-secret-server.test.mjs).
// 예시 값은 모두 지어낸 가짜 글이다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync, readdirSync} from 'node:fs';
import {noteLineTitle} from '../app/note-tree.mjs';

const note = (title, raw_text, metadata = {}) => ({title, raw_text, metadata});
const fake = 'Ab3' + 'x'.repeat(10) + 'Q9z' + 'y'.repeat(12);

test('목록 제목: 비밀 모양 글이 든 노트도 원래 제목(직접 쓴 제목 → AI 제목 → 첫 줄)', () => {
  assert.equal(noteLineTitle(note('와이파이 비밀번호: x', '와이파이 비밀번호: x')), '와이파이 비밀번호: x');
  assert.equal(noteLineTitle(note('집 공유기', `메모\n${fake}`)), '집 공유기');
  assert.equal(noteLineTitle(note('', `첫 줄\npassword: x`, {ai_title: '공유기 메모'})), '공유기 메모');
  assert.equal(noteLineTitle(note('', 'token: 가짜\n둘째 줄')), 'token: 가짜');
  assert.equal(noteLineTitle(note('장보기', '우유', {ai_off: true})), '장보기', '옛 표시(metadata.ai_off)는 읽지 않음');
});

test('화면에 비밀 가림·AI 제외 메뉴가 남지 않는다(지운 모듈·문구·표시)', () => {
  assert.equal(existsSync(new URL('../app/note-secret.mjs', import.meta.url)), false, '화면 공용 판별 모듈은 지움');
  const dir = new URL('../app/', import.meta.url);
  const files = readdirSync(dir).filter(f => /\.(m?js|css|html)$/.test(f));
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    for (const word of ['note-secret.mjs', 'AI에 보내지 않기', 'AI 제외 풀기', "'비밀 메모'", 'data-note-ai-off', 'note-meta-ai-off', 'setNoteAiOff', 'ai_off'])
      assert.ok(!src.includes(word), `${f}: ${word}`);
  }
});
