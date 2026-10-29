// SEC-요약비밀가리기: AI가 쓴 요약(저장하는 칸)에서 비밀처럼 생긴 값을 [비밀]로 가린다. 원문(raw_text)은 그대로 둔다.
// 공용 함수 supabase/functions/_shared/secret-redact.mjs 하나를 텔레그램·통화·회의 초안·ai-assist 저장 경로가 같이 쓴다.
// 예시 값은 모두 지어낸 가짜 글이다(실제 번호·사람·대화 아님).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const FN = new URL('../../supabase/functions/', import.meta.url);
const read = (p) => readFileSync(new URL(p, FN), 'utf8');
const {redactSecrets, redactSecretLines, SECRET_MARK, AI_SECRET_RULE} = await import('../../supabase/functions/_shared/secret-redact.mjs');
const {parseTelegram, askEvidence, TELEGRAM_INSTRUCTIONS} = await import('../../supabase/functions/collector-feed/telegram.ts');
const {parseCall} = await import('../../supabase/functions/collector-feed/call-analysis.ts');
const {parseMeetingDraft} = await import('../../supabase/functions/meeting-ai-draft/parse.mjs');
const {checkedLines} = await import('../../supabase/functions/ai-assist/evidence.ts');
const {cleanSummaryLine} = await import('../../supabase/functions/ai-assist/org-summary.ts');
const {cleanBrief} = await import('../../supabase/functions/ai-assist/library-fill.ts');
const {cleanAreaLine} = await import('../../supabase/functions/ai-assist/business-area.ts');
const {parseJournalDraft} = await import('../../supabase/functions/ai-assist/journal-draft.ts');
const {parsePeopleBrief} = await import('../../supabase/functions/ai-assist/org-people-brief.ts');

const fakeKey = 'Ab3' + 'x'.repeat(10) + 'Q9z' + 'y'.repeat(12);

test('비밀 낱말 바로 뒤의 값만 [비밀]로 바뀌고 낱말·앞뒤 글은 남는다', () => {
  const cases = [
    ['현관 비밀번호는 1234#입니다', '현관 비밀번호는 [비밀]입니다'],
    ['공동현관 *5678 누르면 됨', '공동현관 [비밀] 누르면 됨'],
    ['도어락 번호: 9988', '도어락 번호: [비밀]'],
    ['인증번호 482913 받음', '인증번호 [비밀] 받음'],
    ['비번 abc12345', '비번 [비밀]'],
    ['OTP: 123456', 'OTP: [비밀]'],
    ['pw=hunter22', 'pw=[비밀]'],
    ["출입 코드 '4321'", "출입 코드 '[비밀]'"],
    ['PIN 0000', 'PIN [비밀]'],
    ['계좌 123-456-789012로 입금', '계좌 [비밀]로 입금'],
  ];
  for (const [input, want] of cases) assert.equal(redactSecrets(input), want, input);
});

test('키·토큰 모양, 주민등록번호·카드번호 모양은 통째로 [비밀]', () => {
  assert.equal(redactSecrets(`붙인 값 ${fakeKey} 확인`), '붙인 값 [비밀] 확인');
  assert.equal(redactSecrets('ghp_' + 'A1b2'.repeat(6)), SECRET_MARK);
  assert.equal(redactSecrets('eyJ' + 'a'.repeat(12) + '.' + 'b'.repeat(12) + '.' + 'c'.repeat(8)), SECRET_MARK);
  assert.equal(redactSecrets('번호 000101-3000000 받음'), '번호 [비밀] 받음');
  assert.equal(redactSecrets('카드 0000-1111-2222-3333'), '카드 [비밀]');
});

test('오탐 막기: 날짜·시각·전화번호·호수·금액·개수·글자만 있는 말은 그대로', () => {
  for (const s of [
    '현관 2026-10-30 공사',
    '현관 10시 집결',
    '현관 1030호 앞',
    '회의 10월 30일 14:00, 전화 010-0000-0000',
    '비밀번호 변경 필요',
    'password reset 안내',
    '인증번호 2026-10-30까지 제출',
    '5000원 인증번호 2개',
    '토큰 1700개 사용',
    '교섭 3차 2026.11.02 예정, 참석 12명',
    '계좌 3개 확인',
    '',
  ]) assert.equal(redactSecrets(s), s, s);
  assert.equal(redactSecrets(null), null);
  assert.equal(redactSecrets(undefined), undefined);
  // 웹 주소 안의 긴 덩어리는 건드리지 않는다.
  const url = `https://example.test/a?x=${fakeKey}`;
  assert.equal(redactSecrets(`자료 ${url}`), `자료 ${url}`);
  assert.deepEqual(redactSecretLines(['현관 1234#', '오후 3시 회의']), ['현관 [비밀]', '오후 3시 회의']);
});

test('가린 뒤 글자 수는 늘지 않는다(칸 상한을 넘지 않음)', () => {
  for (const s of ['비번 1234', '현관 *1#2', `x ${fakeKey}`, 'OTP 123456']) assert.ok([...redactSecrets(s)].length <= [...s].length, s);
});

test('텔레그램: 제목·요약·하루 요약·요청 한 줄은 가리고, 원문 근거(raw)는 handler가 그대로 남긴다', () => {
  const ai = JSON.stringify({
    day: {headline: '현관 비밀번호 1234# 공유', lines: ['도어락 번호 9988 안내함', '오후 3시 회의 잡힘', '인증번호 482913 전달함']},
    items: [{
      title: '현관 비번 1234#', summary: '현관 비밀번호는 1234#이고 14:00 회의는 2026-10-30에 함.', refs: ['m1'], organization: '', project: '',
      ask_me: {ask: true, to: 'me', request: 'OTP 123456 확인 필요', quote: 'm1', due: ''},
    }],
  });
  const parsed = parseTelegram(ai, 1, [], []);
  assert.ok(parsed);
  const [item] = parsed.items;
  assert.equal(item.title, '현관 비번 [비밀]');
  assert.equal(item.summary, '현관 비밀번호는 [비밀]이고 14:00 회의는 2026-10-30에 함.');
  assert.equal(item.ask.request, 'OTP [비밀] 확인 필요');
  assert.equal(parsed.day.headline, '현관 비밀번호 [비밀] 공유');
  assert.deepEqual(parsed.day.lines, ['도어락 번호 [비밀] 안내함', '오후 3시 회의 잡힘', '인증번호 [비밀] 전달함']);
  // 근거 한 줄(후보 표 evidence)도 가린다. 원문 줄(raw_text)은 rawLines가 만들며 가리지 않는다(아래 소스 검사).
  const m = {ref: 'r1', at: Date.parse('2026-10-24T05:00:00Z'), sender: 'A', text: '현관 비번 1234# 알려 드려요', reply_to: null, forwarded: false};
  assert.equal(askEvidence(m), '14:00 A: 현관 비번 [비밀] 알려 드려요');
  const tg = read('collector-feed/telegram.ts');
  const rawFn = tg.slice(tg.indexOf('export function rawLines'), tg.indexOf('export function askEvidence'));
  assert.ok(rawFn.length > 0 && !rawFn.includes('redactSecrets'), 'raw_text 줄은 가리지 않는다');
  assert.equal(TELEGRAM_INSTRUCTIONS.split(AI_SECRET_RULE).length - 1, 1, '지시문에 비밀 규칙 한 줄');
});

test('통화: 제목·요약 줄(points)은 가리고 전사 원문(raw_text)은 그대로', () => {
  const md = [
    '---', 'analysis_version: "3.3"', 'status: "업무"', 'is_work_related: true', 'call_title: "가상지부 · 위원장 · 현관 비번 1234#"',
    'recording_datetime: "2026-10-24 10:00:00"', 'source_txt_id: "ref-1"', '---',
    '## 핵심요약', '- 사무실 현관 비밀번호 1234#로 바뀜', '- 11월 2일 14:00 회의',
  ].join('\n');
  const transcript = '화자1: 현관 비밀번호 1234#예요';
  const r = parseCall({ref: 'ref-1', analysis_md: md, transcript}, [], Date.parse('2026-10-25T00:00:00Z'));
  assert.equal(r.kind, 'business');
  assert.ok(!r.title.includes('1234#') && r.title.includes(SECRET_MARK), r.title);
  assert.ok(r.points.some((p) => p.includes('현관 비밀번호 [비밀]')), JSON.stringify(r.points));
  assert.ok(r.points.some((p) => p.includes('14:00')), '시각은 남음');
  assert.ok(r.raw_text.includes('1234#'), '원문은 그대로');
});

test('회의 초안: 결정·정보공유·할 일 글을 가린다(담당자·기한 칸은 그대로)', () => {
  const out = parseMeetingDraft(JSON.stringify({decisions: '현관 비밀번호 1234#로 변경', information: 'OTP 123456 공유', actions: [{task: '도어락 번호 9988 공지', assignee: '총무', due: '2026-11-02'}]}));
  assert.equal(out.draft.decisions, '현관 비밀번호 [비밀]로 변경');
  assert.equal(out.draft.information, 'OTP [비밀] 공유');
  assert.deepEqual(out.draft.actions, [{task: '도어락 번호 [비밀] 공지', assignee: '총무', due: '2026-11-02'}]);
  // 형식이 깨져 원문을 보존하는 경우에도 가린다.
  assert.equal(parseMeetingDraft('현관 1234# 정리 안 됨').draft.information, '현관 [비밀] 정리 안 됨');
  assert.ok(read('meeting-ai-draft/index.ts').includes('${AI_SECRET_RULE}'));
});

test('ai-assist 저장 경로의 공용 검사 함수들이 가린 글을 돌려준다', () => {
  const lines = checkedLines([{text: '현관 1234# 바뀜', refs: [1]}, {text: '오후 3시 회의', refs: [1]}], (n) => n === 1, {maxLines: 5, maxChars: 100});
  assert.deepEqual(lines.map((l) => l.text), ['현관 [비밀] 바뀜', '오후 3시 회의']);
  assert.equal(cleanSummaryLine('인증번호 482913 받아 처리함'), '인증번호 [비밀] 받아 처리함');
  assert.equal(cleanBrief('도어락 번호 9988 안내\n일정 11월 2일'), '도어락 번호 [비밀] 안내\n일정 11월 2일');
  assert.equal(cleanAreaLine('현관 *5678 공지함'), '현관 [비밀] 공지함');
  assert.equal(parseJournalDraft(JSON.stringify({line: '현관 1234# 공지함'})), '현관 [비밀] 공지함');
  assert.equal(parsePeopleBrief(JSON.stringify({brief: '인증번호 482913 전달함', detail: '현관 1234# 공유\n회의 준비'})).detail, '현관 [비밀] 공유\n회의 준비');
});

// 찾은 곳 표(PR 본문과 같음): AI 글을 저장하는 서버 경로가 모두 공용 가리기 함수를 가져다 쓴다.
test('AI 요약을 저장하는 서버 경로가 모두 공용 가리기 함수를 쓴다', () => {
  const uses = [
    'collector-feed/telegram.ts', 'collector-feed/call-analysis.ts', 'meeting-ai-draft/parse.mjs',
    'ai-assist/todo-radar.ts', 'ai-assist/ledger-candidates.ts', 'ai-assist/ledger-auto.ts', 'ai-assist/org-summary.ts',
    'ai-assist/org-people-brief.ts', 'ai-assist/evidence.ts', 'ai-assist/business-area.ts', 'ai-assist/library-fill.ts',
    'ai-assist/journal-draft.ts', 'ai-assist/call-refill.ts', 'ai-assist/overlap.ts',
  ];
  for (const f of uses) {
    const src = read(f);
    assert.match(src, /from ["']\.\.\/_shared\/secret-redact\.mjs["']/, `${f}: 공용 함수 import`);
    assert.ok(/redactSecrets\(/.test(src.replace(/import[^;]*;/g, '')), `${f}: 실제로 부름`);
  }
  for (const f of ['ai-assist/todo-radar.ts', 'ai-assist/ledger-candidates.ts', 'ai-assist/ledger-auto.ts', 'ai-assist/org-summary.ts', 'ai-assist/org-people-brief.ts',
    'ai-assist/business-area.ts', 'ai-assist/library-fill.ts', 'ai-assist/journal-draft.ts', 'ai-assist/next-week-sheet.ts', 'ai-assist/pre-meeting-sheet.ts', 'ai-assist/web2-ask.ts']) {
    assert.ok(read(f).includes('AI_SECRET_RULE,'), `${f}: 지시문에 비밀 규칙`);
  }
});
