// NOTE-AI제외정리(2026-11-10 17:41 명진 결정 A): 노트를 통째로 AI에서 빼지 않고, 비밀번호·토큰·키 모양 부분만 서버가 AI로 보내기 직전에 가린다.
// 가림 함수는 supabase/functions/ai-assist/note-secret.ts 한 곳(maskSecret·aiNoteRow). 길마다 실제 AI 요청 본문 검사는
// tests/security/ai-assist-*.test.mjs의 NOTE-AI제외정리 시험이 본다. 전수 표: docs/design/note-ai-mask.md. 예시 값은 모두 지어낸 가짜 글이다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';

const server = await import('../supabase/functions/ai-assist/note-secret.ts');
const fake = 'Ab3' + 'x'.repeat(10) + 'Q9z' + 'y'.repeat(12);
const pem = ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' '), pemEnd = ['-----END', 'RSA PRIVATE KEY-----'].join(' ');

test('maskSecret: 비밀 모양 부분만 [가림], 나머지 글은 그대로', () => {
  const {maskSecret, looksSecret, SECRET_MASK} = server;
  assert.equal(SECRET_MASK, '[가림]');
  assert.equal(maskSecret('회의 준비 메모, 3차 교섭'), '회의 준비 메모, 3차 교섭', '비밀 모양이 없으면 그대로');
  assert.equal(maskSecret('회의실 비밀번호: 1234\n내일 3시 교섭'), '회의실 [가림]\n내일 3시 교섭', '말이 나온 줄은 그 말부터 줄 끝까지');
  assert.equal(maskSecret(`붙여 둔 값 ${fake} 끝`), '붙여 둔 값 [가림] 끝', '키 모양 덩어리만');
  assert.equal(maskSecret(`${pem}\nMIIabc\n${pemEnd}\n뒤 글`), '[가림]\n뒤 글', '개인 키 묶음 통째');
  assert.equal(maskSecret('ghp_' + 'a'.repeat(30) + ' 깃 키'), '[가림] 깃 키');
  assert.equal(maskSecret('API_KEY = 가짜\n둘째 줄'), '[가림]\n둘째 줄');
  assert.equal(maskSecret('회의 https://example.test/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), '회의 https://example.test/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '주소는 그대로');
  assert.equal(maskSecret(undefined), '');
  assert.equal(maskSecret(null), '');
  for (const t of ['와이파이 비번 x', `${fake}\n${fake}`, 'token=가짜 otp 123', `${pem}\n잘린 키`, 'sk-live-' + 'b'.repeat(20) + ' password: y'])
    assert.equal(looksSecret(maskSecret(t)), false, `가린 뒤에는 비밀 모양이 남지 않음: ${t.slice(0, 12)}`);
});

test('aiNoteRow: 제목·본문·AI 제목만 가린 복사본, 원래 행과 다른 칸(옛 ai_off 포함)은 그대로', () => {
  const row = {id: 'n1', kind: 'note', title: '와이파이 비번: x', raw_text: `공유기\n${fake}`, metadata: {ai_off: true, ai_title: '토큰 메모', folder: '집'}, ai_export_allowed: true};
  const copy = structuredClone(row);
  const out = server.aiNoteRow(row);
  assert.deepEqual(row, copy, '원래 행은 고치지 않음');
  assert.equal(out.title, '와이파이 [가림]');
  assert.equal(out.raw_text, '공유기\n[가림]');
  assert.deepEqual(out.metadata, {ai_off: true, ai_title: '[가림]', folder: '집'});
  assert.equal(out.ai_export_allowed, true);
  assert.deepEqual(server.aiNoteRow({id: 'n2', kind: 'basket', raw_text: '그냥 글'}), {id: 'n2', kind: 'basket', raw_text: '그냥 글'});
  assert.equal(server.aiNoteRow(null), null);
});

test('옛 통째 제외 함수는 없다: noteAiOff·noteRowAiBlocked·ai_off를 서버 어디서도 읽지 않는다', () => {
  for (const name of ['noteAiOff', 'noteAiOffMark', 'noteRowAiBlocked', 'noteLooksSecret', 'NOTE_GUARD_FIELDS']) assert.equal(server[name], undefined, name);
  const dir = new URL('../supabase/functions/', import.meta.url);
  const walk = d => readdirSync(d, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(new URL(`${e.name}/`, d)) : e.name.endsWith('.ts') ? [new URL(e.name, d)] : []);
  for (const f of walk(dir)) {
    const src = readFileSync(f, 'utf8').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    assert.ok(!/\bai_off\b|noteAiOff|noteRowAiBlocked/.test(src), f.pathname.split('/functions/')[1]);
  }
});

test('노트 → AI 길은 모두 한 가림 함수를 거친다(전수 표 docs/design/note-ai-mask.md와 같은 자리)', () => {
  const src = name => readFileSync(new URL(`../supabase/functions/ai-assist/${name}`, import.meta.url), 'utf8');
  const handler = src('handler.ts');
  // 노트 표를 AI 재료로 읽는 곳: 읽자마자 aiNoteRow를 거치거나(행 단위), 보내는 글을 maskSecret으로 감싼다.
  const reads = [...handler.matchAll(/app_notes\?[^`]*`/g)].map(m => m.index);
  assert.ok(reads.length >= 10, '노트 읽는 곳을 찾음');
  const near = (i, re, span = 3200) => re.test(handler.slice(i, i + span));
  const masked = reads.filter(i => near(i, /aiNoteRow|maskSecret|askNoteAiText|workScopeLines/));
  // 노트 글을 AI에 보내지 않는 읽기(일기 겹침 거르기·업무일지 있음 확인·AI 제목 저장 확인·첨부 이름)는 표에 적고 여기서는 개수만 맞춘다.
  const notSent = reads.filter(i => !masked.includes(i));
  for (const i of notSent) {
    const q = handler.slice(i, handler.indexOf('`', i));
    assert.ok(/kind=eq\.diary|select=id&limit=1|select=id,metadata&limit=2|metadata->>ai_title=is\.null|attachments,archived_at,ai_export_allowed&limit=2/.test(q), `가림 없이 읽는 곳: ${q.slice(0, 80)}`);
  }
  assert.match(src('work-scope.ts'), /maskSecret\(l\.text\)/);
  assert.match(src('web2-ask.ts'), /maskSecret\(s\.ai_text \?\? s\.snippet\)/);
  assert.match(src('share-draft.ts'), /maskSecret\(s\.title\)/);
});

test('서버 판별·가림은 note-secret.ts 한 곳: note-title.ts는 다시 내보내기만, 규칙 줄을 따로 두지 않는다', async () => {
  const title = readFileSync(new URL('../supabase/functions/ai-assist/note-title.ts', import.meta.url), 'utf8');
  assert.ok(!title.includes('const SECRET_WORD'), 'note-title.ts에 규칙 사본 없음');
  const nt = await import('../supabase/functions/ai-assist/note-title.ts');
  assert.equal(nt.looksSecret, server.looksSecret);
  const dir = new URL('../supabase/functions/', import.meta.url);
  const walk = d => readdirSync(d, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(new URL(`${e.name}/`, d)) : e.name.endsWith('.ts') ? [new URL(e.name, d)] : []);
  const copies = walk(dir).filter(f => /const (SECRET_WORD|SECRET_MASK)\b/.test(readFileSync(f, 'utf8'))).map(f => f.pathname.split('/functions/')[1]);
  assert.deepEqual(copies, ['ai-assist/note-secret.ts']);
});
