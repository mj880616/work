// NOTE-비밀메모 서버 쪽: ai-assist가 AI 재료로 읽은 노트 행을 건너뛰는 판별(supabase/functions/ai-assist/note-secret.ts).
// 예시 값은 모두 지어낸 가짜 글이다. 실제 AI 요청 본문 검사는 tests/security/ai-assist-*.test.mjs의 NOTE-비밀메모 시험이 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const server = await import('../supabase/functions/ai-assist/note-secret.ts');
const app = await import('../app/note-secret.mjs');
const row = (kind, title, raw_text, metadata = {}) => ({kind, title, raw_text, metadata});
const fake = 'Ab3' + 'x'.repeat(10) + 'Q9z' + 'y'.repeat(12);

test('노트(kind=note): AI 제외 표시·비밀 모양이면 건너뛰고, [풀기]면 보낸다', () => {
  assert.equal(server.noteRowAiBlocked(row('note', '장보기', '우유')), false);
  assert.equal(server.noteRowAiBlocked(row('note', '장보기', '우유', {ai_off: true})), true, '[AI에 보내지 않기]');
  assert.equal(server.noteRowAiBlocked(row('note', '공유기', '비밀번호: 아무거나')), true, '비밀 모양 본문');
  assert.equal(server.noteRowAiBlocked(row('note', 'token: 가짜', '본문')), true, '비밀 모양 제목');
  assert.equal(server.noteRowAiBlocked(row('note', '메모', `붙여 둔 값 ${fake}`)), true, '키 모양 덩어리');
  assert.equal(server.noteRowAiBlocked(row('note', '공유기', '비밀번호: 아무거나', {ai_off: false})), false, '[AI 제외 풀기]');
  assert.equal(server.noteRowAiBlocked(row('note', '공유기', '비밀번호: 아무거나', {ai_off: 'false'})), true, '글자 false는 풀기가 아님');
  assert.equal(server.noteRowAiBlocked(row('note', '공유기', '비밀번호: 아무거나', null)), true, 'metadata 없음');
  assert.equal(server.noteRowAiBlocked({kind: 'note', raw_text: '회의 준비'}), false, '제목·metadata 없음');
});

test('노트가 아닌 행(업데이트·업무일지)은 이 판별로 막지 않는다(풀 메뉴가 없음)', () => {
  assert.equal(server.noteRowAiBlocked(row('basket', null, '비밀번호: 아무거나')), false);
  assert.equal(server.noteRowAiBlocked(row('work', null, 'token: 가짜', {ai_off: true})), false);
  assert.equal(server.noteRowAiBlocked(null), false);
});

test('화면 공용 모듈과 같은 답(같은 예시 묶음)', () => {
  const cases = [
    row('note', '장보기', '우유'), row('note', 'x', 'token: 가짜'), row('note', 'x', 'token: 가짜', {ai_off: false}),
    row('note', '장보기', '우유', {ai_off: true}), row('note', '집 공유기', `메모\n${fake}`), row('note', '', '회의 준비 메모, 3차 교섭'),
    row('note', 'API_KEY = 가짜', ''), row('note', '', ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' ')),
  ];
  for (const c of cases) {
    assert.equal(server.noteAiOff(c), app.noteAiOff(c));
    assert.equal(server.noteLooksSecret(c), app.noteLooksSecret(c));
    assert.equal(server.noteAiOffMark(c), app.noteAiOffMark(c));
  }
});

test('서버 판별은 note-secret.ts 한 곳: note-title.ts는 다시 내보내기만, 규칙 줄을 따로 두지 않는다', async () => {
  const title = readFileSync(new URL('../supabase/functions/ai-assist/note-title.ts', import.meta.url), 'utf8');
  assert.ok(!title.includes('const SECRET_WORD'), 'note-title.ts에 규칙 사본 없음');
  const nt = await import('../supabase/functions/ai-assist/note-title.ts');
  assert.equal(nt.looksSecret, server.looksSecret);
  const dir = new URL('../supabase/functions/', import.meta.url);
  const {readdirSync} = await import('node:fs');
  const walk = d => readdirSync(d, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(new URL(`${e.name}/`, d)) : e.name.endsWith('.ts') ? [new URL(e.name, d)] : []);
  const copies = walk(dir).filter(f => readFileSync(f, 'utf8').includes('const SECRET_WORD')).map(f => f.pathname.split('/functions/')[1]);
  assert.deepEqual(copies, ['ai-assist/note-secret.ts']);
});
